-- 034: full audit fixes — one definition per number, nothing "received" twice, nothing unreachable.
-- No lead / note / meeting / hand-off row is changed or deleted by this migration.
--
-- Definitions (used everywhere from now on):
--   added      = leads whose original creator is the employee (hidden ones still count: hiding is a display decision)
--   received   = leads that reached the employee from someone else (distribution, transfer, hand-off) and that she did NOT create
--   handed     = distinct leads the employee handed to Sales (not the number of hand-off operations)
--   months/days are always cut in the company time zone (app.company_tz()), never the connection's

-- (1) one place that answers "when did this lead reach this employee from someone else?"
create or replace function app._received_at(p_lead uuid, p_emp uuid) returns timestamptz language sql stable security definer set search_path = public, app as $$
  select min(a.created_at) from lead_assignments a join leads l on l.id = a.lead_id
   where a.lead_id = p_lead and a.kind = 'owner' and a.to_employee_id = p_emp and a.assigned_by <> p_emp and l.original_creator_id <> p_emp
$$;
create index if not exists lead_assignments_to_owner on lead_assignments(to_employee_id, lead_id) where kind = 'owner';

-- (2) a Tele manager also sees the leads her team handed to Sales (distributed data)
drop policy if exists leads_read on leads;
create policy leads_read on leads for select to ghamer_app using (
  (hidden_at is null or (select app.can_see_hidden())) and (
  (select app.is_admin())
  or (current_owner_id = (select app.me()) and (handed_off_at is null or assigned_sales_id is not null))
  or assigned_sales_id = (select app.me())
  or original_creator_id = (select app.me())
  or handed_by_id = (select app.me())
  or ((select app.role_code()) = 'tele_sales_manager' and (original_creator_id in (select app.team_ids()) or current_owner_id in (select app.team_ids()) or handed_by_id in (select app.team_ids())))
  or ((select app.role_code()) = 'sales_manager' and (current_owner_id in (select app.team_ids()) or assigned_sales_id in (select app.team_ids())))));

create or replace function app.lead_visible(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at) or l.handed_by_id = app.me()
                           or (app.role_code() = 'tele_sales_manager' and app.is_report(l.handed_by_id)))
                          and (l.hidden_at is null or app.can_see_hidden()) from leads l where l.id = p_lead), false)
$$;

CREATE OR REPLACE FUNCTION app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_hidden text, p_scope text)
 RETURNS TABLE(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text, call_notes text, next_followup_at timestamp with time zone, created_at timestamp with time zone, last_contact_at timestamp with time zone, original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean, dup_attempts integer, total integer, hidden_at timestamp with time zone, hidden_by_name text, hidden_reason text, pos double precision, colors jsonb, received_at timestamp with time zone, received_from text, batch_name text, source text, has_whatsapp boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare v_me uuid := app.me(); v_role text := app.role_code(); v_team uuid[] := array(select app.team_ids());
        v_pat text := '%' || replace(replace(replace(coalesce(p_q,''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
        v_dir text := case when p_dir = 'asc' then 'asc' else 'desc' end;
        v_ord text; v_ord2 text;
begin
  if v_me is null or v_role is null then return; end if;
  v_ord := case p_sort
    when 'name' then 'c.name ' || v_dir || ', l.created_at desc, l.seq asc'
    when 'status' then 'l.lead_status ' || v_dir || ', l.created_at desc, l.seq asc'
    when 'temperature' then 'l.lead_temperature ' || v_dir || ' nulls last, l.created_at desc, l.seq asc'
    when 'followup' then 'l.next_followup_at ' || v_dir || ' nulls last, l.created_at desc, l.seq asc'
    when 'manual' then 'm.pos asc nulls first, l.created_at desc, l.seq asc'
    else 'l.created_at ' || v_dir || ', l.seq asc' end;   -- l.seq: fixed number per lead → rows with the same time never swap places
  v_ord2 := replace(replace(replace(v_ord, 'c.name', 'f.name'), 'l.', 'f.'), 'm.pos', 'f.pos');
  return query execute format($q$
    with f as (
      select l.id, l.client_id, c.name, c.business_name, l.lead_status, l.lead_temperature, l.call_notes, l.next_followup_at, l.created_at,
             l.last_contact_at, l.original_creator_id, l.assigned_sales_id, l.handed_off_at, l.hidden_at, l.hidden_by, l.hidden_reason, l.seq, l.has_whatsapp, count(*) over()::int total,
             m.pos, coalesce(m.colors, '{}'::jsonb) colors, l.import_batch_id, c.original_source,
             (select max(a.created_at) from lead_assignments a where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10) received_at,
             (select a.assigned_by from lead_assignments a where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10 order by a.created_at desc limit 1) received_from_id
      from leads l join clients c on c.id = l.client_id left join lead_marks m on m.lead_id = l.id and m.user_id = $10
      where ($1::text is null or c.name ilike $2 or c.business_name ilike $2
             or c.search_norm like (select app.ar_norm($2))
             or c.id in (select s.client_id from client_stores s where s.url_raw ilike $2 or s.url_key ilike $2))
        and ($3::text is null or c.id in (select cc.client_id from client_contacts cc where (regexp_replace(cc.phone,'\D','','g') like $3 or regexp_replace(coalesce(cc.phone_raw,''),'\D','','g') like $3)))
        and ($4::text is null or l.lead_status = $4) and ($5::date is null or l.created_month = $5)
        and ($6::uuid is null or l.original_creator_id = $6) and ($7::uuid is null or l.assigned_sales_id = $7)
        and ($8::text is null or l.lead_temperature = $8)
        and (coalesce($16,'') = '' or ($16 = 'added' and l.original_creator_id = $10)
             or ($16 = 'received' and l.original_creator_id <> $10   -- what she added herself (also old data imported in her name) is never "received"
                 and exists (select 1 from lead_assignments a where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10)))
        and (case when $14 then (case $15 when 'hidden' then l.hidden_at is not null when 'all' then true else l.hidden_at is null end) else l.hidden_at is null end)
        and ($9 in ('super_admin','general_manager')
             or (l.current_owner_id = $10 and (l.handed_off_at is null or l.assigned_sales_id is not null)) or l.assigned_sales_id = $10
             or l.original_creator_id = $10   -- the Tele who added the client keeps seeing it after the hand-off
             or l.handed_by_id = $10          -- ... and so does the Tele who handed it over (e.g. data that was distributed to her)
             or ($9 = 'tele_sales_manager' and (l.original_creator_id = any($11) or l.current_owner_id = any($11) or l.handed_by_id = any($11)))
             or ($9 = 'sales_manager' and (l.current_owner_id = any($11) or l.assigned_sales_id = any($11))))
      order by %s limit $12 offset $13)
    select f.id, f.client_id, f.name, f.business_name,
           (select cc.phone from client_contacts cc where cc.client_id = f.client_id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
           (select s.url_raw from client_stores s where s.client_id = f.client_id order by s.created_at limit 1),
           f.lead_status, f.lead_temperature, f.call_notes, f.next_followup_at, f.created_at, f.last_contact_at,
           f.original_creator_id, app.emp_name(f.original_creator_id), f.assigned_sales_id, app.emp_name(f.assigned_sales_id),
           (f.handed_off_at is not null),
           (select count(*)::int from lead_activities a where a.lead_id = f.id and a.kind = 'duplicate_attempt'),
           f.total, f.hidden_at, app.emp_name(f.hidden_by), f.hidden_reason, f.pos, f.colors,
           f.received_at, app.emp_name(f.received_from_id), (select b.file_name from import_batches b where b.id = f.import_batch_id), f.original_source, f.has_whatsapp
    from f
  order by %s
  $q$, v_ord, v_ord2)
  using nullif(btrim(p_q),''), v_pat, case when p_phone is null then null else '%' || ltrim(regexp_replace(p_phone,'\D','','g'),'0') || '%' end,
        p_status, p_month, p_creator, p_sales, p_temp, v_role, v_me, v_team,
        least(coalesce(p_limit, 25), 100), greatest(coalesce(p_offset, 0), 0), app.can_see_hidden(), coalesce(p_hidden,'visible'), p_scope;
end $function$;

CREATE OR REPLACE FUNCTION app.reject_handoff(p_lead uuid, p_reason text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare h lead_handoffs; v_creator uuid; v_back uuid; v_name text; v_admin uuid; v_label text;
begin
  if app.me() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is not null and p_reason not in ('incomplete_info','not_qualified','out_of_scope','unreachable','duplicate','other') then raise exception 'invalid reject reason'; end if;
  if coalesce(btrim(p_reason),'') = '' and coalesce(btrim(p_note),'') = '' then raise exception 'reason required'; end if;
  if p_reason = 'other' and coalesce(btrim(p_note),'') = '' then raise exception 'note required'; end if;
  select * into h from lead_handoffs where lead_id = p_lead and status = 'pending_review' for update;
  if not found then
    if exists (select 1 from lead_handoffs where lead_id = p_lead and status in ('accepted','rejected')) then raise exception 'handoff already decided'; end if;
    raise exception 'no pending handoff for this lead';
  end if;
  if h.to_employee_id is distinct from app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  update lead_handoffs set status = 'rejected', decided_by = app.me(), decided_at = now(),
         reject_reason = nullif(btrim(p_reason),''), reject_note = nullif(btrim(p_note),'') where id = h.id;
  select original_creator_id into v_creator from leads where id = p_lead;
  -- back to the sender: visible again, with a clear status, so Tele Sales or Admin can decide the next step
  -- the sender is the employee who handed it over (for distributed data that is NOT the creator); the creator only if the sender left
  select case when exists (select 1 from users u where u.id = h.from_employee_id and u.is_active) then h.from_employee_id else v_creator end into v_back;
  update leads set lead_status = 'Rejected by Sales', assigned_sales_id = null, current_owner_id = v_back, handed_off_at = null, updated_by = app.me() where id = p_lead;
  if v_back is distinct from v_creator then
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason) values (p_lead, 'owner', app.me(), v_back, app.me(), 'رفض السيلز — رجع للمحوِّل');
  end if;
  v_label := coalesce(nullif(btrim(p_note),''), p_reason);
  insert into lead_activities(lead_id, kind, status_to, note, created_by) values (p_lead, 'assignment', 'Rejected by Sales', 'رفض السيلز العميل: ' || v_label, app.me());
  select c.name into v_name from clients c join leads l on l.client_id = c.id where l.id = p_lead;
  perform app._notify(h.from_employee_id, 'handoff_rejected', 'رفض السيلز العميل الذي حوّلته', v_name || ' — ' || v_label, '/leads/' || p_lead, 'horej:' || h.id);
  for v_admin in select u.id from users u join roles r on r.id = u.role_id where r.code = 'super_admin' and u.is_active and u.id <> h.from_employee_id loop
    perform app._notify(v_admin, 'handoff_rejected', 'عميل مرفوض من السيلز بانتظار قرار', v_name || ' — ' || v_label, '/leads/' || p_lead, 'horeja:' || h.id || ':' || v_admin);
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION app.tele_stats(p_emp uuid, p_month date)
 RETURNS TABLE(new_leads integer, interested_leads integer, meetings_scheduled integer, meetings_confirmed integer, meetings_completed integer, meetings_cancelled integer, meetings_no_show integer, lead_to_meeting_pct numeric, contracts_generated integer, target numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare s timestamptz := (p_month::timestamp at time zone app.company_tz()); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone app.company_tz());
begin
  if not (app.me() = p_emp or app.is_admin() or app.is_report(p_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query
  select
    (select count(*)::int from leads l where l.original_creator_id = p_emp and l.created_at >= s and l.created_at < e),
    (select count(distinct a.lead_id)::int from lead_activities a
       where a.created_by = p_emp and a.status_to = 'Interested' and a.created_at >= s and a.created_at < e),   -- leads SHE moved to Interested (also distributed data)
    (select count(*)::int from meetings m where m.tele_sales_id = p_emp and m.created_at >= s and m.created_at < e),
    (select count(distinct ev.meeting_id)::int from meeting_events ev join meetings m on m.id = ev.meeting_id
       where m.tele_sales_id = p_emp and ev.event = 'confirmed' and ev.at >= s and ev.at < e),
    (select count(*)::int from meetings m where m.tele_sales_id = p_emp and m.status = 'Completed' and m.completed_at >= s and m.completed_at < e),
    (select count(distinct ev.meeting_id)::int from meeting_events ev join meetings m on m.id = ev.meeting_id
       where m.tele_sales_id = p_emp and ev.event = 'cancelled' and ev.at >= s and ev.at < e),
    (select count(distinct ev.meeting_id)::int from meeting_events ev join meetings m on m.id = ev.meeting_id
       where m.tele_sales_id = p_emp and ev.event = 'no_show' and ev.at >= s and ev.at < e),
    (select case when count(*) = 0 then null else round(100.0 * (select count(*) from meetings m where m.tele_sales_id = p_emp and m.created_at >= s and m.created_at < e) / count(*), 1) end
       from leads l where l.original_creator_id = p_emp and l.created_at >= s and l.created_at < e),
    (select count(distinct d.id)::int from deals d join leads l on l.id = d.lead_id
       join deal_stage_history h on h.deal_id = d.id and h.to_stage = 'Signed / Finance Pending'
       where (l.original_creator_id = p_emp or l.handed_by_id = p_emp) and h.at >= s and h.at < e),
    (select t.target_value from targets t where t.employee_id = p_emp and t.period_month = p_month and t.metric = 'completed_meetings');
end $function$;

CREATE OR REPLACE FUNCTION app.sales_stats(p_emp uuid, p_month date)
 RETURNS TABLE(my_leads integer, upcoming_meetings integer, completed_meetings integer, open_deals integer, deals_won integer, deals_lost integer, pipeline_value numeric, win_rate_pct numeric, target numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare s timestamptz := (p_month::timestamp at time zone app.company_tz()); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone app.company_tz()); v_won int; v_lost int;
begin
  if not (app.me() = p_emp or app.is_admin() or app.is_report(p_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  select count(distinct d.id)::int into v_won from deals d join deal_stage_history h on h.deal_id = d.id and h.to_stage = 'Signed / Finance Pending'
    where d.owner_sales_id = p_emp and h.at >= s and h.at < e;
  select count(distinct d.id)::int into v_lost from deals d join deal_stage_history h on h.deal_id = d.id and h.to_stage = 'Lost'
    where d.owner_sales_id = p_emp and h.at >= s and h.at < e;
  return query select
    (select count(*)::int from leads l where l.assigned_sales_id = p_emp and l.archived_at is null and l.hidden_at is null),
    (select count(*)::int from meetings m where m.sales_rep_id = p_emp and m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at >= now()),
    (select count(*)::int from meetings m where m.sales_rep_id = p_emp and m.status = 'Completed' and m.completed_at >= s and m.completed_at < e),
    (select count(*)::int from deals d where d.owner_sales_id = p_emp and d.stage not in ('Lost','Signed / Finance Pending','Financially Approved')),
    v_won, v_lost,
    (select coalesce(sum(d.expected_value),0) from deals d where d.owner_sales_id = p_emp and d.stage not in ('Lost','Signed / Finance Pending','Financially Approved')),
    case when v_won + v_lost = 0 then null else round(100.0 * v_won / (v_won + v_lost), 1) end,
    (select t.target_value from targets t where t.employee_id = p_emp and t.period_month = p_month and t.metric = 'deals_won');
end $function$;

CREATE OR REPLACE FUNCTION app.client_matches(p_client uuid, p_q text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare v_q text := btrim(coalesce(p_q,'')); v_d text;
begin
  if v_q = '' then return true; end if;
  v_d := translate(v_q, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  if v_d ~ '^[+0-9\s().-]{3,}$' and length(regexp_replace(v_d, '\D', '', 'g')) >= 3 then
    v_d := ltrim(regexp_replace(v_d, '\D', '', 'g'), '0');
    return exists (select 1 from client_contacts cc where cc.client_id = p_client
                   and (regexp_replace(coalesce(cc.phone,''), '\D', '', 'g') like '%' || v_d || '%' or regexp_replace(coalesce(cc.phone_raw,''), '\D', '', 'g') like '%' || v_d || '%'));
  end if;
  v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return exists (select 1 from clients c where c.id = p_client and (c.name ilike v_q or c.business_name ilike v_q or c.search_norm like app.ar_norm(v_q)))
      or exists (select 1 from client_stores s where s.client_id = p_client and (s.url_raw ilike v_q or s.url_key ilike v_q));
end $function$;

CREATE OR REPLACE FUNCTION app.archive_months(p_emp uuid)
 RETURNS TABLE(month date, leads integer, handed_off integer, received integer, meetings_completed integer, achievements integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
declare v_emp uuid := coalesce(p_emp, app.me());
begin
  if not (app.me() = v_emp or app.is_admin() or app.is_report(v_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query
  with rec as (   -- every lead that reached the employee from someone else, with the month it arrived
    select a.lead_id, date_trunc('month', min(a.created_at) at time zone app.company_tz())::date m
      from lead_assignments a join leads l on l.id = a.lead_id
     where a.kind = 'owner' and a.to_employee_id = v_emp and a.assigned_by <> v_emp and l.original_creator_id <> v_emp group by a.lead_id),
  months as (
    select created_month m from leads where original_creator_id = v_emp
    union select date_trunc('month', h.handed_at at time zone app.company_tz())::date from lead_handoffs h where h.from_employee_id = v_emp
    union select r.m from rec r
    union select date_trunc('month', m.completed_at at time zone app.company_tz())::date from meetings m where m.status = 'Completed' and (m.tele_sales_id = v_emp or m.sales_rep_id = v_emp)
    union select period_month from achievements where employee_id = v_emp)
  select x.m,
    (select count(*)::int from leads l where l.original_creator_id = v_emp and l.created_month = x.m),
    (select count(distinct h.lead_id)::int from lead_handoffs h where h.from_employee_id = v_emp and date_trunc('month', h.handed_at at time zone app.company_tz())::date = x.m),
    (select count(*)::int from rec r where r.m = x.m),
    (select count(*)::int from meetings mm where mm.status = 'Completed' and (mm.tele_sales_id = v_emp or mm.sales_rep_id = v_emp) and date_trunc('month', mm.completed_at at time zone app.company_tz())::date = x.m),
    (select count(*)::int from achievements a where a.employee_id = v_emp and a.period_month = x.m)
  from months x where x.m is not null order by x.m desc;
end $function$;

CREATE OR REPLACE FUNCTION app.archive_leads(p_emp uuid, p_month date, p_status text, p_limit integer, p_offset integer, p_q text DEFAULT NULL::text)
 RETURNS TABLE(lead_id uuid, client_name text, business_name text, lead_status text, created_at timestamp with time zone, created_month date, creator_name text, owner_name text, handoff_status text, can_open boolean, total bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
declare v_emp uuid := p_emp;
begin
  if v_emp is null and not app.is_admin() then v_emp := app.me(); end if;
  if v_emp is not null and not (app.me() = v_emp or app.is_admin() or app.is_report(v_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query
  select l.id, c.name, c.business_name, l.lead_status, l.created_at, l.created_month, app.emp_name(l.original_creator_id), app.emp_name(l.current_owner_id),
         (select h.status from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
         app.lead_visible(l.id), count(*) over()
  from leads l join clients c on c.id = l.client_id
  left join lateral (select app._received_at(l.id, v_emp) at where v_emp is not null and l.original_creator_id <> v_emp) ra on true
  where (l.hidden_at is null or app.can_see_hidden())
    -- the employee's month record = what she added + what reached her from someone else (same two numbers as the summary above the list)
    and (v_emp is null or l.original_creator_id = v_emp or ra.at is not null)
    and (p_month is null or (case when v_emp is null or l.original_creator_id = v_emp then l.created_month
                                  else date_trunc('month', ra.at at time zone app.company_tz())::date end) = p_month)
    and (p_status is null or l.lead_status = p_status)
    and app.client_matches(l.client_id, p_q)
  order by l.created_at desc, l.seq limit least(coalesce(p_limit, 20), 100) offset greatest(coalesce(p_offset, 0), 0);
end $function$;

-- "received this month" on the progress card: same definition
CREATE OR REPLACE FUNCTION app.my_progress(p_emp uuid, p_month date)
 RETURNS TABLE(month_count integer, goal numeric, handed_off integer, received integer, meetings_completed integer, achievements jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
declare s timestamptz := (p_month::timestamp at time zone app.company_tz()); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone app.company_tz());
begin
  if not (app.me() = p_emp or app.is_admin() or app.is_report(p_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query select
    (select count(*)::int from leads l where l.original_creator_id = p_emp and l.created_month = p_month),
    (select t.target_value from targets t where t.employee_id = p_emp and t.period_month = p_month and t.metric = 'new_leads'),
    (select count(distinct h.lead_id)::int from lead_handoffs h where h.from_employee_id = p_emp and h.handed_at >= s and h.handed_at < e),
    (select count(*)::int from (select a.lead_id from lead_assignments a join leads l on l.id = a.lead_id
        where a.kind = 'owner' and a.to_employee_id = p_emp and a.assigned_by <> p_emp and l.original_creator_id <> p_emp
        group by a.lead_id having min(a.created_at) >= s and min(a.created_at) < e) r),
    (select count(*)::int from meetings m where m.status = 'Completed' and (m.tele_sales_id = p_emp or m.sales_rep_id = p_emp) and m.completed_at >= s and m.completed_at < e),
    coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'at', a.achieved_at) order by a.achieved_at) from achievements a
              where a.employee_id = p_emp and a.period_month = p_month), '[]'::jsonb);
end $function$;

-- meeting tab counters: counted directly (they were counted from a list capped at 500 rows)
CREATE OR REPLACE FUNCTION app.meeting_counts()
 RETURNS TABLE(upcoming integer, awaiting integer, done integer, cancelled integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
  select count(*) filter (where m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at >= now())::int,
         count(*) filter (where m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at < now())::int,
         count(*) filter (where m.status in ('Completed','No Show'))::int,
         count(*) filter (where m.status = 'Cancelled')::int
  from meetings m join leads l on l.id = m.lead_id
  where app.me() is not null and app.role_code() is not null
    and (l.hidden_at is null or app.is_admin() or app.role_code() in ('tele_sales_manager','sales_manager'))
    and (app.is_admin() or m.tele_sales_id = app.me() or m.sales_rep_id = app.me()
         or (app.role_code() in ('tele_sales_manager','sales_manager') and (m.tele_sales_id in (select app.team_ids()) or m.sales_rep_id in (select app.team_ids()))))
$function$;

-- company dashboard: every number from one function, months in company time, hidden leads stated separately
create or replace function app.company_overview(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare s timestamptz := (p_month::timestamp at time zone app.company_tz()); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone app.company_tz());
begin
  if not app.is_admin() then raise exception 'no access' using errcode = '42501'; end if;
  return jsonb_build_object(
    'totalLeads', (select count(*) from leads),
    'hiddenLeads', (select count(*) from leads where hidden_at is not null),
    'leads', (select count(*) from leads where created_month = p_month),
    'leadsHidden', (select count(*) from leads where created_month = p_month and hidden_at is not null),
    'handoffs', (select count(distinct lead_id) from lead_handoffs where handed_at >= s and handed_at < e),
    'handoffOps', (select count(*) from lead_handoffs where handed_at >= s and handed_at < e),
    'pendingDistribution', (select count(*) from lead_handoffs where status = 'pending_distribution'),
    'meetingsDone', (select count(*) from meetings where status = 'Completed' and completed_at >= s and completed_at < e),
    'meetingsUpcoming', (select count(*) from meetings where status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at >= now()),
    'meetingsMonth', (select count(*) from meetings where created_at >= s and created_at < e),
    'followUpsOpen', (select count(*) from follow_ups where status = 'open'),
    'overdue', (select count(*) from follow_ups where status = 'open' and due_at < now()),
    'openReviews', (select count(*) from duplicate_reviews where status = 'open'),
    -- the break-downs open the leads list, so they count what that list shows (hidden leads are stated on the total)
    'byStatus', (select coalesce(jsonb_agg(jsonb_build_object('s', x.s, 'n', x.n) order by x.n desc), '[]') from (select lead_status s, count(*)::int n from leads where hidden_at is null group by 1) x),
    'byTemperature', (select coalesce(jsonb_agg(jsonb_build_object('t', x.t, 'n', x.n) order by x.n desc), '[]') from (select coalesce(lead_temperature, 'none') t, count(*)::int n from leads where hidden_at is null group by 1) x),
    'handoffMonth', (select coalesce(jsonb_agg(jsonb_build_object('s', x.s, 'n', x.n)), '[]') from (
        select h.status s, count(*)::int n from (select distinct on (lead_id) lead_id, status from lead_handoffs where handed_at >= s and handed_at < e order by lead_id, handed_at desc) h group by 1) x),
    'rejectedWaiting', (select count(*) from leads where lead_status = 'Rejected by Sales' and hidden_at is null),
    'bySource', (select coalesce(jsonb_agg(jsonb_build_object('src', x.src, 'n', x.n) order by x.n desc), '[]') from (
        select cl.original_source src, count(*)::int n from leads l join clients cl on cl.id = l.client_id where l.created_month = p_month group by 1) x),
    'perEmployee', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'role', x.role, 'added', x.added, 'received', x.received, 'active_owned', x.active_owned, 'goal', x.goal) order by x.role_code, x.full_name), '[]') from (
        select el.id, el.full_name, el.role_name_ar role, el.role_code,
          (select count(*)::int from leads l where l.original_creator_id = el.id and l.created_month = p_month) added,
          (select count(*)::int from (select a.lead_id from lead_assignments a join leads l on l.id = a.lead_id
              where a.kind = 'owner' and a.to_employee_id = el.id and a.assigned_by <> el.id and l.original_creator_id <> el.id
              group by a.lead_id having min(a.created_at) >= s and min(a.created_at) < e) r) received,
          (select count(*)::int from leads l where l.current_owner_id = el.id and l.hidden_at is null and l.lead_status not in ('Not Interested','Invalid Contact')) active_owned,
          (select t.target_value from targets t where t.employee_id = el.id and t.period_month = p_month and t.metric = 'new_leads') goal
        from app.employee_list() el where el.is_active and el.role_code in ('tele_sales','sales_rep','tele_sales_manager','sales_manager')) x));
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
