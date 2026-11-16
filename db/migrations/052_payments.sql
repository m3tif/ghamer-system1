-- 052: recording actual payments. Finance records each payment that arrived (amount, date, method, reference, receipt);
-- the Finance Manager confirms it (or rejects it with a reason). Only confirmed payments count as collected.
-- A confirmed payment is never edited or deleted; confirmed payments can never add up to more than the contract value.
begin;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id),
  installment_seq int,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null,
  method text not null check (method in ('tabby','tamara','bank_transfer')),
  reference text check (length(reference) <= 200),
  note text check (length(note) <= 1000),
  receipt_id uuid references attachments(id),
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  recorded_by uuid not null references employees(id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references employees(id),
  verified_at timestamptz,
  reject_reason text check (length(reject_reason) <= 1000),
  request_id uuid unique
);
create index if not exists payments_contract on payments(contract_id, status);
alter table payments enable row level security;
revoke all on payments from ghamer_app;
drop trigger if exists audit_payments on payments;
create trigger audit_payments after insert or update or delete on payments for each row execute function app.audit_row();

create or replace function app.payment_record(p_contract uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare c contracts; v_id uuid; v_amt numeric := round(nullif(p->>'amount','')::numeric, 2); v_req uuid := nullif(p->>'request_id','')::uuid;
        v_rec uuid := nullif(p->>'receipt_id','')::uuid; v_ok boolean := coalesce((p->>'verify')::boolean, false) and app.has_perm('finance.verify'); u record;
begin
  if not app.has_perm('finance.record') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_req is not null then select id into v_id from payments where request_id = v_req; if found then return v_id; end if; end if;   -- pressed twice
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  if c.status not in ('submitted','approved','returned') then raise exception 'payments need a contract sent to Finance'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'payment amount must be greater than zero'; end if;
  if nullif(p->>'paid_at','') is null or (p->>'paid_at')::date > app._today() then raise exception 'invalid payment date'; end if;
  if coalesce(p->>'method','') not in ('tabby','tamara','bank_transfer') then raise exception 'invalid payment method'; end if;
  if v_rec is not null and not exists (select 1 from attachments a where a.id = v_rec and a.entity_type = 'contract' and a.entity_id = c.id) then raise exception 'invalid receipt'; end if;
  if (select coalesce(sum(amount), 0) from payments where contract_id = c.id and status in ('verified','pending')) + v_amt > c.total_amount then
    raise exception 'payments exceed the contract value'; end if;
  perform set_config('app.reason', 'تسجيل دفعة', true);
  insert into payments(contract_id, installment_seq, amount, paid_at, method, reference, note, receipt_id, recorded_by, request_id, status, verified_by, verified_at)
  values (c.id, nullif(p->>'installment_seq','')::int, v_amt, (p->>'paid_at')::date, p->>'method', nullif(btrim(p->>'reference'),''), nullif(btrim(p->>'note'),''), v_rec,
          app.me(), v_req, case when v_ok then 'verified' else 'pending' end, case when v_ok then app.me() end, case when v_ok then now() end)
  returning id into v_id;
  if not v_ok then
    for u in select us.id from users us join roles r on r.id = us.role_id where r.code = 'finance_manager' and us.is_active and us.id <> app.me() loop
      perform app._notify(u.id, 'payment_recorded', 'دفعة مستنية تأكيدك', c.contract_no || ' — ' || v_amt || ' ريال', '/contracts/' || c.id, 'payrec:' || v_id);
    end loop;
  end if;
  return v_id;
end $$;

create or replace function app.payment_decide(p_payment uuid, p_ok boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare y payments; c contracts;
begin
  if not app.has_perm('finance.verify') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into y from payments where id = p_payment for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  if (p_ok and y.status = 'verified') or (not p_ok and y.status = 'rejected') then return; end if;   -- pressed twice
  if y.status <> 'pending' then raise exception 'payment already decided'; end if;
  if not p_ok and coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into c from contracts where id = y.contract_id for update;
  if p_ok and (select coalesce(sum(amount), 0) from payments where contract_id = c.id and status = 'verified') + y.amount > c.total_amount then
    raise exception 'payments exceed the contract value'; end if;
  perform set_config('app.reason', coalesce(nullif(btrim(p_reason),''), 'تأكيد دفعة'), true);
  update payments set status = case when p_ok then 'verified' else 'rejected' end, verified_by = app.me(), verified_at = now(),
         reject_reason = case when p_ok then null else btrim(p_reason) end where id = y.id;
  if y.recorded_by <> app.me() then
    perform app._notify(y.recorded_by, case when p_ok then 'payment_verified' else 'payment_rejected' end,
      case when p_ok then 'الدفعة اتأكدت ✓' else 'الدفعة اترفضت' end, c.contract_no || ' — ' || y.amount || ' ريال' || coalesce(' — ' || nullif(btrim(p_reason),''), ''), '/contracts/' || c.id, 'paydec:' || y.id);
  end if;
end $$;

create or replace function app.payment_list(p_contract uuid)
returns table(id uuid, installment_seq int, amount numeric, paid_at date, method text, reference text, note text, receipt_id uuid, receipt_name text, status text,
              recorded_by text, recorded_at timestamptz, verified_by text, verified_at timestamptz, reject_reason text)
language sql stable security definer set search_path = public, app as $$
  select y.id, y.installment_seq, y.amount, y.paid_at, y.method, y.reference, y.note, y.receipt_id, a.filename, y.status,
         app.emp_name(y.recorded_by), y.recorded_at, app.emp_name(y.verified_by), y.verified_at, y.reject_reason
    from payments y join contracts c on c.id = y.contract_id left join attachments a on a.id = y.receipt_id
   where y.contract_id = p_contract and app.contract_visible(c.sales_owner_id, c.status)
   order by y.paid_at desc, y.recorded_at desc
$$;

drop function if exists app.finance_clients();
create function app.finance_clients()
returns table(contract_id uuid, contract_no text, client_name text, business_name text, status text, packages text, total_amount numeric,
              start_date date, end_date date, days_total int, days_left int, inst_count int, due_so_far numeric, remaining numeric,
              next_due date, next_amount numeric, last_due date, schedule jsonb, paid numeric, overdue numeric, pending_payments int)
language sql stable security definer set search_path = public, app as $$
  select c.id, c.contract_no, cl.name, cl.business_name, c.status,
         (select string_agg(sv.name_ar, '، ' order by cs.sort) from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = c.id),
         c.total_amount, c.start_date, c.end_date,
         case when c.start_date is not null and c.end_date is not null then c.end_date - c.start_date + 1 end,
         case when c.end_date is not null then greatest(c.end_date - app._today(), 0) end,
         coalesce(i.n, 0), coalesce(i.due, 0), c.total_amount - coalesce(pd.paid, 0), i.next_due, i.next_amount, i.last_due, coalesce(i.sched, '[]'::jsonb),
         coalesce(pd.paid, 0), greatest(coalesce(i.due, 0) - coalesce(pd.paid, 0), 0), coalesce(pd.pending, 0)
    from contracts c join clients cl on cl.id = c.client_id
    left join lateral (
      select count(*)::int n,
             sum(p.amount) filter (where p.due_date <= app._today()) due,
             min(p.due_date) filter (where p.due_date > app._today()) next_due,
             (select p2.amount from payment_installments p2 where p2.contract_id = c.id and p2.due_date > app._today() order by p2.due_date, p2.seq limit 1) next_amount,
             max(p.due_date) last_due,
             jsonb_agg(jsonb_build_object('seq', p.seq, 'kind', p.kind, 'due_date', p.due_date, 'amount', p.amount, 'due', p.due_date <= app._today()) order by p.seq) sched
        from payment_installments p where p.contract_id = c.id) i on true
    left join lateral (select sum(y.amount) filter (where y.status = 'verified') paid, count(*) filter (where y.status = 'pending')::int pending from payments y where y.contract_id = c.id) pd on true
   where app._fin_ok() and c.status in ('approved','submitted')
   order by c.total_amount desc, c.created_at
   limit 500
$$;

create or replace function app.finance_dashboard(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  tz text := app.company_tz();
  d0 date := coalesce(p_from, date_trunc('month', app._today())::date);
  d1 date := greatest(coalesce(p_to, app._today()), coalesce(p_from, date_trunc('month', app._today())::date));
  n int; pd0 date; pd1 date; s timestamptz; e timestamptz; ps timestamptz; pe timestamptz; ts timestamptz; te timestamptz;
begin
  if not app._fin_ok() then raise exception 'no access' using errcode = '42501'; end if;
  if d1 - d0 > 366 then raise exception 'period too long'; end if;
  n := d1 - d0 + 1; pd1 := d0 - 1; pd0 := d0 - n;
  s := d0::timestamp at time zone tz; e := (d1 + 1)::timestamp at time zone tz;
  ps := pd0::timestamp at time zone tz; pe := s;
  ts := app._today()::timestamp at time zone tz; te := (app._today() + 1)::timestamp at time zone tz;
  return jsonb_build_object(
    'from', d0, 'to', d1, 'prev_from', pd0, 'prev_to', pd1, 'days', n, 'tz', tz,
    'kpi', (select jsonb_build_object(
        'total_clients', (select count(*) from leads),
        'added_today', (select count(*) from leads where created_at >= ts and created_at < te),
        'added', (select count(*) from leads where created_at >= s and created_at < e),
        'added_prev', (select count(*) from leads where created_at >= ps and created_at < pe),
        'distributed', (select count(*) from (select a.lead_id from lead_assignments a join leads l on l.id = a.lead_id
              where a.kind = 'owner' and a.assigned_by <> a.to_employee_id and l.original_creator_id <> a.to_employee_id
              group by a.lead_id having min(a.created_at) >= s and min(a.created_at) < e) x),
        'distributed_prev', (select count(*) from (select a.lead_id from lead_assignments a join leads l on l.id = a.lead_id
              where a.kind = 'owner' and a.assigned_by <> a.to_employee_id and l.original_creator_id <> a.to_employee_id
              group by a.lead_id having min(a.created_at) >= ps and min(a.created_at) < pe) x),
        'handed', (select count(distinct lead_id) from lead_handoffs where handed_at >= s and handed_at < e),
        'handed_prev', (select count(distinct lead_id) from lead_handoffs where handed_at >= ps and handed_at < pe),
        'accepted', (select count(*) from (select distinct on (lead_id) status from lead_handoffs where handed_at >= s and handed_at < e order by lead_id, handed_at desc) h where h.status = 'accepted'),
        'rejected', (select count(*) from (select distinct on (lead_id) status from lead_handoffs where handed_at >= s and handed_at < e order by lead_id, handed_at desc) h where h.status = 'rejected'),
        'pending', (select count(*) from (select distinct on (lead_id) status from lead_handoffs where handed_at >= s and handed_at < e order by lead_id, handed_at desc) h where h.status like 'pending%'),
        'meeting_leads', (select count(distinct lead_id) from meetings where created_at >= s and created_at < e),
        'meeting_leads_prev', (select count(distinct lead_id) from meetings where created_at >= ps and created_at < pe),
        'meetings_done', (select count(*) from meetings where status = 'Completed' and completed_at >= s and completed_at < e),
        'contracts_new', (select count(*) from contracts where status <> 'cancelled' and created_at >= s and created_at < e),
        'contracts_new_prev', (select count(*) from contracts where status <> 'cancelled' and created_at >= ps and created_at < pe),
        'contracts_approved', (select count(*) from contracts where status = 'approved' and approved_at >= s and approved_at < e),
        'contracts_approved_prev', (select count(*) from contracts where status = 'approved' and approved_at >= ps and approved_at < pe),
        'approved_value', (select coalesce(sum(total_amount), 0) from contracts where status = 'approved' and approved_at >= s and approved_at < e),
        'approved_value_prev', (select coalesce(sum(total_amount), 0) from contracts where status = 'approved' and approved_at >= ps and approved_at < pe),
        'collected', (select coalesce(sum(amount), 0) from payments where status = 'verified' and paid_at >= d0 and paid_at <= d1),
        'collected_prev', (select coalesce(sum(amount), 0) from payments where status = 'verified' and paid_at >= pd0 and paid_at <= pd1))),
    'contracts', (select jsonb_build_object(
        'total', count(*) filter (where status <> 'cancelled'),
        'draft', count(*) filter (where status = 'draft'),
        'submitted', count(*) filter (where status = 'submitted'),
        'returned', count(*) filter (where status = 'returned'),
        'approved', count(*) filter (where status = 'approved'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'late', count(*) filter (where status = 'submitted' and submitted_at < now() - interval '48 hours'),
        'value_waiting', coalesce(sum(total_amount) filter (where status = 'submitted'), 0),
        'value_approved', coalesce(sum(total_amount) filter (where status = 'approved'), 0),
        'collected_all', (select coalesce(sum(amount), 0) from payments where status = 'verified'),
        'payments_pending', (select count(*) from payments where status = 'pending')) from contracts),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('s', x.s, 'n', x.n) order by x.n desc), '[]') from (select lead_status s, count(*)::int n from leads group by 1) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', g.d,
        'added', (select count(*) from leads l where l.created_at >= g.d::timestamp at time zone tz and l.created_at < (g.d + 1)::timestamp at time zone tz),
        'handed', (select count(distinct h.lead_id) from lead_handoffs h where h.handed_at >= g.d::timestamp at time zone tz and h.handed_at < (g.d + 1)::timestamp at time zone tz),
        'meetings', (select count(distinct m.lead_id) from meetings m where m.created_at >= g.d::timestamp at time zone tz and m.created_at < (g.d + 1)::timestamp at time zone tz),
        'contracts', (select count(*) from contracts c where c.status <> 'cancelled' and c.created_at >= g.d::timestamp at time zone tz and c.created_at < (g.d + 1)::timestamp at time zone tz)) order by g.d), '[]')
        from (select generate_series(d0, d1, interval '1 day')::date d) g),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('m', g.m,
        'added', (select count(*) from leads l where l.created_month = g.m),
        'contracts', (select count(*) from contracts c where c.status <> 'cancelled' and c.created_at >= g.m::timestamp at time zone tz and c.created_at < (g.m + interval '1 month')::timestamp at time zone tz),
        'approved', (select count(*) from contracts c where c.status = 'approved' and c.approved_at >= g.m::timestamp at time zone tz and c.approved_at < (g.m + interval '1 month')::timestamp at time zone tz)) order by g.m), '[]')
        from (select (date_trunc('month', app._today()) - make_interval(months => k))::date m from generate_series(0, 5) k) g),
    'employees', (select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc, x.full_name), '[]') from (
        select y.*, (y.added + y.received + y.handed * 3 + y.meetings * 5 + y.contracts * 10) score from (
          select emp.id, emp.full_name, r.code role_code, r.name_ar role_name,
            (select count(*)::int from leads l where l.original_creator_id = emp.id and l.created_at >= s and l.created_at < e) added,
            (select count(*)::int from (select a.lead_id from lead_assignments a join leads l on l.id = a.lead_id
                where a.kind = 'owner' and a.to_employee_id = emp.id and a.assigned_by <> emp.id and l.original_creator_id <> emp.id
                group by a.lead_id having min(a.created_at) >= s and min(a.created_at) < e) q) received,
            (select count(distinct h.lead_id)::int from lead_handoffs h where h.from_employee_id = emp.id and h.handed_at >= s and h.handed_at < e) handed,
            (select count(*)::int from meetings m where m.status = 'Completed' and m.completed_at >= s and m.completed_at < e
                and (m.tele_sales_id = emp.id or m.sales_rep_id = emp.id)) meetings,
            (select count(*)::int from contracts c where c.status <> 'cancelled' and c.created_at >= s and c.created_at < e
                and (c.sales_owner_id = emp.id or c.tele_sales_id = emp.id)) contracts,
            (select count(*)::int from contracts c where c.status = 'approved' and c.approved_at >= s and c.approved_at < e
                and (c.sales_owner_id = emp.id or c.tele_sales_id = emp.id)) contracts_approved
          from employees emp join users u on u.id = emp.id join roles r on r.id = u.role_id
          where u.is_active and r.code in ('tele_sales','tele_sales_manager','sales_rep','sales_manager')) y) x),
    'attention', jsonb_build_object(
        'payments', (select coalesce(jsonb_agg(to_jsonb(w) order by w.recorded_at), '[]') from (
            select y.id, y.contract_id, c.contract_no, cl.name client_name, y.amount, y.paid_at, y.method, app.emp_name(y.recorded_by) recorded_by, y.recorded_at
              from payments y join contracts c on c.id = y.contract_id join clients cl on cl.id = c.client_id where y.status = 'pending' order by y.recorded_at limit 20) w),
        'waiting', (select coalesce(jsonb_agg(to_jsonb(w) order by w.submitted_at), '[]') from (
            select c.id, c.contract_no, cl.name client_name, app.emp_name(c.sales_owner_id) sales_name, c.total_amount, c.submitted_at,
                   (c.submitted_at < now() - interval '48 hours') late
              from contracts c join clients cl on cl.id = c.client_id where c.status = 'submitted' order by c.submitted_at limit 20) w),
        'returned', (select coalesce(jsonb_agg(to_jsonb(w) order by w.returned_at desc), '[]') from (
            select c.id, c.contract_no, cl.name client_name, app.emp_name(c.sales_owner_id) sales_name, c.returned_at, c.return_reason
              from contracts c join clients cl on cl.id = c.client_id where c.status = 'returned' order by c.returned_at desc limit 20) w),
        'recent', (select coalesce(jsonb_agg(to_jsonb(w) order by w.at desc), '[]') from (
            select c.id, c.contract_no, cl.name client_name, c.status, c.updated_at at, app.emp_name(c.updated_by) by
              from contracts c join clients cl on cl.id = c.client_id order by c.updated_at desc limit 10) w)));
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
