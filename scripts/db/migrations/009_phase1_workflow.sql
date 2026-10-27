-- 009_phase1_workflow.sql — Sales accept/reject, lead temperature, meetings lifecycle, company time zone, terminology
-- Idempotent and additive: no table/column is dropped and no business data is deleted.

-- ───────── 1) company time zone (one source of truth, read from settings.timezone) ─────────
create or replace function app.company_tz() returns text language sql stable security definer set search_path = public as
$$ select coalesce((select value #>> '{}' from settings where key = 'timezone'), 'Asia/Riyadh') $$;

create or replace function app.set_created_month() returns trigger language plpgsql as $$
begin NEW.created_month := date_trunc('month', NEW.created_at at time zone app.company_tz())::date; return NEW; end $$;
drop trigger if exists leads_month on leads;
create trigger leads_month before insert on leads for each row execute function app.set_created_month();
create unique index if not exists leads_request_id_uk on leads(request_id) where request_id is not null;

create or replace function app.protect_leads() returns trigger language plpgsql as $$
begin
  if current_setting('app.allow_attribution_fix', true) = 'on' then return NEW; end if;
  if NEW.original_creator_id is distinct from OLD.original_creator_id
     or NEW.created_at is distinct from OLD.created_at
     or NEW.created_month is distinct from OLD.created_month then
    raise exception 'original_creator / creation date are immutable' using errcode = '42501';
  end if;
  return NEW;
end $$;

create or replace function app._month_start() returns date language sql stable as
$$ select date_trunc('month', now() at time zone app.company_tz())::date $$;

create or replace function app._award_leads(p_emp uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_m date := app._month_start(); v_n int; v_goal numeric; v_new text[] := '{}'; t int; v_id uuid;
begin
  select count(*) into v_n from leads where original_creator_id = p_emp and created_month = v_m;
  select target_value into v_goal from targets where employee_id = p_emp and period_month = v_m and metric = 'new_leads';
  foreach t in array array[10,25,50,100] loop
    if v_n >= t then
      v_id := null;
      insert into achievements(employee_id, period_month, code) values (p_emp, v_m, 'leads_' || t) on conflict do nothing returning id into v_id;
      if v_id is not null then v_new := array_append(v_new, 'leads_' || t); end if;
    end if;
  end loop;
  if v_goal is not null and v_goal > 0 and v_n >= v_goal then
    v_id := null;
    insert into achievements(employee_id, period_month, code) values (p_emp, v_m, 'goal_new_leads') on conflict do nothing returning id into v_id;
    if v_id is not null then v_new := array_append(v_new, 'goal_new_leads'); end if;
  end if;
  return jsonb_build_object('month_count', v_n, 'goal', v_goal, 'new_achievements', to_jsonb(v_new));
end $$;

create or replace function app._award_meetings(p_emp uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_m date := app._month_start(); v_n int; v_goal numeric; t int;
  s timestamptz := (app._month_start()::timestamp at time zone app.company_tz());
  e timestamptz := ((app._month_start() + interval '1 month')::timestamp at time zone app.company_tz());
begin
  select count(*) into v_n from meetings m where m.status = 'Completed' and (m.tele_sales_id = p_emp or m.sales_rep_id = p_emp)
    and m.completed_at >= s and m.completed_at < e;
  foreach t in array array[1,5,10,20] loop
    if v_n >= t then insert into achievements(employee_id, period_month, code) values (p_emp, v_m, 'meetings_' || t) on conflict do nothing; end if;
  end loop;
  select target_value into v_goal from targets where employee_id = p_emp and period_month = v_m and metric = 'completed_meetings';
  if v_goal is not null and v_goal > 0 and v_n >= v_goal then
    insert into achievements(employee_id, period_month, code) values (p_emp, v_m, 'goal_meetings') on conflict do nothing;
  end if;
end $$;

create or replace function app.my_progress(p_emp uuid, p_month date)
returns table(month_count int, goal numeric, handed_off int, received int, meetings_completed int, achievements jsonb)
language plpgsql stable security definer set search_path = public, app as $$
declare s timestamptz := (p_month::timestamp at time zone app.company_tz()); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone app.company_tz());
begin
  if not (app.me() = p_emp or app.is_admin() or app.is_report(p_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query select
    (select count(*)::int from leads l where l.original_creator_id = p_emp and l.created_month = p_month),
    (select t.target_value from targets t where t.employee_id = p_emp and t.period_month = p_month and t.metric = 'new_leads'),
    (select count(*)::int from lead_handoffs h where h.from_employee_id = p_emp and h.handed_at >= s and h.handed_at < e),
    (select count(*)::int from lead_handoffs h where h.to_employee_id = p_emp and h.assigned_at >= s and h.assigned_at < e),
    (select count(*)::int from meetings m where m.status = 'Completed' and (m.tele_sales_id = p_emp or m.sales_rep_id = p_emp) and m.completed_at >= s and m.completed_at < e),
    coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'at', a.achieved_at) order by a.achieved_at) from achievements a
              where a.employee_id = p_emp and a.period_month = p_month), '[]'::jsonb);
end $$;

create or replace function app.archive_months(p_emp uuid)
returns table(month date, leads int, handed_off int, received int, meetings_completed int, achievements int)
language plpgsql stable security definer set search_path = public, app as $$
declare v_emp uuid := coalesce(p_emp, app.me());
begin
  if not (app.me() = v_emp or app.is_admin() or app.is_report(v_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query
  with months as (
    select created_month m from leads where original_creator_id = v_emp
    union select date_trunc('month', h.handed_at at time zone app.company_tz())::date from lead_handoffs h where h.from_employee_id = v_emp
    union select date_trunc('month', h.assigned_at at time zone app.company_tz())::date from lead_handoffs h where h.to_employee_id = v_emp and h.assigned_at is not null
    union select date_trunc('month', m.completed_at at time zone app.company_tz())::date from meetings m where m.status = 'Completed' and (m.tele_sales_id = v_emp or m.sales_rep_id = v_emp)
    union select period_month from achievements where employee_id = v_emp)
  select x.m,
    (select count(*)::int from leads l where l.original_creator_id = v_emp and l.created_month = x.m),
    (select count(*)::int from lead_handoffs h where h.from_employee_id = v_emp and date_trunc('month', h.handed_at at time zone app.company_tz())::date = x.m),
    (select count(*)::int from lead_handoffs h where h.to_employee_id = v_emp and h.assigned_at is not null and date_trunc('month', h.assigned_at at time zone app.company_tz())::date = x.m),
    (select count(*)::int from meetings mm where mm.status = 'Completed' and (mm.tele_sales_id = v_emp or mm.sales_rep_id = v_emp) and date_trunc('month', mm.completed_at at time zone app.company_tz())::date = x.m),
    (select count(*)::int from achievements a where a.employee_id = v_emp and a.period_month = x.m)
  from months x where x.m is not null order by x.m desc;
end $$;

create or replace function app.tele_stats(p_emp uuid, p_month date)
returns table(new_leads int, interested_leads int, meetings_scheduled int, meetings_confirmed int, meetings_completed int,
              meetings_cancelled int, meetings_no_show int, lead_to_meeting_pct numeric, contracts_generated int, target numeric)
language plpgsql stable security definer set search_path = public, app as $$
declare s timestamptz := (p_month::timestamp at time zone app.company_tz()); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone app.company_tz());
begin
  if not (app.me() = p_emp or app.is_admin() or app.is_report(p_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query
  select
    (select count(*)::int from leads l where l.original_creator_id = p_emp and l.created_at >= s and l.created_at < e),
    (select count(distinct a.lead_id)::int from lead_activities a join leads l on l.id = a.lead_id
       where l.original_creator_id = p_emp and a.status_to = 'Interested' and a.created_at >= s and a.created_at < e),
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
       where l.original_creator_id = p_emp and h.at >= s and h.at < e),
    (select t.target_value from targets t where t.employee_id = p_emp and t.period_month = p_month and t.metric = 'completed_meetings');
end $$;

create or replace function app.sales_stats(p_emp uuid, p_month date)
returns table(my_leads int, upcoming_meetings int, completed_meetings int, open_deals int, deals_won int, deals_lost int,
              pipeline_value numeric, win_rate_pct numeric, target numeric)
language plpgsql stable security definer set search_path = public, app as $$
declare s timestamptz := (p_month::timestamp at time zone app.company_tz()); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone app.company_tz()); v_won int; v_lost int;
begin
  if not (app.me() = p_emp or app.is_admin() or app.is_report(p_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  select count(distinct d.id)::int into v_won from deals d join deal_stage_history h on h.deal_id = d.id and h.to_stage = 'Signed / Finance Pending'
    where d.owner_sales_id = p_emp and h.at >= s and h.at < e;
  select count(distinct d.id)::int into v_lost from deals d join deal_stage_history h on h.deal_id = d.id and h.to_stage = 'Lost'
    where d.owner_sales_id = p_emp and h.at >= s and h.at < e;
  return query select
    (select count(*)::int from leads l where l.assigned_sales_id = p_emp and l.archived_at is null),
    (select count(*)::int from meetings m where m.sales_rep_id = p_emp and m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at >= now()),
    (select count(*)::int from meetings m where m.sales_rep_id = p_emp and m.status = 'Completed' and m.completed_at >= s and m.completed_at < e),
    (select count(*)::int from deals d where d.owner_sales_id = p_emp and d.stage not in ('Lost','Signed / Finance Pending','Financially Approved')),
    v_won, v_lost,
    (select coalesce(sum(d.expected_value),0) from deals d where d.owner_sales_id = p_emp and d.stage not in ('Lost','Signed / Finance Pending','Financially Approved')),
    case when v_won + v_lost = 0 then null else round(100.0 * v_won / (v_won + v_lost), 1) end,
    (select t.target_value from targets t where t.employee_id = p_emp and t.period_month = p_month and t.metric = 'deals_won');
end $$;

create or replace function app.job_daily(p_run_key text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_inserted uuid; v_overdue int := 0; v_target int := 0; r record; v_mgr uuid; v_month date := app._month_start(); v_done int;
begin
  if app.me() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  insert into job_runs(job_name, run_key) values ('daily', p_run_key) on conflict do nothing returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('status','skipped'); end if;
  for r in select f.id, f.owner_id, f.lead_id from follow_ups f where f.status = 'open' and f.due_at < now() loop
    perform app._notify(r.owner_id, 'followup_overdue', 'متابعة متأخرة', null, '/follow-ups', 'fu_od:' || r.id);
    for v_mgr in select manager_id from team_memberships where member_id = r.owner_id loop
      perform app._notify(v_mgr, 'followup_overdue', 'متابعة متأخرة لدى أحد أعضاء فريقك', app.emp_name(r.owner_id), '/follow-ups', 'fu_odm:' || r.id || ':' || v_mgr);
    end loop;
    v_overdue := v_overdue + 1;
  end loop;
  for r in select t.employee_id, t.target_value from targets t where t.period_month = v_month and t.metric = 'completed_meetings' and t.target_value > 0 loop
    select count(*) into v_done from meetings m where m.tele_sales_id = r.employee_id and m.status = 'Completed'
      and m.completed_at >= (v_month::timestamp at time zone app.company_tz()) and m.completed_at < ((v_month + interval '1 month')::timestamp at time zone app.company_tz());
    if v_done >= 0.8 * r.target_value and v_done < r.target_value then
      perform app._notify(r.employee_id, 'target_near', 'اقتربتِ من التارجت', v_done || ' من ' || r.target_value, '/targets', 'tg80:' || r.employee_id || ':' || v_month);
      v_target := v_target + 1;
    end if;
  end loop;
  update job_runs set finished_at = now(), status = 'done', details = jsonb_build_object('overdue', v_overdue, 'target_near', v_target) where id = v_inserted;
  return jsonb_build_object('status','done','overdue',v_overdue,'target_near',v_target);
end $$;


-- ───────── 2) terminology: the role is called "السيلز" (codes and tables keep their names) ─────────
update roles set name_ar = 'السيلز', name_en = 'Sales' where code = 'sales_rep';

-- ───────── 3) lead temperature (Cold / Warm / Hot) — separate from the acquisition source ─────────
alter table leads add column if not exists lead_temperature text check (lead_temperature in ('cold','warm','hot'));
create index if not exists leads_temperature on leads(lead_temperature) where lead_temperature is not null;
grant update (lead_temperature) on leads to ghamer_app;

alter table leads disable trigger leads_touch;
alter table leads drop constraint if exists leads_lead_status_check;
alter table leads add constraint leads_lead_status_check check (lead_status in
  ('New Lead','Contacted','No Answer','Interested','Not Interested','Follow-up Required','Qualified Lead',
   'Pending Sales Review','Accepted by Sales','Rejected by Sales','Meeting Scheduled','Meeting Completed','Invalid Contact'));

-- ───────── 4) hand-off: Sales decides (accept / reject) ─────────
alter table lead_handoffs add column if not exists decided_by uuid references employees(id);
alter table lead_handoffs add column if not exists decided_at timestamptz;
alter table lead_handoffs add column if not exists reject_reason text;
alter table lead_handoffs add column if not exists reject_note text;
alter table lead_handoffs drop constraint if exists lead_handoffs_status_check;
update lead_handoffs set status = 'pending_review' where status = 'assigned';
update lead_handoffs set status = 'accepted', decided_by = to_employee_id, decided_at = coalesce(received_at, assigned_at) where status = 'received';
alter table lead_handoffs add constraint lead_handoffs_status_check check (status in ('pending_distribution','pending_review','accepted','rejected','cancelled'));
alter table lead_handoffs drop constraint if exists lead_handoffs_reject_reason_check;
alter table lead_handoffs add constraint lead_handoffs_reject_reason_check check (reject_reason is null or reject_reason in
  ('incomplete_info','not_qualified','out_of_scope','unreachable','duplicate','other'));
alter table lead_handoffs alter column status set default 'pending_review';
drop index if exists handoffs_one_open;
create unique index handoffs_one_open on lead_handoffs(lead_id) where status in ('pending_distribution','pending_review');
update leads l set lead_status = 'Pending Sales Review'
 where exists (select 1 from lead_handoffs h where h.lead_id = l.id and h.status in ('pending_review','pending_distribution')) and l.lead_status in ('Interested','Qualified Lead');
alter table leads enable trigger leads_touch;

create or replace function app._assign_to_sales(p_lead uuid, p_to uuid, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_owner uuid; v_sales uuid; v_name text;
begin
  select current_owner_id, assigned_sales_id into v_owner, v_sales from leads where id = p_lead;
  update leads set assigned_sales_id = p_to, current_owner_id = p_to, handed_off_at = coalesce(handed_off_at, now()),
         lead_status = 'Pending Sales Review', updated_by = app.me() where id = p_lead;
  insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason) values
    (p_lead, 'owner', v_owner, p_to, app.me(), coalesce(p_note, 'تحويل إلى السيلز')),
    (p_lead, 'sales', v_sales, p_to, app.me(), coalesce(p_note, 'تحويل إلى السيلز'));
  insert into lead_activities(lead_id, kind, status_to, note, created_by)
    values (p_lead, 'assignment', 'Pending Sales Review', 'تم إرسال العميل إلى ' || app.emp_name(p_to) || ' بانتظار قبوله', app.me());
  select c.name into v_name from clients c join leads l on l.client_id = c.id where l.id = p_lead;
  perform app._notify(p_to, 'lead_pending_review', 'عميل جديد بانتظار قبولك أو رفضه', v_name, '/assigned', 'pr:' || p_lead || ':' || p_to || ':' || now()::text);
end $$;

create or replace function app.handoff_lead(p_lead uuid, p_to uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_status text; v_ho uuid; v_admin uuid; v_name text;
begin
  if not app.has_perm('leads.handoff') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  select l.lead_status, c.name into v_status, v_name from leads l join clients c on c.id = l.client_id where l.id = p_lead for update of l;
  if v_status not in ('Interested','Qualified Lead','Rejected by Sales') then raise exception 'lead must be Interested or Qualified before handoff'; end if;
  if exists (select 1 from lead_handoffs where lead_id = p_lead and status in ('pending_distribution','pending_review')) then
    raise exception 'lead already handed off';
  end if;
  if p_to is not null and not exists (select 1 from users u join roles r on r.id = u.role_id
                                       where u.id = p_to and u.is_active and r.code in ('sales_rep','sales_manager')) then
    raise exception 'invalid sales representative';
  end if;
  insert into lead_handoffs(lead_id, from_employee_id, to_employee_id, status, note, assigned_at, assigned_by)
  values (p_lead, app.me(), p_to, case when p_to is null then 'pending_distribution' else 'pending_review' end, nullif(btrim(p_note),''),
          case when p_to is null then null else now() end, case when p_to is null then null else app.me() end)
  returning id into v_ho;
  if p_to is null then
    update leads set handed_off_at = coalesce(handed_off_at, now()), lead_status = 'Pending Sales Review', updated_by = app.me() where id = p_lead;
    insert into lead_activities(lead_id, kind, status_to, note, created_by) values (p_lead, 'assignment', 'Pending Sales Review', 'تم إرسال العميل للإدارة لتوزيعه على السيلز', app.me());
    for v_admin in select u.id from users u join roles r on r.id = u.role_id where r.code = 'super_admin' and u.is_active loop
      perform app._notify(v_admin, 'lead_pending_distribution', 'عميل بانتظار التوزيع على السيلز', v_name, '/distribution', 'dist:' || v_ho || ':' || v_admin);
    end loop;
  else
    perform app._assign_to_sales(p_lead, p_to, nullif(btrim(p_note),''));
  end if;
  return jsonb_build_object('handoff_id', v_ho, 'status', case when p_to is null then 'pending_distribution' else 'pending_review' end);
end $$;

create or replace function app.assign_handoff(p_handoff uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare h lead_handoffs;
begin
  if not app.has_perm('leads.distribute') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into h from lead_handoffs where id = p_handoff and status = 'pending_distribution' for update;
  if not found then raise exception 'handoff is not pending'; end if;
  if not exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_to and u.is_active and r.code in ('sales_rep','sales_manager')) then
    raise exception 'invalid sales representative';
  end if;
  perform app._assign_to_sales(h.lead_id, p_to, 'توزيع من الإدارة');
  update lead_handoffs set status = 'pending_review', to_employee_id = p_to, assigned_at = now(), assigned_by = app.me() where id = p_handoff;
  perform app._notify(h.from_employee_id, 'handoff_assigned', 'تم توزيع العميل الذي حوّلته', 'المستلم: ' || app.emp_name(p_to), '/', 'hoa:' || p_handoff);
end $$;

drop function if exists app.acknowledge_handoff(uuid);
create or replace function app.accept_handoff(p_lead uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare h lead_handoffs; v_name text;
begin
  if app.me() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into h from lead_handoffs where lead_id = p_lead and status = 'pending_review' for update;
  if not found then
    if exists (select 1 from lead_handoffs where lead_id = p_lead and status in ('accepted','rejected')) then raise exception 'handoff already decided'; end if;
    raise exception 'no pending handoff for this lead';
  end if;
  if h.to_employee_id is distinct from app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  update lead_handoffs set status = 'accepted', decided_by = app.me(), decided_at = now() where id = h.id;
  update leads set lead_status = 'Accepted by Sales', updated_by = app.me() where id = p_lead;
  perform app._ensure_deal(p_lead, app.me(), 'Qualified');
  insert into lead_activities(lead_id, kind, status_to, note, created_by) values (p_lead, 'assignment', 'Accepted by Sales', 'قبل السيلز العميل', app.me());
  select c.name into v_name from clients c join leads l on l.client_id = c.id where l.id = p_lead;
  perform app._notify(h.from_employee_id, 'handoff_accepted', 'تم قبول العميل الذي حوّلته', v_name || ' — قبله ' || app.emp_name(app.me()), '/leads?tab=handed', 'hoacc:' || h.id);
end $$;

create or replace function app.reject_handoff(p_lead uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare h lead_handoffs; v_creator uuid; v_name text; v_admin uuid; v_label text;
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
  update leads set lead_status = 'Rejected by Sales', assigned_sales_id = null, current_owner_id = v_creator, handed_off_at = null, updated_by = app.me() where id = p_lead;
  v_label := coalesce(nullif(btrim(p_note),''), p_reason);
  insert into lead_activities(lead_id, kind, status_to, note, created_by) values (p_lead, 'assignment', 'Rejected by Sales', 'رفض السيلز العميل: ' || v_label, app.me());
  select c.name into v_name from clients c join leads l on l.client_id = c.id where l.id = p_lead;
  perform app._notify(h.from_employee_id, 'handoff_rejected', 'رفض السيلز العميل الذي حوّلته', v_name || ' — ' || v_label, '/leads/' || p_lead, 'horej:' || h.id);
  for v_admin in select u.id from users u join roles r on r.id = u.role_id where r.code = 'super_admin' and u.is_active and u.id <> h.from_employee_id loop
    perform app._notify(v_admin, 'handoff_rejected', 'عميل مرفوض من السيلز بانتظار قرار', v_name || ' — ' || v_label, '/leads/' || p_lead, 'horeja:' || h.id || ':' || v_admin);
  end loop;
end $$;

create or replace function app.added_counts(p_emp uuid)
returns table(total int, this_month int, handed_off int, accepted int, rejected int)
language plpgsql stable security definer set search_path = public, app as $$
declare v_emp uuid := coalesce(p_emp, app.me());
begin
  if not (app.me() = v_emp or app.is_admin() or app.is_report(v_emp)) then raise exception 'no access' using errcode = '42501'; end if;
  return query select
    (select count(*)::int from leads l where l.original_creator_id = v_emp),
    (select count(*)::int from leads l where l.original_creator_id = v_emp and l.created_month = app._month_start()),
    (select count(distinct h.lead_id)::int from lead_handoffs h where h.from_employee_id = v_emp),
    (select count(distinct h.lead_id)::int from lead_handoffs h where h.from_employee_id = v_emp and h.status = 'accepted'),
    (select count(distinct h.lead_id)::int from lead_handoffs h where h.from_employee_id = v_emp and h.status = 'rejected');
end $$;

-- session lookup: + number of leads waiting for this person's decision
drop function if exists app.session_get(text);
create or replace function app.session_get(p_hash text)
returns table(user_id uuid, full_name text, email citext, role_code text, role_name_ar text,
              mfa_verified boolean, mfa_required boolean, mfa_enabled boolean, must_change_password boolean, unread int, pending_review int, perms text[])
language plpgsql security definer set search_path = public as $$
begin
  update sessions set last_seen_at = now() where token_hash = p_hash and last_seen_at < now() - interval '1 minute';
  return query
    select u.id, e.full_name, u.email, r.code, r.name_ar, s.mfa_verified, r.mfa_required, u.mfa_enabled, u.must_change_password,
           (select count(*)::int from notifications n where n.user_id = u.id and n.read_at is null),
           (select count(*)::int from lead_handoffs h where h.to_employee_id = u.id and h.status = 'pending_review'),
           coalesce((select array_agg(rp.permission_key) from role_permissions rp where rp.role_id = r.id), '{}')
    from sessions s join users u on u.id = s.user_id join employees e on e.id = u.id join roles r on r.id = u.role_id
    where s.token_hash = p_hash and s.expires_at > now() and u.is_active;
end $$;

-- ───────── 5) register_lead now stores the temperature ─────────
create or replace function app.register_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_me uuid := app.me(); v_role text := app.role_code(); v_ids jsonb := coalesce(p->'identifiers','[]'::jsonb);
  v_existing boolean := coalesce(p->>'mode','lead') = 'existing';
  v_client uuid; v_lead uuid; v_dup jsonb; v_sales uuid; v_status text; v_req uuid := nullif(p->>'request_id','')::uuid; v_prog jsonb;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if v_existing then
    if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif not app.has_perm('leads.create') then raise exception 'not allowed' using errcode = '42501';
  end if;
  if btrim(coalesce(p->>'name','')) = '' then raise exception 'name required'; end if;
  if jsonb_array_length(v_ids) = 0 then raise exception 'at least one phone or store required'; end if;

  -- idempotency: the same form submission (double click / retry) returns the lead it already created
  if v_req is not null then
    select l.id, l.client_id into v_lead, v_client from leads l where l.request_id = v_req and l.original_creator_id = v_me;
    if found then return jsonb_build_object('status','created','client_id',v_client,'lead_id',v_lead,'repeat',true) || app._progress(v_me); end if;
  end if;
  v_dup := app._find_dup(v_ids);
  if v_dup is not null then return v_dup; end if;

  v_sales := case when v_role in ('sales_rep','sales_manager') then v_me end;
  v_status := coalesce(nullif(p->>'lead_status',''), 'New Lead');
  begin
    insert into clients(name, business_name, industry, country, city, contact_person, original_source, original_creator_id, status, is_legacy)
    values (btrim(p->>'name'), nullif(p->>'business_name',''), nullif(p->>'industry',''), coalesce(nullif(p->>'country',''),'SA'),
            nullif(p->>'city',''), nullif(p->>'contact_person',''),
            case when v_existing then 'legacy' else coalesce(nullif(p->>'source',''),'unknown') end,
            v_me, case when v_existing then 'active' else 'lead' end, v_existing)
    returning id into v_client;
    perform app._write_contacts(v_client, p, false);
    if not v_existing then
      insert into leads(client_id, original_creator_id, current_owner_id, assigned_sales_id, lead_status, required_services,
                        call_notes, next_followup_at, last_contact_at, updated_by, request_id, lead_temperature)
      values (v_client, v_me, v_me, v_sales, v_status,
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'required_services','[]')) x), '{}'),
              nullif(p->>'call_notes',''), nullif(p->>'next_followup_at','')::timestamptz,
              case when v_status <> 'New Lead' then now() end, v_me, v_req, nullif(p->>'lead_temperature',''))
      returning id into v_lead;
      insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
        values (v_lead, 'owner', null, v_me, v_me, 'التسجيل الأولي');
      insert into lead_activities(lead_id, kind, status_to, note, created_by)
        values (v_lead, 'note', v_status, coalesce(nullif(p->>'call_notes',''), 'تم تسجيل العميل'), v_me);
      if nullif(p->>'next_followup_at','') is not null then
        insert into follow_ups(lead_id, owner_id, due_at, reason, created_by)
        values (v_lead, v_me, (p->>'next_followup_at')::timestamptz, coalesce(nullif(btrim(p->>'followup_reason'),''), 'متابعة'), v_me);
      end if;
      if v_sales is not null then perform app._ensure_deal(v_lead, v_sales, 'New Lead'); end if;
    end if;
  exception when unique_violation then
    if v_req is not null then
      select l.id, l.client_id into v_lead, v_client from leads l where l.request_id = v_req and l.original_creator_id = v_me;
      if found then return jsonb_build_object('status','created','client_id',v_client,'lead_id',v_lead,'repeat',true) || app._progress(v_me); end if;
    end if;
    v_dup := app._find_dup(v_ids);
    if v_dup is null then raise; end if;
    return v_dup;
  end;
  if v_lead is not null then v_prog := app._award_leads(v_me); else v_prog := '{}'::jsonb; end if;
  return jsonb_build_object('status','created','client_id',v_client,'lead_id',v_lead) || v_prog;
end $$;

-- text search gets the temperature filter
drop function if exists app.search_leads(text, text, text, date, uuid, int, int);
create or replace function app.search_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_temp text, p_limit int, p_offset int)
returns table(id uuid, client_id uuid, lead_status text, next_followup_at timestamptz, created_at timestamptz, last_contact_at timestamptz,
              original_creator_id uuid, current_owner_id uuid, assigned_sales_id uuid, lead_temperature text, total int)
language plpgsql stable security definer set search_path = public, app as $$
declare v_me uuid := app.me(); v_role text := app.role_code(); v_team uuid[] := array(select app.team_ids());
        v_pat text := '%' || replace(replace(replace(coalesce(p_q,''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if v_me is null or v_role is null then return; end if;
  return query
  select l.id, l.client_id, l.lead_status, l.next_followup_at, l.created_at, l.last_contact_at,
         l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.lead_temperature, count(*) over()::int
  from leads l join clients c on c.id = l.client_id
  where ((p_phone is null and (c.name ilike v_pat or c.business_name ilike v_pat))
         or (p_phone is not null and c.id in (select cc.client_id from client_contacts cc where cc.phone like p_phone)))
    and (p_status is null or l.lead_status = p_status) and (p_month is null or l.created_month = p_month)
    and (p_creator is null or l.original_creator_id = p_creator) and (p_temp is null or l.lead_temperature = p_temp)
    and (v_role in ('super_admin','general_manager')
         or (l.current_owner_id = v_me and (l.handed_off_at is null or l.assigned_sales_id is not null)) or l.assigned_sales_id = v_me
         or (l.handed_off_at is null and l.original_creator_id = v_me)
         or (v_role = 'tele_sales_manager' and (l.original_creator_id = any(v_team) or l.current_owner_id = any(v_team)))
         or (v_role = 'sales_manager' and (l.current_owner_id = any(v_team) or l.assigned_sales_id = any(v_team))))
  order by l.created_at desc limit least(coalesce(p_limit, 20), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ───────── 6) meetings: managed by Sales, link is private to Sales/Admin ─────────
alter table meetings add column if not exists title text;
alter table meetings add column if not exists meeting_type text not null default 'online' check (meeting_type in ('online','in_person','phone'));
alter table meetings add column if not exists request_id uuid;
alter table meetings add column if not exists outcome text check (outcome in ('positive','needs_followup','undecided','not_interested'));
alter table meetings add column if not exists result_notes text;
alter table meetings add column if not exists next_step text;
alter table meetings add column if not exists next_step_at timestamptz;
alter table meetings add column if not exists outcome_by uuid references employees(id);
alter table meetings add column if not exists outcome_at timestamptz;
create unique index if not exists meetings_request_uk on meetings(request_id) where request_id is not null;
alter table meeting_events drop constraint if exists meeting_events_event_check;
alter table meeting_events add constraint meeting_events_event_check check (event in
  ('created','confirmed','rescheduled','completed','cancelled','no_show','reassigned','updated','outcome'));

-- the link column is not readable by the app role at all; only app.meeting_link() can return it
revoke select on meetings from ghamer_app;
grant select (id, lead_id, tele_sales_id, sales_rep_id, scheduled_at, booking_notes, status, reschedule_count, confirmed_at, completed_at,
              created_by, created_at, updated_at, title, meeting_type, outcome, result_notes, next_step, next_step_at, outcome_by, outcome_at)
  on meetings to ghamer_app;

create or replace function app.meeting_link(p_meeting uuid) returns text
language sql stable security definer set search_path = public, app as $$
  select m.meeting_url from meetings m
  where m.id = p_meeting and app.me() is not null
    and (m.sales_rep_id = app.me() or app.is_admin() or (app.role_code() = 'sales_manager' and app.is_report(m.sales_rep_id)))
$$;

create or replace function app._check_link(p_url text) returns text
language plpgsql immutable as $$
declare v text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v is null then return null; end if;
  if length(v) > 500 or v !~* '^https?://[^[:space:]]+\.[^[:space:]]+$' then raise exception 'invalid meeting link'; end if;
  return v;
end $$;

-- tele sales no longer create or manage meetings (they hand leads over; Sales owns the meeting)
delete from role_permissions where role_id in (select id from roles where code in ('tele_sales','tele_sales_manager'))
  and permission_key in ('meetings.create','meetings.manage');

-- who may act on a meeting: its Sales owner, his manager, the Super Admin
create or replace function app._meeting_actor(p_sales uuid) returns boolean language sql stable security definer set search_path = public, app as
$$ select app.me() is not null and (p_sales = app.me() or app.is_super() or (app.role_code() = 'sales_manager' and app.is_report(p_sales))) $$;

drop function if exists app.book_meeting(uuid, uuid, timestamptz, text, text);
create or replace function app.book_meeting(p_lead uuid, p_at timestamptz, p_title text, p_type text, p_url text, p_notes text, p_request uuid)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare l leads; v_id uuid; v_accepted boolean; v_tele uuid; v_stage text; v_deal uuid; v_name text; v_type text := coalesce(nullif(p_type,''), 'online');
begin
  if not app.has_perm('meetings.create') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  if p_request is not null then select id into v_id from meetings where request_id = p_request; if found then return v_id; end if; end if;
  select * into l from leads where id = p_lead for update;
  if l.assigned_sales_id is null or not app._meeting_actor(l.assigned_sales_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_accepted := exists (select 1 from lead_handoffs h where h.lead_id = p_lead and h.status = 'accepted')
             or (not exists (select 1 from lead_handoffs h where h.lead_id = p_lead) and l.original_creator_id = l.assigned_sales_id);
  if not v_accepted then raise exception 'lead is not accepted by sales yet'; end if;
  if p_at is null or p_at <= now() then raise exception 'meeting time must be in the future'; end if;
  if v_type not in ('online','in_person','phone') then raise exception 'invalid meeting type'; end if;
  select e.id into v_tele from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
   where e.id = l.original_creator_id and r.code in ('tele_sales','tele_sales_manager');
  select c.name into v_name from clients c where c.id = l.client_id;
  begin
    insert into meetings(lead_id, tele_sales_id, sales_rep_id, scheduled_at, meeting_url, booking_notes, title, meeting_type, request_id, created_by)
    values (p_lead, v_tele, l.assigned_sales_id, p_at, app._check_link(p_url), nullif(btrim(p_notes),''),
            coalesce(nullif(btrim(p_title),''), 'اجتماع مع ' || v_name), v_type, p_request, app.me())
    returning id into v_id;
  exception when unique_violation then
    if p_request is not null then select id into v_id from meetings where request_id = p_request; if found then return v_id; end if; end if;
    raise exception 'this lead already has an active meeting' using errcode = '23505';
  end;
  insert into meeting_events(meeting_id, event, new_value, by_employee)
    values (v_id, 'created', jsonb_build_object('scheduled_at', p_at, 'type', v_type, 'has_link', nullif(btrim(coalesce(p_url,'')),'') is not null), app.me());
  update leads set lead_status = 'Meeting Scheduled', updated_by = app.me(), last_contact_at = now() where id = p_lead;
  insert into lead_activities(lead_id, kind, status_to, note, created_by) values (p_lead, 'meeting', 'Meeting Scheduled', 'تم حجز اجتماع', app.me());
  v_deal := app._ensure_deal(p_lead, l.assigned_sales_id, 'Meeting Scheduled');
  select stage into v_stage from deals where id = v_deal;
  if v_stage in ('New Lead','Contacted','Qualified') then
    update deals set stage = 'Meeting Scheduled' where id = v_deal;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (v_deal, v_stage, 'Meeting Scheduled', 'حجز اجتماع', app.me());
  end if;
  if v_tele is not null then
    perform app._notify(v_tele, 'meeting_new', 'تم حجز اجتماع لعميلك', v_name || ' — ' || to_char(p_at at time zone app.company_tz(), 'YYYY-MM-DD HH24:MI'), '/meetings', 'mt_new:' || v_id);
  end if;
  return v_id;
end $$;

create or replace function app.update_meeting(p_meeting uuid, p_title text, p_at timestamptz, p_type text, p_url text, p_notes text, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare m meetings; v_link text; v_changed text[] := '{}'; v_time boolean; v_type text;
begin
  if not app.has_perm('meetings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into m from meetings where id = p_meeting for update;
  if not found or not app._meeting_actor(m.sales_rep_id) then raise exception 'no access' using errcode = '42501'; end if;
  if m.status not in ('Scheduled','Confirmed','Rescheduled') then raise exception 'meeting is already closed (%)', m.status; end if;
  if m.scheduled_at <= now() then raise exception 'meeting can only be edited before its time'; end if;
  v_link := app._check_link(p_url); v_type := coalesce(nullif(p_type,''), m.meeting_type);
  if v_type not in ('online','in_person','phone') then raise exception 'invalid meeting type'; end if;
  v_time := p_at is not null and p_at is distinct from m.scheduled_at;
  if v_time then
    if p_at <= now() then raise exception 'new time must be in the future'; end if;
    if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  end if;
  if coalesce(btrim(p_title),'') <> '' and btrim(p_title) is distinct from m.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_type is distinct from m.meeting_type then v_changed := array_append(v_changed, 'type'); end if;
  if v_link is distinct from m.meeting_url then v_changed := array_append(v_changed, 'link'); end if;
  if nullif(btrim(coalesce(p_notes,'')),'') is distinct from m.booking_notes then v_changed := array_append(v_changed, 'notes'); end if;
  if coalesce(btrim(p_reason),'') <> '' then perform set_config('app.reason', p_reason, true); end if;
  update meetings set title = coalesce(nullif(btrim(p_title),''), title), meeting_type = v_type, meeting_url = v_link,
         booking_notes = nullif(btrim(coalesce(p_notes,'')),''),
         scheduled_at = case when v_time then p_at else scheduled_at end,
         status = case when v_time then 'Rescheduled' else status end,
         reschedule_count = reschedule_count + case when v_time then 1 else 0 end,
         confirmed_at = case when v_time then null else confirmed_at end
   where id = p_meeting;
  if v_time then
    insert into meeting_events(meeting_id, event, old_value, new_value, reason, by_employee)
      values (p_meeting, 'rescheduled', jsonb_build_object('scheduled_at', m.scheduled_at), jsonb_build_object('scheduled_at', p_at), p_reason, app.me());
    if m.tele_sales_id is not null then
      perform app._notify(m.tele_sales_id, 'meeting_status', 'تم تغيير موعد اجتماع عميلك', to_char(p_at at time zone app.company_tz(), 'YYYY-MM-DD HH24:MI'), '/meetings',
                          'mt_rs:' || p_meeting || ':' || (m.reschedule_count + 1));
    end if;
  end if;
  if array_length(v_changed, 1) > 0 then
    insert into meeting_events(meeting_id, event, new_value, reason, by_employee)
      values (p_meeting, 'updated', jsonb_build_object('fields', to_jsonb(v_changed)), p_reason, app.me());   -- the link itself is never written to the event log
  end if;
end $$;

create or replace function app.complete_meeting(p_meeting uuid, p_outcome text, p_notes text, p_next_step text, p_next_at timestamptz)
returns void language plpgsql security definer set search_path = public, app as $$
declare m meetings;
begin
  if not app.has_perm('meetings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into m from meetings where id = p_meeting for update;
  if not found or not app._meeting_actor(m.sales_rep_id) then raise exception 'no access' using errcode = '42501'; end if;
  if m.status not in ('Scheduled','Confirmed','Rescheduled') then raise exception 'meeting is already closed (%)', m.status; end if;
  if m.scheduled_at > now() + interval '30 minutes' then raise exception 'meeting time has not arrived yet'; end if;
  if p_outcome is null or p_outcome not in ('positive','needs_followup','undecided','not_interested') then raise exception 'outcome required'; end if;
  if p_next_at is not null and coalesce(btrim(p_next_step),'') = '' then raise exception 'next step text required with a date'; end if;
  if p_next_at is not null and p_next_at <= now() then raise exception 'new time must be in the future'; end if;
  update meetings set status = 'Completed', completed_at = now(), outcome = p_outcome, result_notes = nullif(btrim(coalesce(p_notes,'')),''),
         next_step = nullif(btrim(coalesce(p_next_step,'')),''), next_step_at = p_next_at, outcome_by = app.me(), outcome_at = now()
   where id = p_meeting;
  insert into meeting_events(meeting_id, event, old_value, new_value, by_employee)
    values (p_meeting, 'completed', jsonb_build_object('status', m.status), jsonb_build_object('status', 'Completed', 'outcome', p_outcome), app.me());
  update leads set lead_status = 'Meeting Completed', updated_by = app.me() where id = m.lead_id;
  insert into lead_activities(lead_id, kind, status_to, note, created_by)
    values (m.lead_id, 'meeting', 'Meeting Completed', 'نتيجة الاجتماع: ' || p_outcome || coalesce(' — ' || nullif(btrim(coalesce(p_notes,'')),''), ''), app.me());
  update deals set stage = 'Meeting Completed' where lead_id = m.lead_id and stage = 'Meeting Scheduled';
  insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
    select d.id, 'Meeting Scheduled', 'Meeting Completed', 'انعقاد الاجتماع', app.me() from deals d where d.lead_id = m.lead_id and d.stage = 'Meeting Completed'
      and not exists (select 1 from deal_stage_history h where h.deal_id = d.id and h.to_stage = 'Meeting Completed');
  if p_next_at is not null then
    insert into follow_ups(lead_id, owner_id, due_at, reason, created_by) values (m.lead_id, m.sales_rep_id, p_next_at, btrim(p_next_step), app.me());
    update leads set next_followup_at = p_next_at where id = m.lead_id;
  end if;
  if m.tele_sales_id is not null then perform app._award_meetings(m.tele_sales_id); end if;
  perform app._award_meetings(m.sales_rep_id);
  if m.tele_sales_id is not null and m.tele_sales_id <> app.me() then
    perform app._notify(m.tele_sales_id, 'meeting_status', 'تم اجتماع عميلك', 'تم تسجيل نتيجة الاجتماع', '/meetings', 'mt_done:' || p_meeting);
  end if;
end $$;

-- confirm / cancel / no_show / reassign — only by the Sales owner, his manager or the Super Admin
create or replace function app.set_meeting_status(p_meeting uuid, p_action text, p_reason text, p_new_time timestamptz, p_new_rep uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare m meetings; v_new text; v_ev text;
begin
  if not app.has_perm('meetings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action not in ('confirm','cancel','no_show','reassign') then raise exception 'unknown action'; end if;
  select * into m from meetings where id = p_meeting for update;
  if not found or not app._meeting_actor(m.sales_rep_id) then raise exception 'no access' using errcode = '42501'; end if;
  if m.status not in ('Scheduled','Confirmed','Rescheduled') then raise exception 'meeting is already closed (%)', m.status; end if;
  if coalesce(btrim(p_reason),'') <> '' then perform set_config('app.reason', p_reason, true); end if;
  if p_action = 'confirm' then
    v_new := 'Confirmed'; v_ev := 'confirmed';
    update meetings set status = v_new, confirmed_at = coalesce(confirmed_at, now()) where id = p_meeting;
  elsif p_action = 'no_show' then
    if m.scheduled_at > now() + interval '30 minutes' then raise exception 'meeting time has not arrived yet'; end if;
    v_new := 'No Show'; v_ev := 'no_show';
    update meetings set status = v_new where id = p_meeting;
  elsif p_action = 'cancel' then
    if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
    v_new := 'Cancelled'; v_ev := 'cancelled';
    update meetings set status = v_new where id = p_meeting;
  else
    if not exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_new_rep and u.is_active and r.code in ('sales_rep','sales_manager')) then
      raise exception 'invalid sales representative';
    end if;
    update meetings set sales_rep_id = p_new_rep where id = p_meeting;
    update leads set assigned_sales_id = p_new_rep, current_owner_id = p_new_rep where id = m.lead_id;
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
      values (m.lead_id, 'sales', m.sales_rep_id, p_new_rep, app.me(), coalesce(p_reason, 'إعادة إسناد اجتماع'));
    update deals set owner_sales_id = p_new_rep where lead_id = m.lead_id and stage not in ('Lost','Financially Approved');
    insert into meeting_events(meeting_id, event, old_value, new_value, reason, by_employee)
      values (p_meeting, 'reassigned', jsonb_build_object('sales_rep_id', m.sales_rep_id), jsonb_build_object('sales_rep_id', p_new_rep), p_reason, app.me());
    perform app._notify(p_new_rep, 'meeting_new', 'تم إسناد اجتماع إليك', null, '/meetings', 'mt_re:' || p_meeting || ':' || p_new_rep || ':' || now()::text);
    return;
  end if;
  insert into meeting_events(meeting_id, event, old_value, new_value, reason, by_employee)
    values (p_meeting, v_ev, jsonb_build_object('status', m.status), jsonb_build_object('status', v_new), p_reason, app.me());
  if v_new in ('Cancelled','No Show') then
    update leads set lead_status = 'Follow-up Required', updated_by = app.me() where id = m.lead_id;
    insert into lead_activities(lead_id, kind, status_to, note, created_by)
      values (m.lead_id, 'meeting', 'Follow-up Required', 'الاجتماع: ' || v_new || coalesce(' — ' || nullif(btrim(p_reason),''), ''), app.me());
  end if;
  if m.tele_sales_id is not null and m.tele_sales_id <> app.me() then
    perform app._notify(m.tele_sales_id, 'meeting_status', 'تحديث حالة اجتماع عميلك', 'الحالة: ' || v_new, '/meetings', 'mt_st:' || p_meeting || ':' || v_new);
  end if;
end $$;

-- ───────── 7) history of the decisions a Sales person took (the rejected lead is no longer visible to him) ─────────
create or replace function app.my_handoff_decisions()
returns table(handoff_id uuid, lead_id uuid, client_name text, status text, from_name text, handed_at timestamptz,
              decided_at timestamptz, reject_reason text, reject_note text)
language sql stable security definer set search_path = public, app as $$
  select h.id, h.lead_id, c.name, h.status, app.emp_name(h.from_employee_id), h.handed_at, h.decided_at, h.reject_reason, h.reject_note
  from lead_handoffs h join leads l on l.id = h.lead_id join clients c on c.id = l.client_id
  where app.me() is not null and h.to_employee_id = app.me() and h.status in ('accepted','rejected')
  order by h.decided_at desc nulls last limit 200
$$;

-- what the creator sees about leads she handed off (accept/reject status + decision time + meeting + deal outcome only)
drop function if exists app.my_lead_outcomes();
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
  where app.me() is not null and l.original_creator_id = app.me() and l.handed_off_at is not null
  order by l.handed_off_at desc limit 300
$$;

-- ───────── 8b) meetings list for every viewer. Tele Sales no longer sees the lead after the hand-off, but still sees her meetings
-- (client name, time, status); the link and the private notes are returned only to the Sales owner, his manager and the admin.
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
  where (v_admin or m.tele_sales_id = v_me or m.sales_rep_id = v_me
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

create or replace function app.meeting_counts()
returns table(upcoming int, awaiting int, done int, cancelled int)
language sql stable security definer set search_path = public, app as $$
  select count(*) filter (where status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at >= now())::int,
         count(*) filter (where status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at < now())::int,
         count(*) filter (where status in ('Completed','No Show'))::int,
         count(*) filter (where status = 'Cancelled')::int
  from app.list_meetings('all', 500)
$$;

-- ───────── 9) privileges (same rules as 007/008) ─────────
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
