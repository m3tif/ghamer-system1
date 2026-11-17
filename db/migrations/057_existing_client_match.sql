-- 057: adding an EXISTING client whose phone is already in the CRM (e.g. a tele-sales lead) no longer stops with
-- «مسجل بالفعل» + a review request the Technical Manager isn't allowed to send. The same client record is put in the
-- technical queue (no new client, the lead and its owner stay exactly as they are) and the lead owner is told.
begin;
create or replace function app._existing_from_dup(p_client uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_me uuid := app.me(); v_ops uuid; v_name text; v_lead uuid; v_owner uuid; u record;
begin
  select name into v_name from clients where id = p_client;
  select o.id into v_ops from client_operations o where o.client_id = p_client order by o.created_at limit 1;
  if found then
    return jsonb_build_object('status','ops_exists','client_id',p_client,'ops_id',v_ops,'existing_name',v_name);
  end if;
  if v_name = 'بدون اسم' and nullif(btrim(p->>'name'),'') is not null then   -- only fills a blank name, never overwrites one
    update clients set name = btrim(p->>'name') where id = p_client; v_name := btrim(p->>'name');
  end if;
  insert into client_operations(client_id, is_existing, notes, created_by) values (p_client, true, nullif(btrim(p->>'call_notes'),''), v_me) returning id into v_ops;
  insert into ops_services(ops_id, service_code, sort)
  select v_ops, x.code, x.n from jsonb_array_elements_text(coalesce(p->'packages','[]')) with ordinality x(code, n)
   where exists (select 1 from services s where s.code = x.code and s.is_active) on conflict do nothing;
  for u in select us.id from users us join roles r on r.id = us.role_id where r.code = 'operations_manager' and us.is_active and us.id <> v_me loop
    perform app._notify(u.id, 'ops_new', 'عميل قائم جديد', coalesce(v_name,'بدون اسم') || ' — حدّد الباقات وحوّله لأكاونت مانجر', '/operations', 'opsex:' || v_ops);
  end loop;
  select l.id, l.current_owner_id into v_lead, v_owner from leads l where l.client_id = p_client order by l.created_at desc limit 1;
  if v_owner is not null and v_owner <> v_me then
    perform app._notify(v_owner, 'ops_new', 'عميلك طلع عميل قائم عندنا',
      coalesce(v_name,'بدون اسم') || ' اتضاف للتيم التقني كعميل قائم. بياناته عندك زي ما هي.', '/leads/' || v_lead, 'opsdup:' || v_ops);
  end if;
  return jsonb_build_object('status','created','client_id',p_client,'ops_id',v_ops,'lead_id',null,'matched',true,'owner_name',app.emp_name(v_owner));
end $$;

do $do$
declare d text; o text := $o$  v_dup := app._find_dup(v_ids);
  if v_dup is not null then return v_dup; end if;$o$;
begin
  d := pg_get_functiondef('app.register_lead(jsonb)'::regprocedure);
  if position('_existing_from_dup' in d) > 0 then return; end if;   -- already applied
  if position(o in d) = 0 then raise exception 'register_lead base changed'; end if;
  d := replace(d, o, $n$  v_dup := app._find_dup(v_ids);
  if v_dup is not null then
    if v_existing and not coalesce((v_dup->>'ambiguous')::boolean, false) and v_dup->>'existing_client_id' is not null then
      return app._existing_from_dup((v_dup->>'existing_client_id')::uuid, p);   -- existing client already in the CRM → same record to the tech queue
    end if;
    return v_dup;
  end if;$n$);
  execute d;
end $do$;

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
