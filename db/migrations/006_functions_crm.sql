-- 006_functions_crm.sql — lead registration + duplicate guard, meetings, deals, transfers, stats

-- internal: notification with de-duplication (never executable by the app role)
create or replace function app._notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, link, dedupe_key)
  values (p_user, p_kind, p_title, p_body, p_link, p_dedupe) on conflict (user_id, dedupe_key) do nothing
$$;

-- internal: duplicate response. Reveals ONLY the responsible employee's name.
create or replace function app._dup_response(p_client uuid, p_kinds text[], p_ambiguous boolean)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v_owner uuid; v_name text;
begin
  select l.current_owner_id into v_owner from leads l where l.client_id = p_client order by l.created_at desc limit 1;
  if v_owner is null then select original_creator_id into v_owner from clients where id = p_client; end if;
  v_name := app.emp_name(v_owner);
  if v_owner is not null and v_owner <> app.me() then
    perform app._notify(v_owner, 'duplicate_attempt', 'محاولة تسجيل عميل مكرر',
      app.emp_name(app.me()) || ' حاولت تسجيل عميل مسجل لديك', null,
      'dup:' || app.me() || ':' || p_client || ':' || current_date);
  end if;
  return jsonb_build_object('status','duplicate','existing_client_id',p_client,'owner_name',v_name,
                            'matched_kinds',to_jsonb(p_kinds),'ambiguous',p_ambiguous);
end $$;

-- internal: find an existing client for a set of identifiers
create or replace function app._find_dup(p_ids jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_client uuid; v_kinds text[]; v_n int;
begin
  select count(distinct ci.client_id), array_agg(distinct ci.kind)
    into v_n, v_kinds
  from client_identifiers ci
  join jsonb_to_recordset(p_ids) as x(kind text, value text, label text) on x.kind = ci.kind and x.value = ci.value;
  if v_n = 0 then return null; end if;
  select ci.client_id into v_client from client_identifiers ci
    join jsonb_to_recordset(p_ids) as x(kind text, value text, label text) on x.kind = ci.kind and x.value = ci.value
    join clients c on c.id = ci.client_id order by c.created_at limit 1;
  return app._dup_response(v_client, v_kinds, v_n > 1 or (v_kinds @> array['phone'] and v_kinds @> array['store'] and false));
end $$;

-- internal: write contacts/stores/identifiers for a client (replace-all). Raises unique_violation on conflicts.
create or replace function app._write_contacts(p_client uuid, p jsonb, p_replace boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if p_replace then
    delete from client_contacts where client_id = p_client;
    delete from client_stores where client_id = p_client;
    delete from client_identifiers where client_id = p_client;
  end if;
  insert into client_contacts(client_id, label, phone, email, contact_name, is_primary)
  select p_client, coalesce(x.label,'mobile'), x.phone, x.email, x.contact_name, coalesce(x.is_primary,false)
  from jsonb_to_recordset(coalesce(p->'contacts','[]')) as x(label text, phone text, email text, contact_name text, is_primary boolean);
  insert into client_stores(client_id, url_raw, url_key)
  select p_client, x.url_raw, x.url_key from jsonb_to_recordset(coalesce(p->'stores','[]')) as x(url_raw text, url_key text);
  insert into client_identifiers(client_id, kind, value, label)
  select distinct on (x.kind, x.value) p_client, x.kind, x.value, x.label
  from jsonb_to_recordset(coalesce(p->'identifiers','[]')) as x(kind text, value text, label text);
end $$;

-- internal: ensure a deal (+ brief) exists for a lead
create or replace function app._ensure_deal(p_lead uuid, p_owner uuid, p_stage text)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_deal uuid; v_client uuid; v_old uuid; v_stage text;
begin
  select client_id into v_client from leads where id = p_lead;
  select id, owner_sales_id, stage into v_deal, v_old, v_stage from deals
    where lead_id = p_lead and stage not in ('Lost','Financially Approved') order by created_at desc limit 1;
  if v_deal is null then
    insert into deals(client_id, lead_id, owner_sales_id, stage, created_by) values (v_client, p_lead, p_owner, p_stage, app.me())
      returning id into v_deal;
    insert into deal_briefs(deal_id) values (v_deal);
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (v_deal, null, p_stage, 'إنشاء الصفقة', app.me());
  elsif v_old <> p_owner then
    update deals set owner_sales_id = p_owner where id = v_deal;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
      values (v_deal, v_stage, v_stage, 'إعادة إسناد الصفقة', app.me());
  end if;
  return v_deal;
end $$;

-- ───────── register a lead (or an existing client) ─────────
create or replace function app.register_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_me uuid := app.me(); v_role text := app.role_code(); v_ids jsonb := coalesce(p->'identifiers','[]'::jsonb);
  v_existing boolean := coalesce(p->>'mode','lead') = 'existing';
  v_client uuid; v_lead uuid; v_dup jsonb; v_sales uuid; v_status text;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if v_existing then
    if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif not app.has_perm('leads.create') then raise exception 'not allowed' using errcode = '42501';
  end if;
  if btrim(coalesce(p->>'name','')) = '' then raise exception 'name required'; end if;
  if jsonb_array_length(v_ids) = 0 then raise exception 'at least one phone or store required'; end if;

  v_dup := app._find_dup(v_ids);
  if v_dup is not null then return v_dup; end if;

  v_sales := case when v_role in ('sales_rep','sales_manager') then v_me end;
  v_status := coalesce(nullif(p->>'lead_status',''), 'New');
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
                        call_notes, next_followup_at, last_contact_at, updated_by)
      values (v_client, v_me, v_me, v_sales, v_status,
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'required_services','[]')) x), '{}'),
              nullif(p->>'call_notes',''), nullif(p->>'next_followup_at','')::timestamptz,
              case when v_status <> 'New' then now() end, v_me)
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
    v_dup := app._find_dup(v_ids);
    if v_dup is null then raise; end if;
    return v_dup;
  end;
  return jsonb_build_object('status','created','client_id',v_client,'lead_id',v_lead);
end $$;

-- invoker: row visibility is enforced by RLS on the SELECT below
create or replace function app.update_client_contacts(p_client uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = public, app as $$
declare v_dup jsonb;
begin
  if not app.has_perm('leads.edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform 1 from clients where id = p_client;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  begin
    perform app._write_contacts(p_client, p, true);
  exception when unique_violation then
    v_dup := app._find_dup(p->'identifiers');
    return coalesce(v_dup, jsonb_build_object('status','duplicate','owner_name',null));
  end;
  return jsonb_build_object('status','updated');
end $$;

-- ───────── ownership review & transfer ─────────
create or replace function app.request_ownership_review(p_existing_client uuid, p_reason text, p_attempted jsonb)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_mgr uuid;
begin
  if not app.has_perm('duplicates.request') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  if not exists (select 1 from clients where id = p_existing_client) then raise exception 'not found'; end if;
  insert into duplicate_reviews(existing_client_id, requested_by, attempted, reason)
    values (p_existing_client, app.me(), coalesce(p_attempted,'{}'), btrim(p_reason)) returning id into v_id;
  for v_mgr in select manager_id from team_memberships where member_id = app.me() loop
    perform app._notify(v_mgr, 'ownership_review', 'طلب مراجعة ملكية عميل', app.emp_name(app.me()) || ': ' || btrim(p_reason),
                        '/duplicates', 'own:' || v_id || ':' || v_mgr);
  end loop;
  return v_id;
end $$;

create or replace function app.transfer_lead(p_lead uuid, p_to uuid, p_kind text, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_from uuid; v_deal record;
begin
  if not app.has_perm('leads.transfer') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  if p_kind not in ('owner','sales') then raise exception 'bad kind'; end if;
  if not exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_to and u.is_active
                 and r.code in ('tele_sales','tele_sales_manager','sales_rep','sales_manager')) then
    raise exception 'invalid target employee';
  end if;
  if not (app.is_super() or app.is_report(p_to) or p_to = app.me()) then
    raise exception 'target employee outside your team' using errcode = '42501';
  end if;
  perform set_config('app.reason', p_reason, true);
  if p_kind = 'owner' then
    select current_owner_id into v_from from leads where id = p_lead;
    update leads set current_owner_id = p_to where id = p_lead;
  else
    select assigned_sales_id into v_from from leads where id = p_lead;
    update leads set assigned_sales_id = p_to where id = p_lead;
    update meetings set sales_rep_id = p_to where lead_id = p_lead and status in ('Scheduled','Confirmed','Rescheduled');
    for v_deal in select id from deals where lead_id = p_lead and stage not in ('Lost','Financially Approved') loop
      update deals set owner_sales_id = p_to where id = v_deal.id;
      insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
        select id, stage, stage, 'إعادة إسناد: ' || p_reason, app.me() from deals where id = v_deal.id;
    end loop;
  end if;
  insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
    values (p_lead, p_kind, v_from, p_to, app.me(), p_reason);
  insert into lead_activities(lead_id, kind, note, created_by) values (p_lead, 'assignment', p_reason, app.me());
  perform app._notify(p_to, 'lead_assigned', 'تم إسناد عميل إليك', p_reason, '/leads/' || p_lead, 'assign:' || p_lead || ':' || p_to || ':' || now()::text);
end $$;

create or replace function app.resolve_duplicate_review(p_review uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_r duplicate_reviews; v_lead uuid;
begin
  if not app.has_perm('duplicates.review') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_r from duplicate_reviews where id = p_review and status = 'open' for update;
  if not found then raise exception 'review not open'; end if;
  if not (app.is_admin() or app.is_report(v_r.requested_by)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_decision not in ('transfer','reject') then raise exception 'bad decision'; end if;
  if coalesce(btrim(p_note),'') = '' then raise exception 'note required'; end if;
  perform set_config('app.reason', p_note, true);
  if p_decision = 'transfer' then
    select id into v_lead from leads where client_id = v_r.existing_client_id order by created_at desc limit 1;
    if v_lead is null then raise exception 'no lead to transfer'; end if;
    update leads set current_owner_id = v_r.requested_by where id = v_lead;
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
      select v_lead, 'owner', (select current_owner_id from leads where id = v_lead), v_r.requested_by, app.me(), p_note;
  end if;
  update duplicate_reviews set status = case p_decision when 'transfer' then 'transferred' else 'rejected' end,
         resolved_by = app.me(), resolved_at = now(), resolution_note = p_note where id = p_review;
  perform app._notify(v_r.requested_by, 'ownership_review_result', 'نتيجة طلب مراجعة الملكية',
                      case p_decision when 'transfer' then 'تم نقل العميل إليك' else 'تم رفض الطلب' end || ': ' || p_note,
                      '/leads', 'ownres:' || p_review);
end $$;

-- exceptional correction of the original source / creator (admin only, reason + audit)
create or replace function app.correct_attribution(p_client uuid, p_new_source text, p_new_creator uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not app.has_perm('leads.correct_source') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  perform set_config('app.reason', p_reason, true);
  perform set_config('app.allow_attribution_fix', 'on', true);
  update clients set original_source = coalesce(nullif(p_new_source,''), original_source),
                     original_creator_id = coalesce(p_new_creator, original_creator_id) where id = p_client;
  if p_new_creator is not null then
    update leads set original_creator_id = p_new_creator where client_id = p_client;
  end if;
  perform set_config('app.allow_attribution_fix', 'off', true);
end $$;

-- ───────── meetings ─────────
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
  select name into v_client from clients c join leads l on l.client_id = c.id where l.id = p_lead;
  if p_sales_rep <> app.me() then
    perform app._notify(p_sales_rep, 'meeting_new', 'اجتماع جديد', coalesce(v_client,'') || ' — ' || to_char(p_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
                        '/meetings', 'mt_new:' || v_id);
  end if;
  return v_id;
end $$;

-- actions: confirm | complete | cancel | no_show | reschedule | reassign
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

  v_lead_status := case v_new when 'Completed' then 'Meeting Completed' when 'Cancelled' then 'Follow-up Later' when 'No Show' then 'Follow-up Later' else null end;
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
  -- notify the other party
  if m.tele_sales_id is not null and m.tele_sales_id <> app.me() then
    perform app._notify(m.tele_sales_id, 'meeting_status', 'تحديث حالة اجتماع', 'الحالة: ' || v_new, '/meetings', 'mt_st:' || p_meeting || ':' || v_new || ':' || coalesce(m.reschedule_count,0) || ':' || (case when v_new='Rescheduled' then m.reschedule_count+1 else m.reschedule_count end));
  end if;
  if m.sales_rep_id <> app.me() and v_new in ('Cancelled','Rescheduled','Confirmed') then
    perform app._notify(m.sales_rep_id, 'meeting_status', 'تحديث حالة اجتماع', 'الحالة: ' || v_new, '/meetings', 'mt_st2:' || p_meeting || ':' || v_new || ':' || (case when v_new='Rescheduled' then m.reschedule_count+1 else m.reschedule_count end));
  end if;
end $$;

-- ───────── deals ─────────
create or replace function app.move_deal_stage(p_deal uuid, p_to text, p_reason text, p_followup timestamptz, p_followup_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare d deals;
begin
  if not app.has_perm('deals.edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from deals where id = p_deal for update;
  if not found or not app.deal_visible(d.owner_sales_id) then raise exception 'no access' using errcode = '42501'; end if;
  if d.stage = p_to then return; end if;
  if d.stage in ('Lost','Financially Approved') then raise exception 'deal is closed'; end if;
  if p_to = 'Financially Approved' and not app.has_perm('finance.approve') then
    raise exception 'financial approval is done by Finance only' using errcode = '42501';
  end if;
  if p_to = 'Lost' and coalesce(btrim(p_reason),'') = '' then raise exception 'reason required for Lost'; end if;
  if p_to in ('Postponed','Follow-up') then
    if p_followup is null or coalesce(btrim(p_followup_reason),'') = '' then raise exception 'follow-up date and reason required'; end if;
    insert into follow_ups(lead_id, deal_id, owner_id, due_at, reason, created_by)
      values (d.lead_id, d.id, d.owner_sales_id, p_followup, btrim(p_followup_reason), app.me());
    update leads set next_followup_at = p_followup where id = d.lead_id;
  end if;
  update deals set stage = p_to,
         lost_reason = case when p_to = 'Lost' then btrim(p_reason) else lost_reason end,
         closing_sales_id = case when p_to = 'Signed / Finance Pending' then d.owner_sales_id else closing_sales_id end
   where id = p_deal;
  insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
    values (p_deal, d.stage, p_to, coalesce(nullif(btrim(p_reason),''), btrim(p_followup_reason)), app.me());
end $$;

-- Tele Sales sees only the outcome of leads she created: meeting status + deal result, no details
create or replace function app.my_lead_outcomes()
returns table(lead_id uuid, meeting_status text, deal_outcome text)
language sql stable security definer set search_path = public, app as $$
  select l.id,
    (select m.status from meetings m where m.lead_id = l.id order by m.created_at desc limit 1),
    (select case when d.stage in ('Signed / Finance Pending','Financially Approved') then 'won'
                 when d.stage = 'Lost' then 'lost' else 'open' end
       from deals d where d.lead_id = l.id order by d.created_at desc limit 1)
  from leads l where app.me() is not null and l.original_creator_id = app.me()
$$;

-- ───────── statistics (definer with explicit authorisation; returns counts only) ─────────
create or replace function app.tele_stats(p_emp uuid, p_month date)
returns table(new_leads int, interested_leads int, meetings_scheduled int, meetings_confirmed int, meetings_completed int,
              meetings_cancelled int, meetings_no_show int, lead_to_meeting_pct numeric, contracts_generated int, target numeric)
language plpgsql stable security definer set search_path = public, app as $$
declare s timestamptz := p_month::timestamptz; e timestamptz := (p_month + interval '1 month')::timestamptz;
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
declare s timestamptz := p_month::timestamptz; e timestamptz := (p_month + interval '1 month')::timestamptz; v_won int; v_lost int;
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

-- ───────── scheduled job: overdue follow-ups + target progress (idempotent per run_key) ─────────
create or replace function app.job_daily(p_run_key text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_inserted uuid; v_overdue int := 0; v_target int := 0; r record; v_mgr uuid; v_month date := date_trunc('month', now())::date; v_done int;
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
      and m.completed_at >= v_month::timestamptz and m.completed_at < (v_month + interval '1 month')::timestamptz;
    if v_done >= 0.8 * r.target_value and v_done < r.target_value then
      perform app._notify(r.employee_id, 'target_near', 'اقتربتِ من التارجت', v_done || ' من ' || r.target_value, '/targets', 'tg80:' || r.employee_id || ':' || v_month);
      v_target := v_target + 1;
    end if;
  end loop;
  update job_runs set finished_at = now(), status = 'done', details = jsonb_build_object('overdue', v_overdue, 'target_near', v_target) where id = v_inserted;
  return jsonb_build_object('status','done','overdue',v_overdue,'target_near',v_target);
end $$;

-- list of ownership-review requests the caller may see, with the current owner's name (no other details)
create or replace function app.duplicate_review_list()
returns table(id uuid, status text, requested_by uuid, requested_by_name text, reason text, matched_kinds text[],
              attempted jsonb, existing_client_name text, existing_owner_name text, created_at timestamptz,
              resolved_at timestamptz, resolution_note text, can_resolve boolean)
language sql stable security definer set search_path = public, app as $$
  select r.id, r.status, r.requested_by, app.emp_name(r.requested_by), r.reason, r.matched_kinds, r.attempted,
         c.name,
         app.emp_name((select l.current_owner_id from leads l where l.client_id = r.existing_client_id order by l.created_at desc limit 1)),
         r.created_at, r.resolved_at, r.resolution_note,
         (r.status = 'open' and app.has_perm('duplicates.review') and (app.is_admin() or app.is_report(r.requested_by)))
  from duplicate_reviews r join clients c on c.id = r.existing_client_id
  where app.me() is not null and (r.requested_by = app.me() or app.is_admin()
        or (app.has_perm('duplicates.review') and app.is_report(r.requested_by)))
  order by r.created_at desc
$$;
