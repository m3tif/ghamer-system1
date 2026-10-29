-- 013: daily results report (company time zone), hide/restore a whole day / month / year (reversible, logged), live-refresh fingerprint.
-- Nothing is deleted or re-assigned. Hidden data stays fully visible to Admin / GM.

-- ───────── 1) hide periods ─────────
create table if not exists hidden_periods (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('day','month','year')),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  employee_id uuid references employees(id),           -- null = all employees
  reason text,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  restored_by uuid references employees(id),
  restored_at timestamptz,
  affected int not null default 0
);
create unique index if not exists hidden_periods_active_uq on hidden_periods(scope, period_start, coalesce(employee_id, '00000000-0000-0000-0000-000000000000')) where restored_at is null;
alter table leads add column if not exists hidden_period_id uuid references hidden_periods(id);
create index if not exists leads_hidden_period_idx on leads(hidden_period_id) where hidden_period_id is not null;
alter table hidden_periods enable row level security;
drop policy if exists hidden_periods_admin_read on hidden_periods;
create policy hidden_periods_admin_read on hidden_periods for select using ((select app.is_admin()));
grant select on hidden_periods to ghamer_app;
drop trigger if exists audit_hidden_periods on hidden_periods;
create trigger audit_hidden_periods after insert or update on hidden_periods for each row execute function app.audit_row();

-- a lead created inside an already-hidden period is hidden from the start (so the rule keeps holding, e.g. imported old data)
create or replace function app._hide_new_lead() returns trigger language plpgsql security definer set search_path = public, app as $$
declare p record; v_day date := (NEW.created_at at time zone app.company_tz())::date;
begin
  if NEW.hidden_at is not null then return NEW; end if;
  select * into p from hidden_periods h where h.restored_at is null and v_day between h.period_start and h.period_end
     and (h.employee_id is null or h.employee_id = NEW.original_creator_id) order by h.created_at limit 1;
  if found then NEW.hidden_at := now(); NEW.hidden_by := p.created_by; NEW.hidden_reason := p.reason; NEW.hidden_period_id := p.id; end if;
  return NEW;
end $$;
drop trigger if exists leads_hide_new on leads;
create trigger leads_hide_new before insert on leads for each row execute function app._hide_new_lead();

-- p_hidden = true  → hide every lead (of one employee, or all) created in the day / month / year
-- p_hidden = false → restore exactly what that hide action hid (leads hidden one-by-one stay hidden)
create or replace function app.hide_period(p_scope text, p_start date, p_emp uuid, p_hidden boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_from date; v_to date; v_pid uuid; n int := 0; p record;
begin
  if not app.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_scope not in ('day','month','year') or p_start is null then raise exception 'invalid period'; end if;
  v_from := case p_scope when 'day' then p_start when 'month' then date_trunc('month', p_start)::date else date_trunc('year', p_start)::date end;
  v_to   := case p_scope when 'day' then p_start when 'month' then (date_trunc('month', p_start) + interval '1 month - 1 day')::date else (date_trunc('year', p_start) + interval '1 year - 1 day')::date end;
  if p_emp is not null and not exists (select 1 from employees where id = p_emp) then raise exception 'not found or no access'; end if;
  if p_hidden then
    if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
    select id into v_pid from hidden_periods where restored_at is null and scope = p_scope and period_start = v_from and employee_id is not distinct from p_emp;
    if v_pid is null then
      insert into hidden_periods(scope, period_start, period_end, employee_id, reason, created_by) values (p_scope, v_from, v_to, p_emp, btrim(p_reason), app.me()) returning id into v_pid;
    end if;
    perform set_config('app.reason', 'إخفاء ' || p_scope || ': ' || p_reason, true);
    update leads l set hidden_at = now(), hidden_by = app.me(), hidden_reason = btrim(p_reason), hidden_period_id = v_pid
      where l.hidden_at is null and (l.created_at at time zone app.company_tz())::date between v_from and v_to
        and (p_emp is null or l.original_creator_id = p_emp);
    get diagnostics n = row_count;
    update hidden_periods set affected = affected + n where id = v_pid;
  else
    perform set_config('app.reason', 'إظهار ' || p_scope, true);
    for p in select id from hidden_periods where restored_at is null and scope = p_scope and period_start = v_from and employee_id is not distinct from p_emp loop
      update leads set hidden_at = null, hidden_by = null, hidden_reason = null, hidden_period_id = null where hidden_period_id = p.id;
      get diagnostics n = row_count;
      update hidden_periods set restored_at = now(), restored_by = app.me() where id = p.id;
      v_pid := p.id;
    end loop;
  end if;
  return jsonb_build_object('period_id', v_pid, 'affected', n);
end $$;

-- calendar overview for the admin page: per day of a month (or per month of a year): how many leads, how many hidden
create or replace function app.hide_overview(p_scope text, p_year int, p_month int, p_emp uuid default null)
returns table(period date, total int, hidden int, rule_active boolean)
language sql stable security definer set search_path = public, app as $$
  with src as (
    select case when p_scope = 'day' then (l.created_at at time zone app.company_tz())::date else date_trunc('month', l.created_at at time zone app.company_tz())::date end as d, l.hidden_at
    from leads l where app.is_admin() and (p_emp is null or l.original_creator_id = p_emp)
      and (l.created_at at time zone app.company_tz())::date between
          (case when p_scope = 'day' then make_date(p_year, p_month, 1) else make_date(p_year, 1, 1) end)
      and (case when p_scope = 'day' then (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date else make_date(p_year, 12, 31) end))
  select s.d, count(*)::int, count(s.hidden_at)::int,
         exists (select 1 from hidden_periods h where h.restored_at is null and h.scope = p_scope and h.period_start = s.d and h.employee_id is not distinct from p_emp)
  from src s group by s.d order by s.d
$$;

create or replace function app.hide_log(p_limit int default 100)
returns table(id uuid, scope text, period_start date, period_end date, employee_name text, reason text, created_by_name text, created_at timestamptz,
              restored_by_name text, restored_at timestamptz, affected int)
language sql stable security definer set search_path = public, app as $$
  select h.id, h.scope, h.period_start, h.period_end, case when h.employee_id is null then null else app.emp_name(h.employee_id) end, h.reason,
         app.emp_name(h.created_by), h.created_at, app.emp_name(h.restored_by), h.restored_at, h.affected
  from hidden_periods h where app.is_admin() order by h.created_at desc limit least(coalesce(p_limit, 100), 500)
$$;

-- ───────── 2) daily results (every number comes from the real event time, in the company time zone) ─────────
create or replace function app.daily_report(p_day date)
returns table(emp_id uuid, emp_name text, family text, added int, contacted int, handed int, accepted int, rejected int, received int, meetings_booked int)
language sql stable security definer set search_path = public, app as $$
  with tz as (select app.company_tz() z),
  emps as (
    select e.id, e.full_name,
           case when r.code in ('tele_sales','tele_sales_manager') then 'tele' when r.code in ('sales_rep','sales_manager') then 'sales' end fam
    from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
    where app.is_admin() and r.code in ('tele_sales','tele_sales_manager','sales_rep','sales_manager') and (u.is_active or exists (select 1 from leads l where l.original_creator_id = e.id))),
  d(day) as (select coalesce(p_day, (now() at time zone app.company_tz())::date))
  select e.id, e.full_name, e.fam,
    (select count(*)::int from leads l, tz, d where l.original_creator_id = e.id and (l.created_at at time zone tz.z)::date = d.day),
    (select count(distinct a.lead_id)::int from lead_activities a, tz, d where a.created_by = e.id and a.kind in ('call','status_change') and (a.created_at at time zone tz.z)::date = d.day),
    (select count(*)::int from lead_handoffs h, tz, d where h.from_employee_id = e.id and (h.handed_at at time zone tz.z)::date = d.day),
    (select count(*)::int from lead_handoffs h, tz, d where h.status = 'accepted' and (h.decided_at at time zone tz.z)::date = d.day
        and ((e.fam = 'tele' and h.from_employee_id = e.id) or (e.fam = 'sales' and h.decided_by = e.id))),
    (select count(*)::int from lead_handoffs h, tz, d where h.status = 'rejected' and (h.decided_at at time zone tz.z)::date = d.day
        and ((e.fam = 'tele' and h.from_employee_id = e.id) or (e.fam = 'sales' and h.decided_by = e.id))),
    (select count(*)::int from lead_handoffs h, tz, d where e.fam = 'sales' and h.to_employee_id = e.id and (h.handed_at at time zone tz.z)::date = d.day),
    (select count(*)::int from meetings m, tz, d where (m.created_by = e.id) and (m.created_at at time zone tz.z)::date = d.day)
  from emps e order by e.fam, 4 desc, e.full_name
$$;

-- ───────── 3) live refresh: a cheap fingerprint of "what this user can see". It changes whenever visible data changes. ─────────
create or replace function app.pulse() returns jsonb
language sql stable security invoker set search_path = public, app as $$
  select jsonb_build_object(
    'leads', (select count(*) from leads), 'leads_at', (select max(updated_at) from leads),
    'act_at', (select max(created_at) from lead_activities),
    'handoffs', (select count(*) from lead_handoffs where status = 'pending_review'), 'handoffs_at', (select max(coalesce(decided_at, handed_at)) from lead_handoffs),
    'meetings_at', (select max(updated_at) from meetings), 'deals_at', (select max(updated_at) from deals),
    'notif', (select count(*) from notifications where read_at is null),
    'now', now())
$$;

-- privileges
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
