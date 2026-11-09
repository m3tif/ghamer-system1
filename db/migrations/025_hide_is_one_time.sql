-- 025: hiding is a one-time action on the leads that exist at that moment. Leads created or handed to the employee AFTER the hide
-- (tomorrow, next week, later in the same month) appear normally. What was hidden stays hidden until it is restored.
drop trigger if exists leads_hide_new on leads;
drop trigger if exists leads_hide_reassigned on leads;
create or replace function app._hide_new_lead() returns trigger language plpgsql security definer set search_path = public, app as $$
begin return NEW; end $$;

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
