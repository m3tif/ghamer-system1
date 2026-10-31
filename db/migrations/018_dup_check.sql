-- 018_dup_check.sql — read-only live duplicate check used while typing (no log entry, no notification).
-- Returns only what the caller is allowed to see: always "exists", and the name/status/owner only when the caller can see that lead.
create or replace function app.check_duplicate(p_phone text, p_store_key text) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_client uuid; v_lead uuid; r jsonb := '{}'::jsonb; v_vis boolean;
begin
  if app.me() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_phone, '') <> '' then
    select ci.client_id into v_client from client_identifiers ci where ci.kind = 'phone' and ci.value = p_phone limit 1;
    if v_client is not null then
      select l.id into v_lead from leads l where l.client_id = v_client order by l.created_at desc limit 1;
      v_vis := v_lead is not null and app.lead_visible(v_lead);
      r := r || jsonb_build_object('phone', jsonb_build_object('exists', true, 'visible', v_vis)
        || case when v_vis then (select jsonb_build_object('lead_id', l.id, 'name', c.name, 'status', l.lead_status, 'owner', app.emp_name(l.current_owner_id))
                                   from leads l join clients c on c.id = l.client_id where l.id = v_lead) else '{}'::jsonb end);
    end if;
  end if;
  if coalesce(p_store_key, '') <> '' then
    select s.client_id into v_client from client_stores s where s.url_key = p_store_key limit 1;
    if v_client is not null then
      select l.id into v_lead from leads l where l.client_id = v_client order by l.created_at desc limit 1;
      v_vis := v_lead is not null and app.lead_visible(v_lead);
      r := r || jsonb_build_object('store', jsonb_build_object('exists', true, 'visible', v_vis)
        || case when v_vis then (select jsonb_build_object('lead_id', l.id, 'name', c.name, 'status', l.lead_status, 'owner', app.emp_name(l.current_owner_id))
                                   from leads l join clients c on c.id = l.client_id where l.id = v_lead) else '{}'::jsonb end);
    end if;
  end if;
  return r;
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
