-- 008_phase1_refinement.sql — Phase 1 refinement (idempotent, additive, no data is deleted)
-- Statuses per the new brief, monthly archive, hand-off to Sales, achievements, faster search, stricter visibility.
create extension if not exists pg_trgm;
select set_config('app.allow_attribution_fix', 'on', true);   -- lets this migration back-fill protected columns

-- ───────── 1) lead statuses (existing rows are mapped, never dropped) ─────────
alter table leads disable trigger leads_touch;
alter table leads drop constraint if exists leads_lead_status_check;
update leads set lead_status = case lead_status when 'New' then 'New Lead' when 'Not Answered' then 'No Answer'
  when 'Call Back' then 'Follow-up Required' when 'Follow-up Later' then 'Follow-up Required' else lead_status end
 where lead_status in ('New','Not Answered','Call Back','Follow-up Later');
update lead_activities set status_to = case status_to when 'New' then 'New Lead' when 'Not Answered' then 'No Answer'
  when 'Call Back' then 'Follow-up Required' when 'Follow-up Later' then 'Follow-up Required' else status_to end
 where status_to in ('New','Not Answered','Call Back','Follow-up Later');
update lead_activities set status_from = case status_from when 'New' then 'New Lead' when 'Not Answered' then 'No Answer'
  when 'Call Back' then 'Follow-up Required' when 'Follow-up Later' then 'Follow-up Required' else status_from end
 where status_from in ('New','Not Answered','Call Back','Follow-up Later');
alter table leads add constraint leads_lead_status_check check (lead_status in
  ('New Lead','Contacted','No Answer','Interested','Not Interested','Follow-up Required','Qualified Lead',
   'Meeting Scheduled','Meeting Completed','Invalid Contact'));
alter table leads alter column lead_status set default 'New Lead';

-- ───────── 2) month, idempotency key, hand-off marker ─────────
alter table leads add column if not exists created_month date;
alter table leads add column if not exists request_id uuid;
alter table leads add column if not exists handed_off_at timestamptz;
update leads set created_month = date_trunc('month', created_at at time zone 'Asia/Riyadh')::date where created_month is null;
alter table leads alter column created_month set not null;
create or replace function app.set_created_month() returns trigger language plpgsql as $$
begin NEW.created_month := date_trunc('month', NEW.created_at at time zone 'Asia/Riyadh')::date; return NEW; end $$;
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

-- ───────── 3) indexes for fast search, pagination and archive ─────────
create index if not exists clients_name_trgm on clients using gin (name gin_trgm_ops);
create index if not exists clients_biz_trgm on clients using gin (business_name gin_trgm_ops);
create index if not exists contacts_phone_trgm on client_contacts using gin (phone gin_trgm_ops);
create index if not exists leads_creator_month on leads(original_creator_id, created_month);
create index if not exists leads_month_idx on leads(created_month);
create index if not exists leads_status_created on leads(lead_status, created_at desc);
create index if not exists leads_owner_created on leads(current_owner_id, created_at desc);
create index if not exists leads_sales_created on leads(assigned_sales_id, created_at desc) where assigned_sales_id is not null;
create index if not exists acts_by_time on lead_activities(created_by, created_at);
create index if not exists meetings_status_time on meetings(status, scheduled_at);

-- ───────── 4) targets: leads goal ─────────
alter table targets drop constraint if exists targets_metric_check;
alter table targets add constraint targets_metric_check check (metric in ('new_leads','completed_meetings','deals_won','contracted_revenue'));

-- ───────── 5) new tables ─────────
create table if not exists achievements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  period_month date not null,
  code text not null,
  achieved_at timestamptz not null default now(),
  unique (employee_id, period_month, code)
);
alter table achievements enable row level security;
drop policy if exists ach_read on achievements;
create policy ach_read on achievements for select to ghamer_app
  using (employee_id = app.me() or app.is_admin() or app.is_report(employee_id));
grant select on achievements to ghamer_app;

create table if not exists lead_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  from_employee_id uuid not null references employees(id),
  to_employee_id uuid references employees(id),
  status text not null default 'assigned' check (status in ('pending_distribution','assigned','received','cancelled')),
  note text,
  handed_at timestamptz not null default now(),
  assigned_at timestamptz,
  assigned_by uuid references employees(id),
  received_at timestamptz
);
create unique index if not exists handoffs_one_open on lead_handoffs(lead_id) where status in ('pending_distribution','assigned');
create index if not exists handoffs_to on lead_handoffs(to_employee_id, status);
alter table lead_handoffs enable row level security;
drop policy if exists handoffs_read on lead_handoffs;
create policy handoffs_read on lead_handoffs for select to ghamer_app
  using (from_employee_id = app.me() or to_employee_id = app.me() or app.is_admin() or app.is_report(from_employee_id) or app.is_report(to_employee_id));
grant select on lead_handoffs to ghamer_app;
drop trigger if exists audit_handoffs on lead_handoffs;
create trigger audit_handoffs after insert or update on lead_handoffs for each row execute function app.audit_row();

insert into permissions(key, description) values
  ('leads.handoff','تحويل عميل إلى Sales'), ('leads.distribute','توزيع العملاء المحوّلين')
on conflict (key) do nothing;
insert into role_permissions(role_id, permission_key, scope)
select r.id, g.perm, g.scope from (values
  ('tele_sales','leads.handoff','own'), ('tele_sales_manager','leads.handoff','team'),
  ('super_admin','leads.handoff','all'), ('super_admin','leads.distribute','all')) g(role_code, perm, scope)
join roles r on r.code = g.role_code on conflict do nothing;

-- ───────── 6) visibility: the creator stops seeing a lead once it is handed off to Sales ─────────
create or replace function app.lead_row_visible(p_creator uuid, p_owner uuid, p_sales uuid, p_handed timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when app.me() is null or app.role_code() is null then false
    when app.is_admin() then true
    when app.me() = p_sales then true
    when app.me() = p_owner and (p_handed is null or p_sales is not null) then true
    when app.me() = p_creator and p_handed is null then true
    when app.role_code() = 'tele_sales_manager' then app.is_report(p_creator) or app.is_report(p_owner)
    when app.role_code() = 'sales_manager' then app.is_report(p_owner) or app.is_report(p_sales)
    else false end
$$;
create or replace function app.lead_visible(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at) from leads l where l.id = p_lead), false)
$$;
create or replace function app.team_ids() returns setof uuid language sql stable security definer set search_path = public as
$$ select member_id from team_memberships where manager_id = app.me() $$;

drop policy if exists leads_read on leads;
create policy leads_read on leads for select to ghamer_app using (
  (select app.is_admin())
  or (current_owner_id = (select app.me()) and (handed_off_at is null or assigned_sales_id is not null))
  or assigned_sales_id = (select app.me())
  or (handed_off_at is null and original_creator_id = (select app.me()))
  or ((select app.role_code()) = 'tele_sales_manager' and (original_creator_id in (select app.team_ids()) or current_owner_id in (select app.team_ids())))
  or ((select app.role_code()) = 'sales_manager' and (current_owner_id in (select app.team_ids()) or assigned_sales_id in (select app.team_ids()))));
drop policy if exists leads_update on leads;
create policy leads_update on leads for update to ghamer_app
  using ((select app.has_perm('leads.edit')) and (
    (select app.is_admin()) or (current_owner_id = (select app.me()) and (handed_off_at is null or assigned_sales_id is not null)) or assigned_sales_id = (select app.me())
    or (handed_off_at is null and original_creator_id = (select app.me()))
    or ((select app.role_code()) = 'tele_sales_manager' and (original_creator_id in (select app.team_ids()) or current_owner_id in (select app.team_ids())))
    or ((select app.role_code()) = 'sales_manager' and (current_owner_id in (select app.team_ids()) or assigned_sales_id in (select app.team_ids())))))
  with check ((select app.has_perm('leads.edit')) and app.lead_row_visible(original_creator_id, current_owner_id, assigned_sales_id, handed_off_at));

drop policy if exists mt_read on meetings;
create policy mt_read on meetings for select to ghamer_app using (
  (select app.is_admin()) or tele_sales_id = (select app.me()) or sales_rep_id = (select app.me())
  or ((select app.role_code()) in ('tele_sales_manager','sales_manager') and (tele_sales_id in (select app.team_ids()) or sales_rep_id in (select app.team_ids()))));
drop policy if exists deals_read on deals;
create policy deals_read on deals for select to ghamer_app using (
  (select app.is_admin()) or owner_sales_id = (select app.me())
  or ((select app.role_code()) = 'sales_manager' and owner_sales_id in (select app.team_ids())));
drop policy if exists fu_read on follow_ups;
create policy fu_read on follow_ups for select to ghamer_app using (
  owner_id = (select app.me()) or (select app.is_admin()) or owner_id in (select app.team_ids()));

drop policy if exists clients_read on clients;
create policy clients_read on clients for select to ghamer_app
  using ((select app.me()) is not null and ((select app.is_admin()) or exists (select 1 from leads l where l.client_id = clients.id)));

-- back-fill: leads that already went to a Sales rep are marked as handed off (history kept)
update leads l set handed_off_at = coalesce((select min(a.created_at) from lead_assignments a where a.lead_id = l.id and a.kind = 'sales'), l.updated_at)
 where l.assigned_sales_id is not null and l.handed_off_at is null and l.original_creator_id is distinct from l.assigned_sales_id;
insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
select l.id, 'owner', l.current_owner_id, l.assigned_sales_id, l.original_creator_id, 'تحويل إلى Sales (تحديث النظام)'
from leads l where l.handed_off_at is not null and l.current_owner_id = l.original_creator_id and l.assigned_sales_id is not null;
update leads set current_owner_id = assigned_sales_id where handed_off_at is not null and current_owner_id = original_creator_id and assigned_sales_id is not null;
insert into lead_handoffs(lead_id, from_employee_id, to_employee_id, status, handed_at, assigned_at, assigned_by)
select l.id, l.original_creator_id, l.assigned_sales_id, 'assigned', l.handed_off_at, l.handed_off_at, l.original_creator_id
from leads l where l.handed_off_at is not null and l.assigned_sales_id is not null
  and not exists (select 1 from lead_handoffs h where h.lead_id = l.id);
alter table leads enable trigger leads_touch;
select set_config('app.allow_attribution_fix', 'off', true);

-- ───────── 7) helpers: month, achievements, hand-off ─────────
create or replace function app._month_start() returns date language sql stable as
$$ select date_trunc('month', now() at time zone 'Asia/Riyadh')::date $$;

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

create or replace function app._progress(p_emp uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object('month_count', (select count(*) from leads where original_creator_id = p_emp and created_month = app._month_start()),
    'goal', (select target_value from targets where employee_id = p_emp and period_month = app._month_start() and metric = 'new_leads'),
    'new_achievements', '[]'::jsonb)
$$;

create or replace function app._award_meetings(p_emp uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_m date := app._month_start(); v_n int; v_goal numeric; t int;
  s timestamptz := (app._month_start()::timestamp at time zone 'Asia/Riyadh');
  e timestamptz := ((app._month_start() + interval '1 month')::timestamp at time zone 'Asia/Riyadh');
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

create or replace function app._mark_handed(p_lead uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  update leads set current_owner_id = p_to, handed_off_at = coalesce(handed_off_at, now()) where id = p_lead;
  if not exists (select 1 from lead_handoffs where lead_id = p_lead and status in ('pending_distribution','assigned')) then
    insert into lead_handoffs(lead_id, from_employee_id, to_employee_id, status, assigned_at, assigned_by)
    values (p_lead, app.me(), p_to, 'assigned', now(), app.me());
  end if;
end $$;

create or replace function app._assign_to_sales(p_lead uuid, p_to uuid, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_owner uuid; v_sales uuid; v_name text;
begin
  select current_owner_id, assigned_sales_id into v_owner, v_sales from leads where id = p_lead;
  update leads set assigned_sales_id = p_to, current_owner_id = p_to, handed_off_at = coalesce(handed_off_at, now()), updated_by = app.me() where id = p_lead;
  insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason) values
    (p_lead, 'owner', v_owner, p_to, app.me(), coalesce(p_note, 'تحويل إلى Sales')),
    (p_lead, 'sales', v_sales, p_to, app.me(), coalesce(p_note, 'تحويل إلى Sales'));
  insert into lead_activities(lead_id, kind, note, created_by) values (p_lead, 'assignment', 'تم تحويل العميل إلى ' || app.emp_name(p_to), app.me());
  perform app._ensure_deal(p_lead, p_to, 'Qualified');
  select c.name into v_name from clients c join leads l on l.client_id = c.id where l.id = p_lead;
  perform app._notify(p_to, 'lead_assigned', 'تم تحويل عميل جديد إليك', v_name, '/leads/' || p_lead, 'ho:' || p_lead || ':' || p_to || ':' || now()::text);
end $$;

-- ───────── 8) patched existing functions ─────────
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
                        call_notes, next_followup_at, last_contact_at, updated_by, request_id)
      values (v_client, v_me, v_me, v_sales, v_status,
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'required_services','[]')) x), '{}'),
              nullif(p->>'call_notes',''), nullif(p->>'next_followup_at','')::timestamptz,
              case when v_status <> 'New Lead' then now() end, v_me, v_req)
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

create or replace function app.book_meeting(p_lead uuid, p_sales_rep uuid, p_at timestamptz, p_url text, p_notes text)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_role text := app.role_code(); v_prev uuid; v_stage text; v_client text; v_deal uuid;
begin
  if not app.has_perm('meetings.create') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  if p_at <= now() then raise exception 'meeting time must be in the future'; end if;
  if not exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_sales_rep and u.is_active and r.code in ('sales_rep','sales_manager')) then
    raise exception 'invalid sales representative';
  end if;
  if v_role in ('sales_rep','sales_manager') and p_sales_rep <> app.me() and not app.is_report(p_sales_rep) then
    raise exception 'cannot book for another sales rep' using errcode = '42501';
  end if;
  begin
    insert into meetings(lead_id, tele_sales_id, sales_rep_id, scheduled_at, meeting_url, booking_notes, created_by)
    values (p_lead, case when v_role in ('tele_sales','tele_sales_manager') then app.me() end, p_sales_rep, p_at,
            nullif(btrim(p_url),''), nullif(btrim(p_notes),''), app.me())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'this lead already has an active meeting' using errcode = '23505';
  end;
  insert into meeting_events(meeting_id, event, new_value, by_employee)
    values (v_id, 'created', jsonb_build_object('scheduled_at', p_at, 'sales_rep_id', p_sales_rep), app.me());
  select assigned_sales_id into v_prev from leads where id = p_lead;
  update leads set lead_status = 'Meeting Scheduled', assigned_sales_id = p_sales_rep, updated_by = app.me(), last_contact_at = now()
    where id = p_lead;
  if v_prev is distinct from p_sales_rep then
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
      values (p_lead, 'sales', v_prev, p_sales_rep, app.me(), 'حجز اجتماع');
  end if;
  insert into lead_activities(lead_id, kind, status_to, note, created_by)
    values (p_lead, 'meeting', 'Meeting Scheduled', 'تم حجز اجتماع', app.me());
  v_deal := app._ensure_deal(p_lead, p_sales_rep, 'Meeting Scheduled');
  select stage into v_stage from deals where id = v_deal;
  if v_stage in ('New Lead','Contacted','Qualified') then
    update deals set stage = 'Meeting Scheduled' where id = v_deal;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (v_deal, v_stage, 'Meeting Scheduled', 'حجز اجتماع', app.me());
  end if;
  if v_role in ('tele_sales','tele_sales_manager') then perform app._mark_handed(p_lead, p_sales_rep); end if;
  select name into v_client from clients c join leads l on l.client_id = c.id where l.id = p_lead;
  if p_sales_rep <> app.me() then
    perform app._notify(p_sales_rep, 'meeting_new', 'اجتماع جديد', coalesce(v_client,'') || ' — ' || to_char(p_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
                        '/meetings', 'mt_new:' || v_id);
  end if;
  return v_id;
end $$;

create or replace function app.set_meeting_status(p_meeting uuid, p_action text, p_reason text, p_new_time timestamptz, p_new_rep uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare m meetings; v_role text := app.role_code(); v_is_rep boolean; v_is_mgr boolean; v_new text; v_lead_status text; v_ev text; v_deal uuid;
begin
  if not app.has_perm('meetings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into m from meetings where id = p_meeting for update;
  if not found or not app.row_visible(m.tele_sales_id, m.sales_rep_id, null) then raise exception 'no access' using errcode = '42501'; end if;
  if m.status not in ('Scheduled','Confirmed','Rescheduled') then raise exception 'meeting is already closed (%)', m.status; end if;
  v_is_rep := (m.sales_rep_id = app.me());
  v_is_mgr := app.is_super() or app.is_report(m.sales_rep_id) or app.is_report(m.tele_sales_id);
  if coalesce(btrim(p_reason),'') <> '' then perform set_config('app.reason', p_reason, true); end if;

  if p_action = 'confirm' then
    v_new := 'Confirmed'; v_ev := 'confirmed';
    update meetings set status = v_new, confirmed_at = coalesce(confirmed_at, now()) where id = p_meeting;
  elsif p_action in ('complete','no_show') then
    -- only the meeting's sales rep (or a manager/admin) can mark it as held: protects the Tele Sales target
    if not (v_is_rep or v_is_mgr) then raise exception 'only the sales rep or a manager can set this' using errcode = '42501'; end if;
    if m.scheduled_at > now() + interval '30 minutes' then raise exception 'meeting time has not arrived yet'; end if;
    v_new := case p_action when 'complete' then 'Completed' else 'No Show' end;
    v_ev := case p_action when 'complete' then 'completed' else 'no_show' end;
    update meetings set status = v_new, completed_at = case when p_action = 'complete' then now() end where id = p_meeting;
  elsif p_action = 'cancel' then
    if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
    v_new := 'Cancelled'; v_ev := 'cancelled';
    update meetings set status = v_new where id = p_meeting;
  elsif p_action = 'reschedule' then
    if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
    if p_new_time is null or p_new_time <= now() then raise exception 'new time must be in the future'; end if;
    v_new := 'Rescheduled'; v_ev := 'rescheduled';
    update meetings set status = v_new, scheduled_at = p_new_time, reschedule_count = reschedule_count + 1, confirmed_at = null where id = p_meeting;
  elsif p_action = 'reassign' then
    if not (v_is_mgr or v_is_rep or m.tele_sales_id = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
    if not exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_new_rep and u.is_active and r.code in ('sales_rep','sales_manager')) then
      raise exception 'invalid sales representative';
    end if;
    update meetings set sales_rep_id = p_new_rep where id = p_meeting;
    update leads set assigned_sales_id = p_new_rep where id = m.lead_id;
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
      values (m.lead_id, 'sales', m.sales_rep_id, p_new_rep, app.me(), coalesce(p_reason,'إعادة إسناد اجتماع'));
    v_deal := app._ensure_deal(m.lead_id, p_new_rep, 'Meeting Scheduled');
    insert into meeting_events(meeting_id, event, old_value, new_value, reason, by_employee)
      values (p_meeting, 'reassigned', jsonb_build_object('sales_rep_id', m.sales_rep_id), jsonb_build_object('sales_rep_id', p_new_rep), p_reason, app.me());
    perform app._notify(p_new_rep, 'meeting_new', 'تم إسناد اجتماع إليك', null, '/meetings', 'mt_re:' || p_meeting || ':' || p_new_rep || ':' || now()::text);
    return;
  else
    raise exception 'unknown action';
  end if;

  insert into meeting_events(meeting_id, event, old_value, new_value, reason, by_employee)
    values (p_meeting, v_ev, jsonb_build_object('status', m.status, 'scheduled_at', m.scheduled_at),
            jsonb_build_object('status', v_new, 'scheduled_at', coalesce(p_new_time, m.scheduled_at)), p_reason, app.me());

  v_lead_status := case v_new when 'Completed' then 'Meeting Completed' when 'Cancelled' then 'Follow-up Required' when 'No Show' then 'Follow-up Required' else null end;
  if v_lead_status is not null then
    update leads set lead_status = v_lead_status, updated_by = app.me() where id = m.lead_id;
    insert into lead_activities(lead_id, kind, status_to, note, created_by)
      values (m.lead_id, 'meeting', v_lead_status, 'الاجتماع: ' || v_new, app.me());
  end if;
  if v_new = 'Completed' then
    update deals set stage = 'Meeting Completed' where lead_id = m.lead_id and stage = 'Meeting Scheduled';
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
      select id, 'Meeting Scheduled', 'Meeting Completed', 'انعقاد الاجتماع', app.me() from deals where lead_id = m.lead_id and stage = 'Meeting Completed'
        and not exists (select 1 from deal_stage_history h where h.deal_id = deals.id and h.to_stage = 'Meeting Completed');
  end if;
  if v_new = 'Completed' then
    if m.tele_sales_id is not null then perform app._award_meetings(m.tele_sales_id); end if;
    perform app._award_meetings(m.sales_rep_id);
  end if;
  -- notify the other party
  if m.tele_sales_id is not null and m.tele_sales_id <> app.me() then
    perform app._notify(m.tele_sales_id, 'meeting_status', 'تحديث حالة اجتماع', 'الحالة: ' || v_new, '/meetings', 'mt_st:' || p_meeting || ':' || v_new || ':' || coalesce(m.reschedule_count,0) || ':' || (case when v_new='Rescheduled' then m.reschedule_count+1 else m.reschedule_count end));
  end if;
  if m.sales_rep_id <> app.me() and v_new in ('Cancelled','Rescheduled','Confirmed') then
    perform app._notify(m.sales_rep_id, 'meeting_status', 'تحديث حالة اجتماع', 'الحالة: ' || v_new, '/meetings', 'mt_st2:' || p_meeting || ':' || v_new || ':' || (case when v_new='Rescheduled' then m.reschedule_count+1 else m.reschedule_count end));
  end if;
end $$;

create or replace function app.tele_stats(p_emp uuid, p_month date)
returns table(new_leads int, interested_leads int, meetings_scheduled int, meetings_confirmed int, meetings_completed int,
              meetings_cancelled int, meetings_no_show int, lead_to_meeting_pct numeric, contracts_generated int, target numeric)
language plpgsql stable security definer set search_path = public, app as $$
declare s timestamptz := (p_month::timestamp at time zone 'Asia/Riyadh'); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Riyadh');
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
declare s timestamptz := (p_month::timestamp at time zone 'Asia/Riyadh'); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Riyadh'); v_won int; v_lost int;
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
      and m.completed_at >= (v_month::timestamp at time zone 'Asia/Riyadh') and m.completed_at < ((v_month + interval '1 month')::timestamp at time zone 'Asia/Riyadh');
    if v_done >= 0.8 * r.target_value and v_done < r.target_value then
      perform app._notify(r.employee_id, 'target_near', 'اقتربتِ من التارجت', v_done || ' من ' || r.target_value, '/targets', 'tg80:' || r.employee_id || ':' || v_month);
      v_target := v_target + 1;
    end if;
  end loop;
  update job_runs set finished_at = now(), status = 'done', details = jsonb_build_object('overdue', v_overdue, 'target_near', v_target) where id = v_inserted;
  return jsonb_build_object('status','done','overdue',v_overdue,'target_near',v_target);
end $$;


-- ───────── 9) hand-off to Sales ─────────
create or replace function app.handoff_lead(p_lead uuid, p_to uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_status text; v_ho uuid; v_admin uuid; v_name text;
begin
  if not app.has_perm('leads.handoff') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  select l.lead_status, c.name into v_status, v_name from leads l join clients c on c.id = l.client_id where l.id = p_lead for update of l;
  if v_status not in ('Interested','Qualified Lead') then raise exception 'lead must be Interested or Qualified before handoff'; end if;
  if exists (select 1 from lead_handoffs where lead_id = p_lead and status in ('pending_distribution','assigned')) then
    raise exception 'lead already handed off';
  end if;
  if p_to is not null and not exists (select 1 from users u join roles r on r.id = u.role_id
                                       where u.id = p_to and u.is_active and r.code in ('sales_rep','sales_manager')) then
    raise exception 'invalid sales representative';
  end if;
  insert into lead_handoffs(lead_id, from_employee_id, to_employee_id, status, note, assigned_at, assigned_by)
  values (p_lead, app.me(), p_to, case when p_to is null then 'pending_distribution' else 'assigned' end, nullif(btrim(p_note),''),
          case when p_to is null then null else now() end, case when p_to is null then null else app.me() end)
  returning id into v_ho;
  if p_to is null then
    update leads set handed_off_at = coalesce(handed_off_at, now()) where id = p_lead;
    insert into lead_activities(lead_id, kind, note, created_by) values (p_lead, 'assignment', 'تم إرسال العميل للإدارة للتوزيع على Sales', app.me());
    for v_admin in select u.id from users u join roles r on r.id = u.role_id where r.code = 'super_admin' and u.is_active loop
      perform app._notify(v_admin, 'lead_pending_distribution', 'عميل بانتظار التوزيع على Sales', v_name, '/distribution', 'dist:' || v_ho || ':' || v_admin);
    end loop;
  else
    perform app._assign_to_sales(p_lead, p_to, nullif(btrim(p_note),''));
  end if;
  return jsonb_build_object('handoff_id', v_ho, 'status', case when p_to is null then 'pending_distribution' else 'assigned' end);
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
  update lead_handoffs set status = 'assigned', to_employee_id = p_to, assigned_at = now(), assigned_by = app.me() where id = p_handoff;
  perform app._notify(h.from_employee_id, 'handoff_assigned', 'تم توزيع العميل الذي حوّلته', 'المستلم: ' || app.emp_name(p_to), '/', 'hoa:' || p_handoff);
end $$;

create or replace function app.acknowledge_handoff(p_lead uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_from uuid;
begin
  update lead_handoffs set status = 'received', received_at = now()
   where lead_id = p_lead and to_employee_id = app.me() and status = 'assigned' returning id, from_employee_id into v_id, v_from;
  if v_id is null then raise exception 'no pending handoff for you'; end if;
  insert into lead_activities(lead_id, kind, note, created_by) values (p_lead, 'assignment', 'تم استلام العميل', app.me());
  perform app._notify(v_from, 'handoff_received', 'تم استلام العميل الذي حوّلته', 'استلمه ' || app.emp_name(app.me()), '/', 'hor:' || v_id);
end $$;

create or replace function app.pending_handoffs()
returns table(handoff_id uuid, lead_id uuid, client_name text, business_name text, from_name text, note text, handed_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select h.id, h.lead_id, c.name, c.business_name, app.emp_name(h.from_employee_id), h.note, h.handed_at
  from lead_handoffs h join leads l on l.id = h.lead_id join clients c on c.id = l.client_id
  where app.has_perm('leads.distribute') and h.status = 'pending_distribution' order by h.handed_at
$$;

-- what the creator (Tele Sales) sees about leads she handed off: status of the hand-off, meeting and deal outcome only
drop function if exists app.my_lead_outcomes();
create or replace function app.my_lead_outcomes()
returns table(lead_id uuid, client_name text, business_name text, lead_status text, handed_off_at timestamptz,
              handoff_status text, to_name text, received_at timestamptz, meeting_status text, deal_outcome text)
language sql stable security definer set search_path = public, app as $$
  select l.id, c.name, c.business_name, l.lead_status, l.handed_off_at,
    (select h.status from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
    app.emp_name(l.assigned_sales_id),
    (select h.received_at from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
    (select m.status from meetings m where m.lead_id = l.id order by m.created_at desc limit 1),
    (select case when d.stage in ('Signed / Finance Pending','Financially Approved') then 'won' when d.stage = 'Lost' then 'lost' else 'open' end
       from deals d where d.lead_id = l.id order by d.created_at desc limit 1)
  from leads l join clients c on c.id = l.client_id
  where app.me() is not null and l.original_creator_id = app.me() and l.handed_off_at is not null
  order by l.handed_off_at desc limit 300
$$;

-- ───────── 10) progress, monthly archive ─────────
create or replace function app.my_progress(p_emp uuid, p_month date)
returns table(month_count int, goal numeric, handed_off int, received int, meetings_completed int, achievements jsonb)
language plpgsql stable security definer set search_path = public, app as $$
declare s timestamptz := (p_month::timestamp at time zone 'Asia/Riyadh'); e timestamptz := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Riyadh');
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
    union select date_trunc('month', h.handed_at at time zone 'Asia/Riyadh')::date from lead_handoffs h where h.from_employee_id = v_emp
    union select date_trunc('month', h.assigned_at at time zone 'Asia/Riyadh')::date from lead_handoffs h where h.to_employee_id = v_emp and h.assigned_at is not null
    union select date_trunc('month', m.completed_at at time zone 'Asia/Riyadh')::date from meetings m where m.status = 'Completed' and (m.tele_sales_id = v_emp or m.sales_rep_id = v_emp)
    union select period_month from achievements where employee_id = v_emp)
  select x.m,
    (select count(*)::int from leads l where l.original_creator_id = v_emp and l.created_month = x.m),
    (select count(*)::int from lead_handoffs h where h.from_employee_id = v_emp and date_trunc('month', h.handed_at at time zone 'Asia/Riyadh')::date = x.m),
    (select count(*)::int from lead_handoffs h where h.to_employee_id = v_emp and h.assigned_at is not null and date_trunc('month', h.assigned_at at time zone 'Asia/Riyadh')::date = x.m),
    (select count(*)::int from meetings mm where mm.status = 'Completed' and (mm.tele_sales_id = v_emp or mm.sales_rep_id = v_emp) and date_trunc('month', mm.completed_at at time zone 'Asia/Riyadh')::date = x.m),
    (select count(*)::int from achievements a where a.employee_id = v_emp and a.period_month = x.m)
  from months x where x.m is not null order by x.m desc;
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
  where (v_emp is null or l.original_creator_id = v_emp or l.assigned_sales_id = v_emp)
    and (p_month is null or l.created_month = p_month) and (p_status is null or l.lead_status = p_status)
  order by l.created_at desc limit least(coalesce(p_limit, 20), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ───────── 11) session lookup now also returns the unread count (one round trip less per page) ─────────
drop function if exists app.session_get(text);
create or replace function app.session_get(p_hash text)
returns table(user_id uuid, full_name text, email citext, role_code text, role_name_ar text,
              mfa_verified boolean, mfa_required boolean, mfa_enabled boolean, must_change_password boolean, unread int, perms text[])
language plpgsql security definer set search_path = public as $$
begin
  update sessions set last_seen_at = now() where token_hash = p_hash and last_seen_at < now() - interval '1 minute';
  return query
    select u.id, e.full_name, u.email, r.code, r.name_ar, s.mfa_verified, r.mfa_required, u.mfa_enabled, u.must_change_password,
           (select count(*)::int from notifications n where n.user_id = u.id and n.read_at is null),
           coalesce((select array_agg(rp.permission_key) from role_permissions rp where rp.role_id = r.id), '{}')
    from sessions s join users u on u.id = s.user_id join employees e on e.id = u.id join roles r on r.id = u.role_id
    where s.token_hash = p_hash and s.expires_at > now() and u.is_active;
end $$;

-- ───────── text search that can use the trigram indexes ─────────
-- RLS prevents index use for ILIKE (the operator is not "leakproof"), so the search runs in a definer function that applies the
-- same visibility rules once per statement (plain variables, not per-row function calls) and returns only rows the caller may see.
create or replace function app.search_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_limit int, p_offset int)
returns table(id uuid, client_id uuid, lead_status text, next_followup_at timestamptz, created_at timestamptz, last_contact_at timestamptz,
              original_creator_id uuid, current_owner_id uuid, assigned_sales_id uuid, total int)
language plpgsql stable security definer set search_path = public, app as $$
declare v_me uuid := app.me(); v_role text := app.role_code(); v_team uuid[] := array(select app.team_ids());
        v_pat text := '%' || replace(replace(replace(coalesce(p_q,''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if v_me is null or v_role is null then return; end if;
  return query
  select l.id, l.client_id, l.lead_status, l.next_followup_at, l.created_at, l.last_contact_at,
         l.original_creator_id, l.current_owner_id, l.assigned_sales_id, count(*) over()::int
  from leads l join clients c on c.id = l.client_id
  where ((p_phone is null and (c.name ilike v_pat or c.business_name ilike v_pat))
         or (p_phone is not null and c.id in (select cc.client_id from client_contacts cc where cc.phone like p_phone)))
    and (p_status is null or l.lead_status = p_status) and (p_month is null or l.created_month = p_month)
    and (p_creator is null or l.original_creator_id = p_creator)
    and (v_role in ('super_admin','general_manager')
         or (l.current_owner_id = v_me and (l.handed_off_at is null or l.assigned_sales_id is not null)) or l.assigned_sales_id = v_me
         or (l.handed_off_at is null and l.original_creator_id = v_me)
         or (v_role = 'tele_sales_manager' and (l.original_creator_id = any(v_team) or l.current_owner_id = any(v_team)))
         or (v_role = 'sales_manager' and (l.current_owner_id = any(v_team) or l.assigned_sales_id = any(v_team))))
  order by l.created_at desc limit least(coalesce(p_limit, 20), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ───────── 12) privileges (same rules as 007) ─────────
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
