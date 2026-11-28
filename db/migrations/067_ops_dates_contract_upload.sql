-- 067: the client's start / end dates in «تعديل بيانات العميل», and uploading the client's contract.
-- * The client's Account Manager, the Technical Manager and the admin (same people who edit the client) set the dates.
--   They live on the client's file (client_operations). For a client with a Finance contract, the contract itself is
--   untouched; the dates set here are shown instead of the contract's (the contract's stay the default).
-- * The same people upload the signed contract (PDF or image) to the client's file; whoever can see the client's file
--   can open it; the uploader or the admin can remove a wrong upload.
begin;
do $$ declare f text; d text; d0 text; begin
  -- the dialog shows the dates (the client's own, else the contract's)
  select replace(pg_get_functiondef('app.ops_client_get(uuid)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, '''stores'', coalesce(', '''start_date'', (select coalesce(o.start_date, ct.start_date) from client_operations o left join contracts ct on ct.id = o.contract_id where o.id = p_ops),
    ''end_date'', (select coalesce(o.end_date, ct.end_date) from client_operations o left join contracts ct on ct.id = o.contract_id where o.id = p_ops),
    ''has_contract'', (select o.contract_id is not null from client_operations o where o.id = p_ops),
    ''stores'', coalesce(');
  if d = d0 then raise exception 'base changed: ops_client_get'; end if;
  execute d;
  -- and saves them (after the duplicate check, so nothing is saved when the phone/store belongs to someone else)
  select replace(pg_get_functiondef('app.ops_client_update(uuid,jsonb)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, '  perform app._write_contacts(v, p, true);', '  if p ? ''start_date'' or p ? ''end_date'' then
    if nullif(p->>''start_date'','''') is not null and nullif(p->>''end_date'','''') is not null and (p->>''end_date'')::date < (p->>''start_date'')::date then
      raise exception ''end date is before start date''; end if;
    update client_operations set start_date = nullif(p->>''start_date'','''')::date, end_date = nullif(p->>''end_date'','''')::date, updated_at = now() where id = p_ops;
  end if;
  perform app._write_contacts(v, p, true);');
  if d = d0 then raise exception 'base changed: ops_client_update'; end if;
  execute d;
  -- the client's own dates come first everywhere the dates are shown
  select replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'ops_list'; d0 := d;
  d := replace(d, 'coalesce(c.start_date, o.start_date), coalesce(c.end_date, o.end_date)', 'coalesce(o.start_date, c.start_date), coalesce(o.end_date, c.end_date)');
  if d = d0 then raise exception 'base changed: ops_list'; end if;
  execute d;
  select replace(pg_get_functiondef('app.portal_enable(uuid,text,text,text)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, 'coalesce(c.start_date, o.start_date), coalesce(c.end_date, o.end_date)', 'coalesce(o.start_date, c.start_date), coalesce(o.end_date, c.end_date)');
  if d = d0 then raise exception 'base changed: portal_enable'; end if;
  execute d;
  select replace(pg_get_functiondef('app.portal_staff_get(uuid)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, 'coalesce(ct.start_date, o.start_date)', 'coalesce(o.start_date, ct.start_date)');
  d := replace(d, 'coalesce(ct.end_date, o.end_date)', 'coalesce(o.end_date, ct.end_date)');
  if d = d0 then raise exception 'base changed: portal_staff_get'; end if;
  execute d;
  select replace(pg_get_functiondef('app.portal_project_get(uuid)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, 'coalesce(p.start_date, ct.start_date, o.start_date)', 'coalesce(p.start_date, o.start_date, ct.start_date)');
  d := replace(d, 'coalesce(p.expected_end, ct.end_date, o.end_date)', 'coalesce(p.expected_end, o.end_date, ct.end_date)');
  if d = d0 then raise exception 'base changed: portal_project_get'; end if;
  execute d;
  -- whoever sees the client's file can open its uploaded contract
  select replace(pg_get_functiondef('app.attachment_get(uuid)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, '     or (a.entity_type = ''task''', '     or (a.entity_type = ''ops_contract'' and exists (select 1 from client_operations o where o.id = a.entity_id and (app._ops_visible(o.account_manager_id) or app._ops_client(o.id) is not null)))
     or (a.entity_type = ''task''');
  if d = d0 then raise exception 'base changed: attachment_get'; end if;
  execute d;
end $$;

create or replace function app.ops_contract_attach(p_ops uuid, p_filename text, p_mime text, p_content bytea) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_name text := left(regexp_replace(coalesce(p_filename,''), '^.*[/\\]', ''), 150); v_head text := encode(substring(p_content from 1 for 12), 'hex');
begin
  if app._ops_client(p_ops) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_content is null or octet_length(p_content) = 0 then raise exception 'file is empty'; end if;
  if octet_length(p_content) > 4 * 1024 * 1024 then raise exception 'file too large'; end if;
  if (select count(*) from attachments a where a.entity_type = 'ops_contract' and a.entity_id = p_ops) >= 20 then raise exception 'too many files'; end if;
  if not ((p_mime = 'application/pdf' and v_head like '25504446%')
       or (p_mime = 'image/jpeg' and v_head like 'ffd8ff%')
       or (p_mime = 'image/png' and v_head like '89504e470d0a1a0a%')
       or (p_mime = 'image/webp' and v_head like '52494646%' and substring(v_head from 17 for 8) = '57454250')) then
    raise exception 'unsupported file type';
  end if;
  if v_name = '' then v_name := 'contract'; end if;
  perform set_config('app.reason', 'رفع عقد العميل', true);
  insert into attachments(entity_type, entity_id, storage_path, filename, mime_type, size_bytes, uploaded_by, kind)
  values ('ops_contract', p_ops, 'db', v_name, p_mime, octet_length(p_content), app.me(), 'signed_contract') returning id into v_id;
  insert into attachment_blobs(attachment_id, content) values (v_id, p_content);
  return v_id;
end $$;

create or replace function app.ops_contract_files(p_ops uuid) returns table(id uuid, filename text, size_bytes bigint, by_name text, created_at timestamptz, can_delete boolean)
language sql stable security definer set search_path = public, app as $$
  select a.id, a.filename, a.size_bytes, app.emp_name(a.uploaded_by), a.created_at, (a.uploaded_by = app.me() or app.is_super())
    from attachments a join client_operations o on o.id = a.entity_id
   where a.entity_type = 'ops_contract' and a.entity_id = p_ops and (app._ops_visible(o.account_manager_id) or app._ops_client(o.id) is not null)
   order by a.created_at desc
$$;

-- a wrong upload is removed by whoever uploaded it, or the admin (the removal is in the audit log)
create or replace function app.ops_contract_delete(p_attachment uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare a attachments;
begin
  select * into a from attachments where id = p_attachment and entity_type = 'ops_contract';
  if not found or not (a.uploaded_by = app.me() or app.is_super()) or app._ops_client(a.entity_id) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.reason', 'حذف عقد مرفوع بالغلط: ' || a.filename, true);
  delete from attachment_blobs where attachment_id = a.id;
  delete from attachments where id = a.id;
end $$;

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
grant execute on function app._tech_ops_role(text) to ghamer_app;
commit;
