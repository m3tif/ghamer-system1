-- 038: delete a wrongly uploaded contract file
-- Who: the person who uploaded it, or the Super Admin. When: before financial approval; the signed contract only while the
-- contract is still with Sales (draft / returned). The deletion is written to the audit log (audit_attachments trigger).
begin;

create or replace function app._file_can_delete(p_uploader uuid, p_kind text, p_status text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select (p_uploader = app.me() or app.is_super())
     and p_status not in ('approved','cancelled')
     and (p_kind <> 'signed_contract' or p_status in ('draft','returned'))
$$;

create or replace function app.contract_file_delete(p_attachment uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare a attachments; c contracts;
begin
  select * into a from attachments where id = p_attachment and entity_type = 'contract';
  if not found then return; end if;                                   -- pressed twice: already gone
  select * into c from contracts where id = a.entity_id for update;
  if not found or not app.contract_visible(c.sales_owner_id, c.status) then raise exception 'no access' using errcode = '42501'; end if;
  if c.status in ('approved','cancelled') then raise exception 'file cannot be deleted: contract is closed'; end if;
  if a.kind = 'signed_contract' and c.status not in ('draft','returned') then raise exception 'contract is locked: it is with Finance'; end if;
  if not (a.uploaded_by = app.me() or app.is_super()) then raise exception 'file delete not allowed: not the uploader' using errcode = '42501'; end if;
  delete from attachment_blobs where attachment_id = a.id;
  delete from attachments where id = a.id;
end $$;

create or replace function app.contract_get(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'contract', to_jsonb(c) || jsonb_build_object('client_name', cl.name, 'business_name', cl.business_name,
        'store_url', (select s.url_raw from client_stores s where s.client_id = cl.id order by s.created_at limit 1),
        'phone', (select cc.phone from client_contacts cc where cc.client_id = cl.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
        'sales_name', app.emp_name(c.sales_owner_id), 'tele_name', app.emp_name(c.tele_sales_id),
        'created_by_name', app.emp_name(c.created_by), 'submitted_by_name', app.emp_name(c.submitted_by), 'returned_by_name', app.emp_name(c.returned_by),
        'deal_stage', d.stage, 'can_write', app._contract_can_write(c.sales_owner_id)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('service', s.service_code, 'service_name', sv.name_ar, 'description', s.description, 'amount', s.amount) order by s.sort), '[]')
                from contract_services s join services sv on sv.code = s.service_code where s.contract_id = c.id),
    'installments', (select coalesce(jsonb_agg(jsonb_build_object('seq', i.seq, 'kind', i.kind, 'due_date', i.due_date, 'amount', i.amount, 'note', i.note) order by i.seq), '[]')
                from payment_installments i where i.contract_id = c.id),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'filename', a.filename, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes,
                'uploaded_by', app.emp_name(a.uploaded_by), 'created_at', a.created_at, 'can_delete', app._file_can_delete(a.uploaded_by, a.kind, c.status)) order by a.created_at desc), '[]')
                from attachments a where a.entity_type = 'contract' and a.entity_id = c.id))
    from contracts c join clients cl on cl.id = c.client_id join deals d on d.id = c.deal_id
   where c.id = p_id and app.contract_visible(c.sales_owner_id, c.status)
$$;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to ghamer_app;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from ghamer_app', f.sig);
  end loop;
end $$;
revoke execute on function app.audit_row() from ghamer_app;
revoke execute on function app.audit_block_changes() from ghamer_app;
revoke execute on function app.protect_clients() from ghamer_app;
revoke execute on function app.protect_leads() from ghamer_app;
revoke execute on function app.protect_meetings() from ghamer_app;
revoke execute on function app.touch_updated_at() from ghamer_app;
revoke execute on function app.set_created_month() from ghamer_app;
revoke execute on function app._notes_guard() from ghamer_app;
revoke execute on function app._notes_first() from ghamer_app;

commit;
