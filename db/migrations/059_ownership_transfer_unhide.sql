-- 059: an approved ownership review now really hands the client over: a lead that was hidden (data hiding) is shown
-- again for its new owner, the transfer log keeps the previous owner, and the notification opens the client itself.
begin;
do $do$
declare d text;
  o1 text := $o$    update leads set current_owner_id = v_r.requested_by where id = v_lead;
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
      select v_lead, 'owner', (select current_owner_id from leads where id = v_lead), v_r.requested_by, app.me(), p_note;$o$;
  n1 text := $n$    -- previous owner first (the old code read it after the update), then hand over and un-hide:
    -- a client moved to someone by the manager's decision must be visible to him
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
      select v_lead, 'owner', current_owner_id, v_r.requested_by, app.me(), p_note from leads where id = v_lead;
    update leads set current_owner_id = v_r.requested_by,
           hidden_at = null, hidden_by = null, hidden_reason = null, hidden_period_id = null
     where id = v_lead;$n$;
  o2 text := $o$                      '/leads', 'ownres:' || p_review);$o$;
  n2 text := $n$                      case when p_decision = 'transfer' then '/leads/' || v_lead else '/leads' end, 'ownres:' || p_review);$n$;
begin
  d := replace(pg_get_functiondef('app.resolve_duplicate_review(uuid,text,text)'::regprocedure), E'\r\n', E'\n');   -- prod copy has CRLF
  if position('hidden_period_id = null' in d) > 0 then return; end if;          -- already applied
  if position(o1 in d) = 0 or position(o2 in d) = 0 then raise exception 'resolve_duplicate_review base changed'; end if;
  execute replace(replace(d, o1, n1), o2, n2);
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
