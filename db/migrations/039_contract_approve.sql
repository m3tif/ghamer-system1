-- 039: financial approval — one button for the Finance Manager (or Super Admin) on a contract that is waiting for Finance.
-- The contract becomes approved and locked, the deal moves to «Financially Approved», the Sales owner is notified,
-- and everything is written to the audit log. Pressing twice does nothing the second time.
begin;

create or replace function app.contract_approve(p_contract uuid, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare c contracts; d deals;
begin
  if not app.has_perm('finance.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  if c.status = 'approved' then return; end if;                                    -- pressed twice
  if c.status <> 'submitted' then raise exception 'contract is not waiting for Finance'; end if;
  perform set_config('app.reason', coalesce(nullif(btrim(p_note),''), 'اعتماد مالي'), true);
  update contracts set status = 'approved', approved_by = app.me(), approved_at = now(), updated_by = app.me() where id = c.id;
  select * into d from deals where id = c.deal_id for update;
  if d.stage <> 'Financially Approved' then
    update deals set stage = 'Financially Approved' where id = d.id;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
    values (d.id, d.stage, 'Financially Approved', 'اعتماد مالي للعقد ' || c.contract_no || coalesce(' — ' || nullif(btrim(p_note),''), ''), app.me());
  end if;
  perform app._notify(c.sales_owner_id, 'contract_approved', 'تم الاعتماد المالي للعقد', c.contract_no || ' — مبروك، العقد اتعتمد من المالية', '/contracts/' || c.id, 'ctapp:' || c.id);
end $$;

create or replace function app.contract_get(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'contract', to_jsonb(c) || jsonb_build_object('client_name', cl.name, 'business_name', cl.business_name,
        'store_url', (select s.url_raw from client_stores s where s.client_id = cl.id order by s.created_at limit 1),
        'phone', (select cc.phone from client_contacts cc where cc.client_id = cl.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
        'sales_name', app.emp_name(c.sales_owner_id), 'tele_name', app.emp_name(c.tele_sales_id),
        'created_by_name', app.emp_name(c.created_by), 'submitted_by_name', app.emp_name(c.submitted_by), 'returned_by_name', app.emp_name(c.returned_by), 'approved_by_name', app.emp_name(c.approved_by),
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
