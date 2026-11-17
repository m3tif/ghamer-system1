-- 058: the client's details (name, business name, contact person, city, phones, store links) can be edited from the
-- technical side: by the admins, the Technical Manager, and the Account Manager the client is assigned to.
-- Phone stays the only duplicate rule: a phone/link that belongs to ANOTHER client is refused (nothing is saved).
begin;
create or replace function app._ops_client(p_ops uuid) returns uuid
language sql stable security definer set search_path = public, app as $$
  select o.client_id from client_operations o
  where o.id = p_ops and (app.is_admin() or app.role_code() = 'operations_manager'
        or (app.role_code() = 'account_manager' and o.account_manager_id = app.me()))
$$;

create or replace function app.ops_client_get(p_ops uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v uuid := app._ops_client(p_ops);
begin
  if v is null then raise exception 'no access' using errcode = '42501'; end if;
  return (select jsonb_build_object('client_id', c.id, 'name', c.name, 'business_name', c.business_name, 'contact_person', c.contact_person, 'city', c.city,
    'phone', (select coalesce(x.phone_raw, x.phone) from client_contacts x where x.client_id = c.id and x.label = 'mobile' and x.phone is not null order by x.is_primary desc, x.created_at limit 1),
    'alt_phone', (select coalesce(x.phone_raw, x.phone) from client_contacts x where x.client_id = c.id and x.label = 'alt_mobile' and x.phone is not null order by x.created_at limit 1),
    'whatsapp', (select coalesce(x.phone_raw, x.phone) from client_contacts x where x.client_id = c.id and x.label = 'whatsapp' and x.phone is not null order by x.created_at limit 1),
    'stores', coalesce((select jsonb_agg(s.url_raw order by s.created_at) from client_stores s where s.client_id = c.id), '[]'::jsonb))
    from clients c where c.id = v);
end $$;

create or replace function app.ops_client_update(p_ops uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v uuid := app._ops_client(p_ops); v_other uuid; v_kind text; v_owner uuid; v_lead_owner uuid;
begin
  if v is null then raise exception 'no access' using errcode = '42501'; end if;
  if coalesce(btrim(p->>'name'),'') = '' then raise exception 'name required'; end if;
  if not exists (select 1 from jsonb_to_recordset(coalesce(p->'identifiers','[]')) x(kind text, value text) where x.kind = 'phone') then
    raise exception 'phone required';
  end if;
  -- a phone / store that belongs to another client → refuse, say whose it is
  select ci.client_id, ci.kind into v_other, v_kind from client_identifiers ci
    join jsonb_to_recordset(p->'identifiers') x(kind text, value text, label text) on x.kind = ci.kind and x.value = ci.value
   where ci.client_id <> v limit 1;
  if v_other is not null then
    select l.current_owner_id into v_lead_owner from leads l where l.client_id = v_other order by l.created_at desc limit 1;
    select original_creator_id into v_owner from clients where id = v_other;
    return jsonb_build_object('status','duplicate','kind',v_kind,'existing_name',(select name from clients where id = v_other),
                              'owner_name', app.emp_name(coalesce(v_lead_owner, v_owner)));
  end if;
  update clients set name = btrim(p->>'name'), business_name = nullif(btrim(p->>'business_name'),''),
         contact_person = nullif(btrim(p->>'contact_person'),''), city = nullif(btrim(p->>'city'),''), updated_at = now()
   where id = v;
  perform app._write_contacts(v, p, true);
  return jsonb_build_object('status','updated');
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
