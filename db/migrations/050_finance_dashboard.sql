-- 050: Finance Manager dashboard. Read-only aggregates for the Finance Manager (and admins), computed with the same
-- definitions as the admin overview (034): added = lead created in the period by its original creator; distributed =
-- first owner assignment by someone else to a lead the employee did not create; handed = distinct leads sent to Sales.
-- The Finance Manager gets numbers, not client lists: no new permission is granted on leads or employees.
begin;

create or replace function app._fin_ok() returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and (app.is_admin() or app.role_code() = 'finance_manager')
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
        'approved_value_prev', (select coalesce(sum(total_amount), 0) from contracts where status = 'approved' and approved_at >= ps and approved_at < pe))),
    'contracts', (select jsonb_build_object(
        'total', count(*) filter (where status <> 'cancelled'),
        'draft', count(*) filter (where status = 'draft'),
        'submitted', count(*) filter (where status = 'submitted'),
        'returned', count(*) filter (where status = 'returned'),
        'approved', count(*) filter (where status = 'approved'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'late', count(*) filter (where status = 'submitted' and submitted_at < now() - interval '48 hours'),
        'value_waiting', coalesce(sum(total_amount) filter (where status = 'submitted'), 0),
        'value_approved', coalesce(sum(total_amount) filter (where status = 'approved'), 0)) from contracts),
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

-- contracts table for the dashboard and its CSV export: search, status, employee and date filters
create or replace function app.finance_contracts(p_q text, p_status text, p_emp uuid, p_from date, p_to date, p_limit int, p_offset int)
returns table(id uuid, contract_no text, client_name text, business_name text, phone text, sales_name text, tele_name text, status text, total_amount numeric,
              packages text, created_at timestamptz, updated_at timestamptz, submitted_at timestamptz, approved_at timestamptz, start_date date, end_date date, total bigint)
language sql stable security definer set search_path = public, app as $$
  with f as (
    select c.*, cl.name cname, cl.business_name bname, cl.search_norm,
           (select cc.phone from client_contacts cc where cc.client_id = cl.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1) ph
      from contracts c join clients cl on cl.id = c.client_id
     where app._fin_ok()
       and (p_status is null or c.status = p_status)
       and (p_emp is null or c.sales_owner_id = p_emp or c.tele_sales_id = p_emp)
       and (p_from is null or c.created_at >= p_from::timestamp at time zone app.company_tz())
       and (p_to is null or c.created_at < (p_to + 1)::timestamp at time zone app.company_tz())
       and (coalesce(btrim(p_q), '') = '' or c.contract_no ilike '%' || btrim(p_q) || '%' or cl.search_norm like '%' || app.ar_norm(btrim(p_q)) || '%'
            or exists (select 1 from client_contacts cc where cc.client_id = cl.id and regexp_replace(coalesce(cc.phone,''), '\D', '', 'g') like '%' || nullif(regexp_replace(regexp_replace(btrim(p_q), '\D', '', 'g'), '^0+', ''), '') || '%')))
  select f.id, f.contract_no, f.cname, f.bname, f.ph, app.emp_name(f.sales_owner_id), app.emp_name(f.tele_sales_id), f.status, f.total_amount,
         (select string_agg(sv.name_ar, '، ' order by cs.sort) from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = f.id),
         f.created_at, f.updated_at, f.submitted_at, f.approved_at, f.start_date, f.end_date, count(*) over()
    from f order by f.updated_at desc limit least(coalesce(p_limit, 50), 5000) offset coalesce(p_offset, 0)
$$;

-- employees the filter offers (names only)
create or replace function app.finance_employees() returns table(id uuid, full_name text, role_name text)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, r.name_ar from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
   where app._fin_ok() and r.code in ('tele_sales','tele_sales_manager','sales_rep','sales_manager') order by r.name_ar, e.full_name
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
