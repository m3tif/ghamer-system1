-- 053: Admin dashboard — one call for everything that waits on someone, across all departments (admins only).
begin;
create or replace function app.admin_attention() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.is_admin() then raise exception 'no access' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pending_distribution', (select count(*) from lead_handoffs where status = 'pending_distribution'),
    'pending_sales', (select count(*) from lead_handoffs where status = 'pending'),
    'open_reviews', (select count(*) from duplicate_reviews where status = 'open'),
    'followups_overdue', (select count(*) from follow_ups where status = 'open' and due_at < now()),
    'rejected_waiting', (select count(*) from leads where lead_status = 'Rejected by Sales' and hidden_at is null),
    'meetings_today', (select count(*) from meetings where status in ('Scheduled','Confirmed','Rescheduled')
        and scheduled_at >= app._today()::timestamp at time zone app.company_tz() and scheduled_at < (app._today() + 1)::timestamp at time zone app.company_tz()),
    'meetings_upcoming', (select count(*) from meetings where status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at >= now()),
    'meetings_no_outcome', (select count(*) from meetings where status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at < now() - interval '2 hours'),
    'contracts_waiting', (select count(*) from contracts where status = 'submitted'),
    'contracts_late', (select count(*) from contracts where status = 'submitted' and submitted_at < now() - interval '48 hours'),
    'payments_pending', (select count(*) from payments where status = 'pending'),
    'overdue_money', (select coalesce(sum(greatest(due - paid, 0)), 0) from (
        select c.id, (select coalesce(sum(p.amount), 0) from payment_installments p where p.contract_id = c.id and p.due_date <= app._today()) due,
               (select coalesce(sum(y.amount), 0) from payments y where y.contract_id = c.id and y.status = 'verified') paid
          from contracts c where c.status = 'approved') x),
    'ops_new', (select count(*) from client_operations where status = 'new'),
    'ops_no_packages', (select count(*) from client_operations o where o.is_existing and not exists (select 1 from ops_services s where s.ops_id = o.id)),
    'tasks_review', (select count(*) from tasks where status = 'submitted'),
    'tasks_client', (select count(*) from tasks where status = 'client_review'),
    'tasks_late', (select count(*) from tasks where status <> 'approved' and due_date < app._today()),
    'tasks_open', (select count(*) from tasks where status <> 'approved'),
    'tasks_done_month', (select count(*) from tasks where status = 'approved' and reviewed_at >= date_trunc('month', app._today())::timestamp at time zone app.company_tz()),
    'ops_assigned', (select count(*) from client_operations where status = 'assigned'),
    'contracts_ending_30', (select count(*) from contracts where status = 'approved' and end_date between app._today() and app._today() + 30),
    'hidden_leads', (select count(*) from leads where hidden_at is not null),
    'employees_active', (select count(*) from users where is_active),
    'per_am', (select coalesce(jsonb_agg(to_jsonb(x) order by x.clients desc, x.full_name), '[]') from (
        select e.id, e.full_name,
          (select count(*)::int from client_operations o where o.account_manager_id = e.id) clients,
          (select count(*)::int from tasks t join client_operations o on o.id = t.ops_id where o.account_manager_id = e.id and t.status <> 'approved') open_tasks,
          (select count(*)::int from tasks t join client_operations o on o.id = t.ops_id where o.account_manager_id = e.id and t.status <> 'approved' and t.due_date < app._today()) late_tasks,
          (select count(*)::int from tasks t join client_operations o on o.id = t.ops_id where o.account_manager_id = e.id and t.status = 'submitted') to_review
        from employees e join users u on u.id = e.id join roles r on r.id = u.role_id where r.code = 'account_manager' and u.is_active) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('src', x.src, 'n', x.n) order by x.n desc), '[]') from (
        select cl.original_source src, count(*)::int n from leads l join clients cl on cl.id = l.client_id group by 1) x),
    'temperature', (select coalesce(jsonb_agg(jsonb_build_object('t', x.t, 'n', x.n) order by x.n desc), '[]') from (
        select coalesce(lead_temperature, 'none') t, count(*)::int n from leads where hidden_at is null group by 1) x));
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

commit;
