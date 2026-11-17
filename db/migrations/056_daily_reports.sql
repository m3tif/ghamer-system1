-- 056: optional daily report for the technical team (one per person per day, editable the same day).
-- Each person sees his own; the Technical Manager and the admins see everyone's.
begin;
create table if not exists daily_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  report_date date not null,
  body text not null check (length(btrim(body)) between 1 and 6000),
  links text check (length(links) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, report_date)
);
create index if not exists daily_reports_date on daily_reports(report_date);
alter table daily_reports enable row level security;
revoke all on daily_reports from ghamer_app;
drop trigger if exists audit_daily_reports on daily_reports;
create trigger audit_daily_reports after insert or update or delete on daily_reports for each row execute function app.audit_row('updated_at');

create or replace function app._report_viewer() returns boolean language sql stable security definer set search_path = public, app as $$
  select app.is_admin() or app.role_code() = 'operations_manager'
$$;

-- write / rewrite today's report (only today's; earlier days stay as they were sent)
create or replace function app.daily_report_save(p_body text, p_links text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app._tech_ops_role(app.role_code()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'report text required'; end if;
  insert into daily_reports(employee_id, report_date, body, links)
    values (app.me(), app._today(), btrim(p_body), nullif(btrim(p_links),''))
  on conflict (employee_id, report_date) do update set body = excluded.body, links = excluded.links, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- reports between two days; the viewer sees everyone (optionally one person), others only their own
create or replace function app.daily_report_list(p_from date, p_to date, p_emp uuid)
returns table(id uuid, employee_id uuid, full_name text, role_name text, report_date date, body text, links text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select d.id, d.employee_id, e.full_name, r.name_ar, d.report_date, d.body, d.links, d.created_at, d.updated_at
  from daily_reports d join employees e on e.id = d.employee_id join users u on u.id = e.id join roles r on r.id = u.role_id
  where d.report_date between coalesce(p_from, app._today() - 30) and coalesce(p_to, app._today())
    and (case when app._report_viewer() then (p_emp is null or d.employee_id = p_emp) else d.employee_id = app.me() end)
  order by d.report_date desc, e.full_name
  limit 1000
$$;

-- for the manager: the technical team with whether each one sent a report on a given day
create or replace function app.daily_report_team(p_day date)
returns table(employee_id uuid, full_name text, role_name text, sent boolean, sent_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, r.name_ar, d.id is not null, d.created_at
  from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
  left join daily_reports d on d.employee_id = e.id and d.report_date = coalesce(p_day, app._today())
  where app._report_viewer() and u.is_active and app._tech_ops_role(r.code) and r.code <> 'operations_manager'
  order by (d.id is null), e.full_name
$$;

-- what the person logged on his tasks today (helps him write the report)
create or replace function app.daily_report_my_tasks() returns table(task_id uuid, title text, client_name text, minutes int, status text)
language sql stable security definer set search_path = public, app as $$
  select t.id, t.title, c.name, (sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at))) / 60)::int, t.status
  from task_time_logs l join tasks t on t.id = l.task_id join client_operations o on o.id = t.ops_id left join clients c on c.id = o.client_id
  where l.employee_id = app.me() and (l.started_at at time zone app.company_tz())::date = app._today()
  group by t.id, t.title, c.name, t.status order by 4 desc
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
grant execute on function app._tech_ops_role(text) to ghamer_app;
revoke execute on function app._report_viewer() from ghamer_app;
commit;
