-- 028: (1) a meeting counts for the Tele who really worked the client (the one whose hand-off Sales accepted), also when the
--          client was added by the admin and distributed to her. The meeting keeps the hand-off, the distribution batch and the source.
--      (2) a fixed number per lead (leads.seq) so rows with the same time (a distribution batch) keep their places while employees work.
-- Nothing is deleted; old rows keep their values (only meetings without a Tele, whose hand-off came from a Tele, get her filled in).

-- (2) fixed order number. Existing leads: by time, then the file row order of the import/distribution, then id.
alter table leads add column if not exists seq bigint;
create sequence if not exists leads_seq_seq owned by leads.seq;
do $$ begin
  if exists (select 1 from leads where seq is null) then
    with o as (select l.id, row_number() over (order by l.created_at, (select min(r.row_no) from import_rows r where r.lead_id = l.id), l.id) n from leads l)
    update leads l set seq = o.n from o where o.id = l.id and l.seq is null;
  end if;
  perform setval('leads_seq_seq', greatest((select coalesce(max(seq), 0) from leads), 1));
end $$;
alter table leads alter column seq set default nextval('leads_seq_seq');
alter table leads alter column seq set not null;
create index if not exists leads_created_seq on leads(created_at desc, seq);
grant usage, select on sequence leads_seq_seq to ghamer_app;

-- (1) meeting ↔ hand-off / distribution batch / source
alter table meetings add column if not exists handoff_id uuid references lead_handoffs(id);
alter table meetings add column if not exists import_batch_id uuid references import_batches(id);
alter table meetings add column if not exists lead_source text;
create index if not exists meetings_handoff on meetings(handoff_id);

-- backfill: meetings that were saved without a Tele although a Tele's hand-off was accepted (tele_sales_id stays immutable afterwards)
alter table meetings disable trigger meetings_protect;
update meetings m set tele_sales_id = x.from_employee_id, handoff_id = x.id
  from (select distinct on (h.lead_id) h.lead_id, h.id, h.from_employee_id from lead_handoffs h join users u on u.id = h.from_employee_id join roles r on r.id = u.role_id
        where h.status = 'accepted' and r.code in ('tele_sales','tele_sales_manager') order by h.lead_id, h.decided_at desc nulls last, h.handed_at desc) x
 where m.lead_id = x.lead_id and m.tele_sales_id is null;
update meetings m set import_batch_id = l.import_batch_id, lead_source = c.original_source
  from leads l join clients c on c.id = l.client_id where l.id = m.lead_id and m.import_batch_id is null and m.lead_source is null;
alter table meetings enable trigger meetings_protect;

CREATE OR REPLACE FUNCTION app.book_meeting(p_lead uuid, p_at timestamp with time zone, p_title text, p_type text, p_url text, p_notes text, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare l leads; v_handoff uuid; v_id uuid; v_accepted boolean; v_tele uuid; v_stage text; v_deal uuid; v_name text; v_type text := coalesce(nullif(p_type,''), 'online');
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
  -- the Tele who really worked the client: the one whose hand-off Sales accepted (also for data the admin distributed to her);
  -- otherwise the Tele who added the client herself.
  select h.from_employee_id, h.id into v_tele, v_handoff from lead_handoffs h join users u on u.id = h.from_employee_id join roles r on r.id = u.role_id
   where h.lead_id = p_lead and h.status = 'accepted' and r.code in ('tele_sales','tele_sales_manager') order by h.decided_at desc nulls last, h.handed_at desc limit 1;
  if v_tele is null then
    select e.id into v_tele from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
     where e.id = l.original_creator_id and r.code in ('tele_sales','tele_sales_manager');
  end if;
  select c.name into v_name from clients c where c.id = l.client_id;
  begin
    insert into meetings(lead_id, tele_sales_id, sales_rep_id, scheduled_at, meeting_url, booking_notes, title, meeting_type, request_id, created_by,
                         handoff_id, import_batch_id, lead_source)
    values (p_lead, v_tele, l.assigned_sales_id, p_at, app._check_link(p_url), nullif(btrim(p_notes),''),
            coalesce(nullif(btrim(p_title),''), 'اجتماع مع ' || v_name), v_type, p_request, app.me(),
            v_handoff, l.import_batch_id, (select c.original_source from clients c where c.id = l.client_id))
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
end $function$;

CREATE OR REPLACE FUNCTION app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_hidden text, p_scope text)
 RETURNS TABLE(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text, call_notes text, next_followup_at timestamp with time zone, created_at timestamp with time zone, last_contact_at timestamp with time zone, original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean, dup_attempts integer, total integer, hidden_at timestamp with time zone, hidden_by_name text, hidden_reason text, pos double precision, colors jsonb, received_at timestamp with time zone, received_from text, batch_name text, source text)
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
             l.last_contact_at, l.original_creator_id, l.assigned_sales_id, l.handed_off_at, l.hidden_at, l.hidden_by, l.hidden_reason, l.seq, count(*) over()::int total,
             m.pos, coalesce(m.colors, '{}'::jsonb) colors, l.import_batch_id, c.original_source,
             (select max(a.created_at) from lead_assignments a where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10) received_at,
             (select a.assigned_by from lead_assignments a where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10 order by a.created_at desc limit 1) received_from_id
      from leads l join clients c on c.id = l.client_id left join lead_marks m on m.lead_id = l.id and m.user_id = $10
      where ($1::text is null or c.name ilike $2 or c.business_name ilike $2
             or c.id in (select s.client_id from client_stores s where s.url_raw ilike $2 or s.url_key ilike $2))
        and ($3::text is null or c.id in (select cc.client_id from client_contacts cc where (regexp_replace(cc.phone,'\D','','g') like $3 or regexp_replace(coalesce(cc.phone_raw,''),'\D','','g') like $3)))
        and ($4::text is null or l.lead_status = $4) and ($5::date is null or l.created_month = $5)
        and ($6::uuid is null or l.original_creator_id = $6) and ($7::uuid is null or l.assigned_sales_id = $7)
        and ($8::text is null or l.lead_temperature = $8)
        and (coalesce($16,'') = '' or ($16 = 'added' and l.original_creator_id = $10)
             or ($16 = 'received' and exists (select 1 from lead_assignments a where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10)))
        and (case when $14 then (case $15 when 'hidden' then l.hidden_at is not null when 'all' then true else l.hidden_at is null end) else l.hidden_at is null end)
        and ($9 in ('super_admin','general_manager')
             or (l.current_owner_id = $10 and (l.handed_off_at is null or l.assigned_sales_id is not null)) or l.assigned_sales_id = $10
             or l.original_creator_id = $10   -- the Tele who added the client keeps seeing it after the hand-off
             or l.handed_by_id = $10          -- ... and so does the Tele who handed it over (e.g. data that was distributed to her)
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
           f.total, f.hidden_at, app.emp_name(f.hidden_by), f.hidden_reason, f.pos, f.colors,
           f.received_at, app.emp_name(f.received_from_id), (select b.file_name from import_batches b where b.id = f.import_batch_id), f.original_source
    from f
  order by %s
  $q$, v_ord, v_ord2)
  using nullif(btrim(p_q),''), v_pat, case when p_phone is null then null else '%' || ltrim(regexp_replace(p_phone,'\D','','g'),'0') || '%' end,
        p_status, p_month, p_creator, p_sales, p_temp, v_role, v_me, v_team,
        least(coalesce(p_limit, 25), 100), greatest(coalesce(p_offset, 0), 0), app.can_see_hidden(), coalesce(p_hidden,'visible'), p_scope;
end $function$;

CREATE OR REPLACE FUNCTION app.daily_report(p_day date)
 RETURNS TABLE(emp_id uuid, emp_name text, family text, added integer, contacted integer, handed integer, accepted integer, rejected integer, received integer, meetings_booked integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
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
    (select count(*)::int from meetings m, tz, d where (case when e.fam = 'tele' then m.tele_sales_id = e.id else m.created_by = e.id end) and (m.created_at at time zone tz.z)::date = d.day)
  from emps e order by e.fam, 4 desc, e.full_name
$function$;

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
