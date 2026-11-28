-- 066: the Client Portal for existing clients («عميل قائم»). They have no contract in the system: their packages and
-- dates live on the client's file (ops_services, client_operations.start_date/end_date). 065 required a contract, so the
-- portal page of such a client came back empty (404) and the portal could not be opened for him.
begin;
do $$ declare f text; d text; d0 text; begin
  -- the staff screen
  select replace(pg_get_functiondef('app.portal_staff_get(uuid)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, 'join contracts ct on ct.id = o.contract_id', 'left join contracts ct on ct.id = o.contract_id');
  d := replace(d, '''contract_approved'', ct.status = ''approved'', ''contract_start'', ct.start_date, ''contract_end'', ct.end_date',
                  '''contract_approved'', o.is_existing or coalesce(ct.status = ''approved'', false), ''contract_start'', coalesce(ct.start_date, o.start_date), ''contract_end'', coalesce(ct.end_date, o.end_date)');
  if d = d0 or position('left join contracts' in d) = 0 or position('o.is_existing' in d) = 0 then raise exception 'base changed: portal_staff_get'; end if;
  execute d;
  -- the client's project
  select replace(pg_get_functiondef('app.portal_project_get(uuid)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, 'join contracts ct on ct.id = o.contract_id', 'left join contracts ct on ct.id = o.contract_id');
  d := replace(d, '''start_date'', coalesce(p.start_date, ct.start_date), ''expected_end'', coalesce(p.expected_end, ct.end_date)',
                  '''start_date'', coalesce(p.start_date, ct.start_date, o.start_date), ''expected_end'', coalesce(p.expected_end, ct.end_date, o.end_date)');
  d := replace(d, '(select coalesce(jsonb_agg(sv.name_ar order by cs.sort), ''[]'') from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = o.contract_id)',
                  '(select coalesce(jsonb_agg(x.n order by x.s), ''[]'') from (select sv.name_ar n, cs.sort s from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = o.contract_id
                      union all select sv.name_ar, os.sort from ops_services os join services sv on sv.code = os.service_code where os.ops_id = o.id) x)');
  if d = d0 or position('left join contracts' in d) = 0 or position('ops_services' in d) = 0 or position('o.end_date)' in d) = 0 then raise exception 'base changed: portal_project_get'; end if;
  execute d;
  -- opening the portal
  select replace(pg_get_functiondef('app.portal_enable(uuid,text,text,text)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, 'if c.status <> ''approved'' then raise exception', 'if not o.is_existing and coalesce(c.status, '''') <> ''approved'' then raise exception');
  d := replace(d, 'c.start_date, c.end_date, app.me());', 'coalesce(c.start_date, o.start_date), coalesce(c.end_date, o.end_date), app.me());');
  if d = d0 or position('o.is_existing' in d) = 0 or position('coalesce(c.end_date, o.end_date)' in d) = 0 then raise exception 'base changed: portal_enable'; end if;
  execute d;
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
