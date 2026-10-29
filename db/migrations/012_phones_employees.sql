-- 012: phone number is the ONLY duplicate criterion (international numbers), names may repeat, store links never block;
--      employee management: rename, link summary, safe re-assignment, name history.
-- Safe on existing data: nothing is deleted or rewritten. The old unique(kind,value) is replaced by a unique index on PHONE rows only.

-- ───────── 1) keep what the user typed + the country it was typed for ─────────
alter table client_contacts add column if not exists phone_raw text;
alter table client_contacts add column if not exists phone_country text;

-- ───────── 2) uniqueness only for phone numbers ─────────
do $$ begin
  -- pre-check: the old constraint guarantees no duplicate phone rows exist, but verify before changing anything
  if exists (select 1 from client_identifiers where kind = 'phone' group by value having count(*) > 1) then
    raise exception 'duplicate phone identifiers exist: review them before applying 012';
  end if;
end $$;
alter table client_identifiers drop constraint if exists client_identifiers_kind_value_key;
create unique index if not exists client_identifiers_phone_uq on client_identifiers(value) where kind = 'phone';
create index if not exists client_identifiers_kind_value_idx on client_identifiers(kind, value);
-- same trailing digits under a different country code = "probably the same person, cannot be sure" → goes to admin review
create index if not exists client_identifiers_phone_tail_idx on client_identifiers ((right(regexp_replace(value, '\D', '', 'g'), 9))) where kind = 'phone';

-- ───────── 3) duplicate lookup: phones only; the answer tells the employee who owns it, its status and when it was added ─────────
create or replace function app._dup_response(p_client uuid, p_kinds text[], p_ambiguous boolean)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v_owner uuid; v_name text; v_lead uuid; v_status text; v_added timestamptz; v_cname text;
begin
  select l.id, l.current_owner_id, l.lead_status, l.created_at into v_lead, v_owner, v_status, v_added from leads l where l.client_id = p_client order by l.created_at desc limit 1;
  select name, created_at into v_cname, v_added from clients where id = p_client;
  if v_owner is null then select original_creator_id into v_owner from clients where id = p_client; end if;
  v_name := app.emp_name(v_owner);
  if v_lead is not null and app.me() is not null and not exists (
       select 1 from lead_activities a where a.lead_id = v_lead and a.kind = 'duplicate_attempt' and a.created_by = app.me() and a.created_at > now() - interval '1 hour') then
    insert into lead_activities(lead_id, kind, note, created_by) values (v_lead, 'duplicate_attempt', 'محاولة تسجيل مكررة', app.me());
  end if;
  if v_owner is not null and v_owner <> app.me() then
    perform app._notify(v_owner, 'duplicate_attempt', 'محاولة تسجيل عميل مكرر',
      app.emp_name(app.me()) || ' حاولت تسجيل عميل مسجل لديك', null,
      'dup:' || app.me() || ':' || p_client || ':' || current_date);
  end if;
  return jsonb_build_object('status','duplicate','existing_client_id',p_client,'owner_name',v_name,
                            'matched_kinds',to_jsonb(p_kinds),'ambiguous',p_ambiguous,
                            'existing_name', v_cname, 'existing_status', v_status, 'existing_added_at', v_added);
end $$;

create or replace function app._find_dup(p_ids jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_client uuid; v_kinds text[]; v_n int;
begin
  select count(distinct ci.client_id), array_agg(distinct ci.kind)
    into v_n, v_kinds
  from client_identifiers ci
  join jsonb_to_recordset(p_ids) as x(kind text, value text, label text) on x.kind = ci.kind and x.value = ci.value
  where ci.kind = 'phone';
  if v_n = 0 then return null; end if;
  select ci.client_id into v_client from client_identifiers ci
    join jsonb_to_recordset(p_ids) as x(kind text, value text, label text) on x.kind = ci.kind and x.value = ci.value
    join clients c on c.id = ci.client_id where ci.kind = 'phone' order by c.created_at limit 1;
  return app._dup_response(v_client, v_kinds, v_n > 1);
end $$;

-- ───────── 4) contacts keep the typed value + country ─────────
create or replace function app._write_contacts(p_client uuid, p jsonb, p_replace boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if p_replace then
    delete from client_contacts where client_id = p_client;
    delete from client_stores where client_id = p_client;
    delete from client_identifiers where client_id = p_client;
  end if;
  insert into client_contacts(client_id, label, phone, email, contact_name, is_primary, phone_raw, phone_country)
  select p_client, coalesce(x.label,'mobile'), x.phone, x.email, x.contact_name, coalesce(x.is_primary,false), x.phone_raw, x.phone_country
  from jsonb_to_recordset(coalesce(p->'contacts','[]')) as x(label text, phone text, email text, contact_name text, is_primary boolean, phone_raw text, phone_country text);
  insert into client_stores(client_id, url_raw, url_key)
  select p_client, x.url_raw, x.url_key from jsonb_to_recordset(coalesce(p->'stores','[]')) as x(url_raw text, url_key text);
  insert into client_identifiers(client_id, kind, value, label)
  select distinct on (x.kind, x.value) p_client, x.kind, x.value, x.label
  from jsonb_to_recordset(coalesce(p->'identifiers','[]')) as x(kind text, value text, label text);
end $$;

-- a new phone whose last 9 digits equal an existing one but with a DIFFERENT country code is saved (it is a different number) and queued for admin review
create or replace function app._flag_similar_phone() returns trigger language plpgsql security definer set search_path = public, app as $$
declare v_other record; v_tail text := right(regexp_replace(NEW.value, '\D', '', 'g'), 9);
begin
  if NEW.kind <> 'phone' or length(v_tail) < 8 or app.me() is null then return NEW; end if;
  for v_other in select ci.client_id, ci.value from client_identifiers ci
                 where ci.kind = 'phone' and ci.client_id <> NEW.client_id and ci.value <> NEW.value
                   and right(regexp_replace(ci.value, '\D', '', 'g'), 9) = v_tail limit 3 loop
    if not exists (select 1 from duplicate_reviews d where d.existing_client_id = v_other.client_id and d.attempted->>'phone' = NEW.value) then
      insert into duplicate_reviews(existing_client_id, requested_by, attempted, matched_kinds, reason)
      values (v_other.client_id, app.me(), jsonb_build_object('phone', NEW.value, 'existing_phone', v_other.value, 'client_id', NEW.client_id),
              '{phone}', 'رقمان متشابهان برمز دولة مختلف (' || NEW.value || ' / ' || v_other.value || '): لا يمكن التأكد آليًا، يحتاج مراجعة');
    end if;
  end loop;
  return NEW;
end $$;
drop trigger if exists client_identifiers_similar on client_identifiers;
create trigger client_identifiers_similar after insert on client_identifiers for each row execute function app._flag_similar_phone();

-- ───────── 5) employees: rename (audited by audit_employees), link summary, re-assignment, name history ─────────
create or replace function app.rename_employee(p_emp uuid, p_name text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name,''))) < 2 or length(p_name) > 120 then raise exception 'name required'; end if;
  perform set_config('app.reason', 'تعديل اسم الموظف', true);
  update employees set full_name = btrim(p_name), updated_at = now() where id = p_emp;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
end $$;

create or replace function app.employee_name_history(p_emp uuid)
returns table(at timestamptz, actor_name text, old_name text, new_name text)
language sql stable security definer set search_path = public, app as $$
  select a.at, app.emp_name(a.actor_id), a.old_value->>'full_name', a.new_value->>'full_name'
  from audit_logs a where app.is_admin() and a.entity_type = 'employees' and a.entity_id = p_emp::text
    and a.action = 'UPDATE' and a.new_value ? 'full_name' order by a.id desc limit 50
$$;

create or replace function app.employee_link_counts()
returns table(id uuid, leads_created int, leads_owned int, leads_sales int, open_followups int, upcoming_meetings int, open_deals int, pending_handoffs int, activities int)
language sql stable security definer set search_path = public, app as $$
  select e.id,
    (select count(*)::int from leads l where l.original_creator_id = e.id),
    (select count(*)::int from leads l where l.current_owner_id = e.id and l.handed_off_at is null),
    (select count(*)::int from leads l where l.assigned_sales_id = e.id),
    (select count(*)::int from follow_ups f where f.owner_id = e.id and f.status = 'open'),
    (select count(*)::int from meetings m where m.sales_rep_id = e.id and m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at >= now()),
    (select count(*)::int from deals d where d.owner_sales_id = e.id and d.stage not in ('Lost','Financially Approved')),
    (select count(*)::int from lead_handoffs h where h.to_employee_id = e.id and h.status = 'pending_review'),
    (select count(*)::int from lead_activities a where a.created_by = e.id)
  from employees e where app.is_admin()
$$;

-- moves the WORK that is still open (current owner / sales owner / open follow-ups / upcoming meetings / open deals / pending decisions).
-- Original creator and all history stay with the original employee.
create or replace function app.reassign_employee(p_from uuid, p_to uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_fam_from text; v_fam_to text; r record; n_owner int := 0; n_sales int := 0; n_fu int := 0; n_m int := 0; n_d int := 0; n_h int := 0;
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_from = p_to then raise exception 'invalid target employee'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select case when ro.code in ('tele_sales','tele_sales_manager') then 'tele' when ro.code in ('sales_rep','sales_manager') then 'sales' else ro.code end into v_fam_from
    from users u join roles ro on ro.id = u.role_id where u.id = p_from;
  select case when ro.code in ('tele_sales','tele_sales_manager') then 'tele' when ro.code in ('sales_rep','sales_manager') then 'sales' else ro.code end into v_fam_to
    from users u join roles ro on ro.id = u.role_id where u.id = p_to and u.is_active;
  if v_fam_to is null or v_fam_from is distinct from v_fam_to or v_fam_to not in ('tele','sales') then raise exception 'invalid target employee'; end if;
  perform set_config('app.reason', 'إعادة توزيع عمل موظف: ' || p_reason, true);

  if v_fam_from = 'tele' then
    for r in select id from leads where current_owner_id = p_from and handed_off_at is null loop
      update leads set current_owner_id = p_to where id = r.id;
      insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason) values (r.id, 'owner', p_from, p_to, app.me(), p_reason);
      insert into lead_activities(lead_id, kind, note, created_by) values (r.id, 'assignment', 'إعادة توزيع: ' || p_reason, app.me());
      n_owner := n_owner + 1;
    end loop;
  else
    for r in select id from leads where assigned_sales_id = p_from loop
      update leads set assigned_sales_id = p_to, current_owner_id = case when current_owner_id = p_from then p_to else current_owner_id end where id = r.id;
      insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason) values (r.id, 'sales', p_from, p_to, app.me(), p_reason);
      insert into lead_activities(lead_id, kind, note, created_by) values (r.id, 'assignment', 'إعادة توزيع: ' || p_reason, app.me());
      n_sales := n_sales + 1;
    end loop;
    update meetings set sales_rep_id = p_to where sales_rep_id = p_from and status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at >= now();
    get diagnostics n_m = row_count;
    update deals set owner_sales_id = p_to where owner_sales_id = p_from and stage not in ('Lost','Financially Approved');
    get diagnostics n_d = row_count;
    update lead_handoffs set to_employee_id = p_to where to_employee_id = p_from and status = 'pending_review';
    get diagnostics n_h = row_count;
    if n_h > 0 then perform app._notify(p_to, 'lead_pending_review', 'عملاء بانتظار قرارك (محوّلون إليك)', n_h || ' عميل', '/assigned', 'reassign:' || p_from || ':' || now()::text); end if;
  end if;
  update follow_ups set owner_id = p_to where owner_id = p_from and status = 'open';
  get diagnostics n_fu = row_count;
  return jsonb_build_object('leads_owner', n_owner, 'leads_sales', n_sales, 'followups', n_fu, 'meetings', n_m, 'deals', n_d, 'handoffs', n_h);
end $$;

-- ───────── 6) phone search: digits only, any local/international format, partial ─────────
CREATE OR REPLACE FUNCTION app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_hidden text DEFAULT 'visible'::text)
 RETURNS TABLE(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text, call_notes text, next_followup_at timestamp with time zone, created_at timestamp with time zone, last_contact_at timestamp with time zone, original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean, dup_attempts integer, total integer, hidden_at timestamp with time zone, hidden_by_name text, hidden_reason text)
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
        and ($3::text is null or c.id in (select cc.client_id from client_contacts cc where (regexp_replace(cc.phone,'\D','','g') like $3 or regexp_replace(coalesce(cc.phone_raw,''),'\D','','g') like $3)))
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
  using nullif(btrim(p_q),''), v_pat, case when p_phone is null then null else '%' || ltrim(regexp_replace(p_phone,'\D','','g'),'0') || '%' end,
        p_status, p_month, p_creator, p_sales, p_temp, v_role, v_me, v_team,
        least(coalesce(p_limit, 25), 100), greatest(coalesce(p_offset, 0), 0), app.can_see_hidden(), coalesce(p_hidden,'visible');
end $function$;

-- one shared matcher for "search clients" on every listing page: name / business / store URL, or a phone in ANY local/international format (full or partial).
-- It only answers yes/no for a client id the caller already got from a permission-filtered query.
create or replace function app.client_matches(p_client uuid, p_q text) returns boolean
language plpgsql stable security definer set search_path = public, app as $$
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
  return exists (select 1 from clients c where c.id = p_client and (c.name ilike v_q or c.business_name ilike v_q))
      or exists (select 1 from client_stores s where s.client_id = p_client and (s.url_raw ilike v_q or s.url_key ilike v_q));
end $$;

drop function if exists app.archive_leads(uuid, date, text, integer, integer);
create or replace function app.archive_leads(p_emp uuid, p_month date, p_status text, p_limit integer, p_offset integer, p_q text default null)
 returns table(lead_id uuid, client_name text, business_name text, lead_status text, created_at timestamp with time zone, created_month date, creator_name text, owner_name text, handoff_status text, can_open boolean, total bigint)
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
    and app.client_matches(l.client_id, p_q)
  order by l.created_at desc limit least(coalesce(p_limit, 20), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- disabling (the "safe delete") is blocked while the employee still has open work: reassign first. Nothing is ever deleted; history stays.
create or replace function app._open_work(p_emp uuid) returns int
language sql stable security definer set search_path = public, app as $$
  select (select count(*) from leads l where l.current_owner_id = p_emp and l.handed_off_at is null)::int
       + (select count(*) from follow_ups f where f.owner_id = p_emp and f.status = 'open')::int
       + (select count(*) from meetings m where m.sales_rep_id = p_emp and m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at >= now())::int
       + (select count(*) from deals d where d.owner_sales_id = p_emp and d.stage not in ('Lost','Financially Approved') and d.archived_at is null)::int
       + (select count(*) from lead_handoffs h where h.to_employee_id = p_emp and h.status = 'pending_review')::int
$$;
create or replace function app.set_employee_active(p_user uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_user = app.me() then raise exception 'cannot change own status'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason required'; end if;
  if not p_active and app._open_work(p_user) > 0 then raise exception 'has open work: reassign first'; end if;
  perform set_config('app.reason', p_reason, true);
  update users set is_active = p_active where id = p_user;
  if not p_active then delete from sessions where user_id = p_user; end if;
end $$;

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
