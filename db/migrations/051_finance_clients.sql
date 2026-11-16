-- 051: Finance dashboard — clients ranked by contract value, with their payment schedule (when the payments end, what is still due
-- by the schedule) and how long is left on the contract. The system records the schedule, not actual payments yet, so «due» is by date.
begin;
create or replace function app.finance_clients()
returns table(contract_id uuid, contract_no text, client_name text, business_name text, status text, packages text, total_amount numeric,
              start_date date, end_date date, days_total int, days_left int, inst_count int, due_so_far numeric, remaining numeric,
              next_due date, next_amount numeric, last_due date, schedule jsonb)
language sql stable security definer set search_path = public, app as $$
  select c.id, c.contract_no, cl.name, cl.business_name, c.status,
         (select string_agg(sv.name_ar, '، ' order by cs.sort) from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = c.id),
         c.total_amount, c.start_date, c.end_date,
         case when c.start_date is not null and c.end_date is not null then c.end_date - c.start_date + 1 end,
         case when c.end_date is not null then greatest(c.end_date - app._today(), 0) end,
         coalesce(i.n, 0), coalesce(i.due, 0), c.total_amount - coalesce(i.due, 0), i.next_due, i.next_amount, i.last_due, coalesce(i.sched, '[]'::jsonb)
    from contracts c join clients cl on cl.id = c.client_id
    left join lateral (
      select count(*)::int n,
             sum(p.amount) filter (where p.due_date <= app._today()) due,
             min(p.due_date) filter (where p.due_date > app._today()) next_due,
             (select p2.amount from payment_installments p2 where p2.contract_id = c.id and p2.due_date > app._today() order by p2.due_date, p2.seq limit 1) next_amount,
             max(p.due_date) last_due,
             jsonb_agg(jsonb_build_object('seq', p.seq, 'kind', p.kind, 'due_date', p.due_date, 'amount', p.amount, 'due', p.due_date <= app._today()) order by p.seq) sched
        from payment_installments p where p.contract_id = c.id) i on true
   where app._fin_ok() and c.status in ('approved','submitted')
   order by c.total_amount desc, c.created_at
   limit 500
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
