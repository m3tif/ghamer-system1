-- 024: hiding an employee's data now hides EVERYTHING that employee works on, not only what she added herself:
-- leads she created, leads currently owned by her (e.g. distributed to her by the admin) and leads assigned to her as Sales.
-- Also: a lead that is created for / re-assigned to an employee whose period is hidden is hidden at once, and the active hides are applied to what was missed.
-- Reversible exactly as before (restore un-hides what that hide action hid). Nothing is deleted.

create or replace function app._hide_new_lead() returns trigger language plpgsql security definer set search_path = public, app as $$
declare p record; v_day date := (NEW.created_at at time zone app.company_tz())::date;
begin
  if NEW.hidden_at is not null then return NEW; end if;
  select * into p from hidden_periods h where h.restored_at is null and v_day between h.period_start and h.period_end
     and (h.employee_id is null or h.employee_id in (NEW.original_creator_id, NEW.current_owner_id, NEW.assigned_sales_id)) order by h.created_at limit 1;
  if found then NEW.hidden_at := now(); NEW.hidden_by := p.created_by; NEW.hidden_reason := p.reason; NEW.hidden_period_id := p.id; end if;
  return NEW;
end $$;

drop trigger if exists leads_hide_new on leads;
create trigger leads_hide_new before insert on leads for each row execute function app._hide_new_lead();
drop trigger if exists leads_hide_reassigned on leads;
create trigger leads_hide_reassigned before update of current_owner_id, assigned_sales_id on leads for each row
  when (OLD.hidden_at is null and (NEW.current_owner_id is distinct from OLD.current_owner_id or NEW.assigned_sales_id is distinct from OLD.assigned_sales_id))
  execute function app._hide_new_lead();

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
        and (p_emp is null or l.original_creator_id = p_emp or l.current_owner_id = p_emp or l.assigned_sales_id = p_emp);
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

create or replace function app.hide_overview(p_scope text, p_year int, p_month int, p_emp uuid default null)
returns table(period date, total int, hidden int, rule_active boolean)
language sql stable security definer set search_path = public, app as $$
  with src as (
    select case when p_scope = 'day' then (l.created_at at time zone app.company_tz())::date else date_trunc('month', l.created_at at time zone app.company_tz())::date end as d, l.hidden_at
    from leads l where app.is_admin() and (p_emp is null or l.original_creator_id = p_emp or l.current_owner_id = p_emp or l.assigned_sales_id = p_emp)
      and (l.created_at at time zone app.company_tz())::date between
          (case when p_scope = 'day' then make_date(p_year, p_month, 1) else make_date(p_year, 1, 1) end)
      and (case when p_scope = 'day' then (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date else make_date(p_year, 12, 31) end))
  select s.d, count(*)::int, count(s.hidden_at)::int,
         exists (select 1 from hidden_periods h where h.restored_at is null and h.scope = p_scope and h.period_start = s.d and h.employee_id is not distinct from p_emp)
  from src s group by s.d order by s.d
$$;

create or replace function app.hide_leads_month(p_emp uuid, p_month date, p_hidden boolean, p_reason text) returns int
language plpgsql security definer set search_path = public, app as $$
declare r record; n int := 0;
begin
  if app.me() is null or not app.can_see_hidden() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_emp is null or p_month is null then raise exception 'employee and month required'; end if;
  for r in select l.id from leads l
           where (l.original_creator_id = p_emp or l.current_owner_id = p_emp or l.assigned_sales_id = p_emp) and l.created_month = date_trunc('month', p_month)::date
             and ((p_hidden and l.hidden_at is null) or (not p_hidden and l.hidden_at is not null))
             and app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at) loop
    perform app.set_lead_hidden(r.id, p_hidden, p_reason);
    n := n + 1;
  end loop;
  return n;
end $$;

-- apply the hides that are already active to the leads they missed
with upd as (
  update leads l set hidden_at = now(), hidden_by = h.created_by, hidden_reason = h.reason, hidden_period_id = h.id
    from hidden_periods h
   where h.restored_at is null and h.employee_id is not null and l.hidden_at is null
     and (l.created_at at time zone app.company_tz())::date between h.period_start and h.period_end
     and (l.current_owner_id = h.employee_id or l.assigned_sales_id = h.employee_id)
  returning h.id)
update hidden_periods hp set affected = hp.affected + c.n from (select id, count(*)::int n from upd group by id) c where c.id = hp.id;

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

