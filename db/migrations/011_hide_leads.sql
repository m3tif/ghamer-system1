-- 011: managers / admin can hide leads from Tele Sales and Sales (per lead, or a whole month of one employee). Reversible, logged, never deleted.
alter table leads add column if not exists hidden_at timestamptz;
alter table leads add column if not exists hidden_by uuid references employees(id);
alter table leads add column if not exists hidden_reason text;
create index if not exists leads_hidden_idx on leads(hidden_at) where hidden_at is not null;

-- who may see hidden leads: admin / GM and the two team managers (still limited to their own team by the normal rules)
create or replace function app.can_see_hidden() returns boolean language sql stable security definer set search_path = public as $$
  select app.is_admin() or app.role_code() in ('tele_sales_manager','sales_manager')
$$;
create or replace function app.lead_is_hidden(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select hidden_at is not null from leads where id = p_lead), false)
$$;

-- row level security: a hidden lead does not exist for anyone except managers / admin
drop policy if exists leads_read on leads;
create policy leads_read on leads for select to ghamer_app using (
  (hidden_at is null or (select app.can_see_hidden())) and (
  (select app.is_admin())
  or (current_owner_id = (select app.me()) and (handed_off_at is null or assigned_sales_id is not null))
  or assigned_sales_id = (select app.me())
  or (handed_off_at is null and original_creator_id = (select app.me()))
  or ((select app.role_code()) = 'tele_sales_manager' and (original_creator_id in (select app.team_ids()) or current_owner_id in (select app.team_ids())))
  or ((select app.role_code()) = 'sales_manager' and (current_owner_id in (select app.team_ids()) or assigned_sales_id in (select app.team_ids())))));
drop policy if exists leads_update on leads;
create policy leads_update on leads for update to ghamer_app
  using ((select app.has_perm('leads.edit')) and (hidden_at is null or (select app.can_see_hidden())) and (
    (select app.is_admin()) or (current_owner_id = (select app.me()) and (handed_off_at is null or assigned_sales_id is not null)) or assigned_sales_id = (select app.me())
    or (handed_off_at is null and original_creator_id = (select app.me()))
    or ((select app.role_code()) = 'tele_sales_manager' and (original_creator_id in (select app.team_ids()) or current_owner_id in (select app.team_ids())))
    or ((select app.role_code()) = 'sales_manager' and (current_owner_id in (select app.team_ids()) or assigned_sales_id in (select app.team_ids())))))
  with check ((select app.has_perm('leads.edit')) and app.lead_row_visible(original_creator_id, current_owner_id, assigned_sales_id, handed_off_at));

create or replace function app.lead_visible(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at)
                          and (l.hidden_at is null or app.can_see_hidden()) from leads l where l.id = p_lead), false)
$$;

-- the deal of a hidden lead is hidden from its Sales owner too
drop policy if exists deals_read on deals;
create policy deals_read on deals for select to ghamer_app using (
  (select app.is_admin()) or (
    (owner_sales_id = (select app.me()) and not app.lead_is_hidden(lead_id))
    or ((select app.role_code()) = 'sales_manager' and owner_sales_id in (select app.team_ids()))));

-- the old unused search function would bypass the hidden flag
drop function if exists app.search_leads(text, text, text, date, uuid, text, int, int);


create or replace function app.my_lead_outcomes()
returns table(lead_id uuid, client_name text, business_name text, lead_status text, handed_off_at timestamptz,
              handoff_status text, to_name text, decided_at timestamptz, meeting_status text, deal_outcome text)
language sql stable security definer set search_path = public, app as $$
  select l.id, c.name, c.business_name, l.lead_status, l.handed_off_at,
    (select h.status from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
    app.emp_name(l.assigned_sales_id),
    (select h.decided_at from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
    (select m.status from meetings m where m.lead_id = l.id order by m.created_at desc limit 1),
    (select case when d.stage in ('Signed / Finance Pending','Financially Approved') then 'won' when d.stage = 'Lost' then 'lost' else 'open' end
       from deals d where d.lead_id = l.id order by d.created_at desc limit 1)
  from leads l join clients c on c.id = l.client_id
  where app.me() is not null and l.original_creator_id = app.me() and l.handed_off_at is not null and l.hidden_at is null
  order by l.handed_off_at desc limit 300
$$;

create or replace function app.list_meetings(p_tab text, p_limit int)
returns table(id uuid, lead_id uuid, tele_sales_id uuid, sales_rep_id uuid, scheduled_at timestamptz, booking_notes text, status text,
              reschedule_count int, confirmed_at timestamptz, completed_at timestamptz, created_at timestamptz, updated_at timestamptz,
              title text, meeting_type text, outcome text, result_notes text, next_step text, next_step_at timestamptz, outcome_at timestamptz,
              meeting_url text, client_name text, business_name text, rep_name text, tele_name text, can_open_lead boolean)
language plpgsql stable security definer set search_path = public, app as $$
declare v_me uuid := app.me(); v_role text := app.role_code(); v_admin boolean := app.is_admin(); v_team uuid[] := array(select app.team_ids());
begin
  if v_me is null or v_role is null then return; end if;
  return query
  select m.id, m.lead_id, m.tele_sales_id, m.sales_rep_id, m.scheduled_at,
         case when a.actor then m.booking_notes end, m.status, m.reschedule_count, m.confirmed_at, m.completed_at, m.created_at, m.updated_at,
         m.title, m.meeting_type, m.outcome, case when a.actor then m.result_notes end, case when a.actor then m.next_step end, m.next_step_at, m.outcome_at,
         case when a.actor then m.meeting_url end, c.name, c.business_name, app.emp_name(m.sales_rep_id), app.emp_name(m.tele_sales_id),
         app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at)
  from meetings m join leads l on l.id = m.lead_id join clients c on c.id = l.client_id
  cross join lateral (select (m.sales_rep_id = v_me or v_admin or (v_role = 'sales_manager' and m.sales_rep_id = any(v_team))) as actor) a
  where (l.hidden_at is null or v_admin or v_role in ('tele_sales_manager','sales_manager'))
    and (v_admin or m.tele_sales_id = v_me or m.sales_rep_id = v_me
         or (v_role in ('tele_sales_manager','sales_manager') and (m.tele_sales_id = any(v_team) or m.sales_rep_id = any(v_team))))
    and case p_tab
          when 'upcoming'  then m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at >= now()
          when 'awaiting'  then m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at < now()
          when 'done'      then m.status in ('Completed','No Show')
          when 'cancelled' then m.status = 'Cancelled'
          else true end
  order by case when p_tab = 'upcoming' then m.scheduled_at end asc, m.scheduled_at desc
  limit least(coalesce(p_limit, 200), 500);
end $$;

create or replace function app.archive_leads(p_emp uuid, p_month date, p_status text, p_limit int, p_offset int)
returns table(lead_id uuid, client_name text, business_name text, lead_status text, created_at timestamptz, created_month date,
              creator_name text, owner_name text, handoff_status text, can_open boolean, total bigint)
language plpgsql stable security definer set search_path = public, app as $$
declare v_emp uuid := p_emp;
begin
  if v_emp is null and not app.is_admin() then v_emp := app.me(); end if;
  if v_emp is not null and not (app.me() = v_emp or app.is_admin() or app.is_report(v_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query
  select l.id, c.name, c.business_name, l.lead_status, l.created_at, l.created_month, app.emp_name(l.original_creator_id), app.emp_name(l.current_owner_id),
         (select h.status from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
         app.lead_visible(l.id), count(*) over()
  from leads l join clients c on c.id = l.client_id
  where (l.hidden_at is null or app.can_see_hidden())
    and (v_emp is null or l.original_creator_id = v_emp or l.assigned_sales_id = v_emp)
    and (p_month is null or l.created_month = p_month) and (p_status is null or l.lead_status = p_status)
  order by l.created_at desc limit least(coalesce(p_limit, 20), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- hide / unhide
create or replace function app.set_lead_hidden(p_lead uuid, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare l leads;
begin
  if app.me() is null or not app.can_see_hidden() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into l from leads where id = p_lead for update;
  if not found or not app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at) then
    raise exception 'no access' using errcode = '42501';
  end if;
  if p_hidden then
    update leads set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, app.me()), hidden_reason = nullif(btrim(p_reason),'') where id = p_lead;
  else
    update leads set hidden_at = null, hidden_by = null, hidden_reason = null where id = p_lead;
  end if;
  insert into lead_activities(lead_id, kind, note, created_by)
    values (p_lead, 'note', case when p_hidden then 'تم إخفاء العميل عن الموظفين' else 'تم إظهار العميل للموظفين من جديد' end
                            || coalesce(' — ' || nullif(btrim(p_reason),''), ''), app.me());
end $$;

-- hide (or show again) everything one employee added in one month; returns how many leads changed
create or replace function app.hide_leads_month(p_emp uuid, p_month date, p_hidden boolean, p_reason text) returns int
language plpgsql security definer set search_path = public, app as $$
declare r record; n int := 0;
begin
  if app.me() is null or not app.can_see_hidden() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_emp is null or p_month is null then raise exception 'employee and month required'; end if;
  for r in select l.id from leads l
           where l.original_creator_id = p_emp and l.created_month = date_trunc('month', p_month)::date
             and ((p_hidden and l.hidden_at is null) or (not p_hidden and l.hidden_at is not null))
             and app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at) loop
    perform app.set_lead_hidden(r.id, p_hidden, p_reason);
    n := n + 1;
  end loop;
  return n;
end $$;

-- list_leads: new optional filter (visible | hidden | all); only managers / admin can ever receive hidden rows
drop function if exists app.list_leads(text, text, text, date, uuid, uuid, text, text, text, int, int);

create or replace function app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text,
                                          p_sort text, p_dir text, p_limit int, p_offset int, p_hidden text default 'visible')
returns table(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text,
              call_notes text, next_followup_at timestamptz, created_at timestamptz, last_contact_at timestamptz,
              original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean,
              dup_attempts int, total int, hidden_at timestamptz, hidden_by_name text, hidden_reason text)
language plpgsql stable security definer set search_path = public, app as $$
declare v_me uuid := app.me(); v_role text := app.role_code(); v_team uuid[] := array(select app.team_ids());
        v_pat text := '%' || replace(replace(replace(coalesce(p_q,''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
        v_dir text := case when p_dir = 'asc' then 'asc' else 'desc' end;
        v_ord text; v_ord2 text;
begin
  if v_me is null or v_role is null then return; end if;
  v_ord := case p_sort
    when 'name' then 'c.name ' || v_dir || ', l.created_at desc'
    when 'status' then 'l.lead_status ' || v_dir || ', l.created_at desc'
    when 'temperature' then 'l.lead_temperature ' || v_dir || ' nulls last, l.created_at desc'
    when 'followup' then 'l.next_followup_at ' || v_dir || ' nulls last, l.created_at desc'
    else 'l.created_at ' || v_dir end;
  v_ord2 := replace(replace(v_ord, 'c.name', 'f.name'), 'l.', 'f.');
  return query execute format($q$
    with f as (
      select l.id, l.client_id, c.name, c.business_name, l.lead_status, l.lead_temperature, l.call_notes, l.next_followup_at, l.created_at,
             l.last_contact_at, l.original_creator_id, l.assigned_sales_id, l.handed_off_at, l.hidden_at, l.hidden_by, l.hidden_reason, count(*) over()::int total
      from leads l join clients c on c.id = l.client_id
      where ($1::text is null or c.name ilike $2 or c.business_name ilike $2
             or c.id in (select s.client_id from client_stores s where s.url_raw ilike $2 or s.url_key ilike $2))
        and ($3::text is null or c.id in (select cc.client_id from client_contacts cc where cc.phone like $3))
        and ($4::text is null or l.lead_status = $4) and ($5::date is null or l.created_month = $5)
        and ($6::uuid is null or l.original_creator_id = $6) and ($7::uuid is null or l.assigned_sales_id = $7)
        and ($8::text is null or l.lead_temperature = $8)
        and (case when $14 then (case $15 when 'hidden' then l.hidden_at is not null when 'all' then true else l.hidden_at is null end) else l.hidden_at is null end)
        and ($9 in ('super_admin','general_manager')
             or (l.current_owner_id = $10 and (l.handed_off_at is null or l.assigned_sales_id is not null)) or l.assigned_sales_id = $10
             or (l.handed_off_at is null and l.original_creator_id = $10)
             or ($9 = 'tele_sales_manager' and (l.original_creator_id = any($11) or l.current_owner_id = any($11)))
             or ($9 = 'sales_manager' and (l.current_owner_id = any($11) or l.assigned_sales_id = any($11))))
      order by %s limit $12 offset $13)
    select f.id, f.client_id, f.name, f.business_name,
           (select cc.phone from client_contacts cc where cc.client_id = f.client_id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
           (select s.url_raw from client_stores s where s.client_id = f.client_id order by s.created_at limit 1),
           f.lead_status, f.lead_temperature, f.call_notes, f.next_followup_at, f.created_at, f.last_contact_at,
           f.original_creator_id, app.emp_name(f.original_creator_id), f.assigned_sales_id, app.emp_name(f.assigned_sales_id),
           (f.handed_off_at is not null),
           (select count(*)::int from lead_activities a where a.lead_id = f.id and a.kind = 'duplicate_attempt'),
           f.total, f.hidden_at, app.emp_name(f.hidden_by), f.hidden_reason
    from f
  order by %s
  $q$, v_ord, v_ord2)
  using nullif(btrim(p_q),''), v_pat, case when p_phone is null then null else '%' || p_phone || '%' end,
        p_status, p_month, p_creator, p_sales, p_temp, v_role, v_me, v_team,
        least(coalesce(p_limit, 25), 100), greatest(coalesce(p_offset, 0), 0), app.can_see_hidden(), coalesce(p_hidden,'visible');
end $$;

-- privileges (same rules as before)
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
