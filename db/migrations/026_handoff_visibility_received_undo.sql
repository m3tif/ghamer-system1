-- 026: (1) a hide of an employee's data must never hide leads that were already handed to Sales; (2) the Tele who handed a lead over keeps seeing it;
--      (3) «العملاء اللي ضفتهم» / «الداتا المستلمة» scopes in app.list_leads; (4) undo of a whole bulk distribution (preview + undo, by batch number, never deletes).

-- ───────── (1) why leads disappeared: hiding Heba's data also hid leads she had already handed to Sales; hidden leads do not exist for Sales ─────────
-- From now on an employee hide only covers leads that employee CURRENTLY owns / is assigned to (a lead owned by Sales belongs to Sales' work).
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
        and (p_emp is null or l.current_owner_id = p_emp or l.assigned_sales_id = p_emp);
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
    from leads l where app.is_admin() and (p_emp is null or l.current_owner_id = p_emp or l.assigned_sales_id = p_emp)
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
           where (l.current_owner_id = p_emp or l.assigned_sales_id = p_emp) and l.created_month = date_trunc('month', p_month)::date
             and ((p_hidden and l.hidden_at is null) or (not p_hidden and l.hidden_at is not null))
             and app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at) loop
    perform app.set_lead_hidden(r.id, p_hidden, p_reason);
    n := n + 1;
  end loop;
  return n;
end $$;

-- repair: leads that an employee-hide hid although they already belong to Sales (owner / assigned Sales is somebody else) are shown again, with a note in their history
do $$
declare r record; n int := 0;
begin
  perform set_config('app.reason', 'تصحيح: عميل محوّل للسيلز لا يُخفى مع بيانات التيلي', true);
  for r in select l.id, l.hidden_period_id from leads l join hidden_periods h on h.id = l.hidden_period_id
            where h.restored_at is null and h.employee_id is not null and l.hidden_at is not null
              and l.assigned_sales_id is not null and l.assigned_sales_id <> h.employee_id
              and l.current_owner_id is distinct from h.employee_id loop
    update leads set hidden_at = null, hidden_by = null, hidden_reason = null, hidden_period_id = null where id = r.id;
    update hidden_periods set affected = greatest(affected - 1, 0) where id = r.hidden_period_id;
    insert into lead_activities(lead_id, kind, note, created_by)
      select r.id, 'note', 'تم إظهار العميل من جديد: كان قد اختفى عند السيلز بسبب إخفاء بيانات التيلي، والعميل المحوّل للسيلز لا يُخفى', h.created_by from hidden_periods h where h.id = r.hidden_period_id;
    n := n + 1;
  end loop;
  raise notice 'restored % leads handed to Sales', n;
end $$;

-- ───────── (2) the Tele who handed a lead over keeps seeing it (read only) ─────────
alter table leads add column if not exists handed_by_id uuid references employees(id);
update leads l set handed_by_id = h.from_employee_id
  from (select distinct on (lead_id) lead_id, from_employee_id from lead_handoffs order by lead_id, assigned_at nulls last, id) h
 where h.lead_id = l.id and l.handed_by_id is null;
create or replace function app._set_handed_by() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if NEW.handed_off_at is not null and OLD.handed_off_at is null and NEW.handed_by_id is null then NEW.handed_by_id := app.me(); end if;
  return NEW;
end $$;
drop trigger if exists leads_set_handed_by on leads;
create trigger leads_set_handed_by before update of handed_off_at on leads for each row execute function app._set_handed_by();

drop policy if exists leads_read on leads;
create policy leads_read on leads for select to ghamer_app using (
  (hidden_at is null or (select app.can_see_hidden())) and (
  (select app.is_admin())
  or (current_owner_id = (select app.me()) and (handed_off_at is null or assigned_sales_id is not null))
  or assigned_sales_id = (select app.me())
  or original_creator_id = (select app.me())
  or handed_by_id = (select app.me())
  or ((select app.role_code()) = 'tele_sales_manager' and (original_creator_id in (select app.team_ids()) or current_owner_id in (select app.team_ids())))
  or ((select app.role_code()) = 'sales_manager' and (current_owner_id in (select app.team_ids()) or assigned_sales_id in (select app.team_ids())))));

create or replace function app.lead_visible(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (app.lead_row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id, l.handed_off_at) or l.handed_by_id = app.me())
                          and (l.hidden_at is null or app.can_see_hidden()) from leads l where l.id = p_lead), false)
$$;

-- ───────── (3) list_leads with scope ('added' | 'received') and received-data details ─────────
drop function if exists app.list_leads(text, text, text, date, uuid, uuid, text, text, text, integer, integer, text);
drop function if exists app.list_leads(text, text, text, date, uuid, uuid, text, text, text, integer, integer, text, text);
create or replace function app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_hidden text, p_scope text)
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
    when 'name' then 'c.name ' || v_dir || ', l.created_at desc'
    when 'status' then 'l.lead_status ' || v_dir || ', l.created_at desc'
    when 'temperature' then 'l.lead_temperature ' || v_dir || ' nulls last, l.created_at desc'
    when 'followup' then 'l.next_followup_at ' || v_dir || ' nulls last, l.created_at desc'
    when 'manual' then 'm.pos asc nulls first, l.created_at desc'
    else 'l.created_at ' || v_dir end;
  v_ord2 := replace(replace(replace(v_ord, 'c.name', 'f.name'), 'l.', 'f.'), 'm.pos', 'f.pos');
  return query execute format($q$
    with f as (
      select l.id, l.client_id, c.name, c.business_name, l.lead_status, l.lead_temperature, l.call_notes, l.next_followup_at, l.created_at,
             l.last_contact_at, l.original_creator_id, l.assigned_sales_id, l.handed_off_at, l.hidden_at, l.hidden_by, l.hidden_reason, count(*) over()::int total,
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





-- the previous 12-argument form keeps working (the app that is still deployed while this runs calls it)
create or replace function app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_hidden text DEFAULT 'visible'::text)
 RETURNS TABLE(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text, call_notes text, next_followup_at timestamp with time zone, created_at timestamp with time zone, last_contact_at timestamp with time zone, original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean, dup_attempts integer, total integer, hidden_at timestamp with time zone, hidden_by_name text, hidden_reason text, pos double precision, colors jsonb, received_at timestamp with time zone, received_from text, batch_name text, source text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'app'
AS $w$ select * from app.list_leads(p_q, p_phone, p_status, p_month, p_creator, p_sales, p_temp, p_sort, p_dir, p_limit, p_offset, p_hidden, null::text) $w$;

-- ───────── (4) undo a whole bulk distribution ─────────
-- A lead counts as "worked on" when anything happened to it after it was distributed. Undo is refused if any lead was worked on (nothing is lost);
-- otherwise every lead of that batch number is archived + hidden (never deleted) and its phone is freed so a corrected file can be sent again.
create or replace function app._dist_touched(p_lead uuid) returns text language sql stable security definer set search_path = public, app as $$
  select case
    when l.updated_at > l.created_at + interval '1 second' then 'عُدّل بعد التوزيع'
    when (select count(*) from lead_activities a where a.lead_id = l.id) > 1 then 'عليه نشاط/ملاحظات بعد التوزيع'
    when exists (select 1 from lead_handoffs h where h.lead_id = l.id) then 'تم تحويله للسيلز'
    when exists (select 1 from meetings m where m.lead_id = l.id) then 'له اجتماع'
    when exists (select 1 from follow_ups f where f.lead_id = l.id) then 'له متابعة'
    when exists (select 1 from deals d where d.lead_id = l.id) then 'له صفقة'
    when l.current_owner_id is distinct from (select a.to_employee_id from lead_assignments a where a.lead_id = l.id and a.kind = 'owner' order by a.created_at asc limit 1) then 'أُعيد إسناده لموظف آخر'
    else null end
  from leads l where l.id = p_lead
$$;

create or replace function app.dist_undo_preview(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare b import_batches; v_total int; v_touched int; v_per jsonb; v_block jsonb;
begin
  if not app._dist_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into b from import_batches where id = p_batch;
  select count(*)::int into v_total from import_rows r where r.batch_id = p_batch and r.status = 'imported' and r.lead_id is not null;
  select count(*)::int into v_touched from import_rows r where r.batch_id = p_batch and r.status = 'imported' and app._dist_touched(r.lead_id) is not null;
  select coalesce(jsonb_agg(jsonb_build_object('employee', e.name, 'count', e.n) order by e.name), '[]'::jsonb) into v_per
    from (select app.emp_name(l.current_owner_id) as name, count(*)::int n from import_rows r join leads l on l.id = r.lead_id where r.batch_id = p_batch and r.status = 'imported' group by 1) e;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_block from (
    select jsonb_build_object('lead_id', r.lead_id, 'name', c.name, 'employee', app.emp_name(l.current_owner_id), 'reason', app._dist_touched(r.lead_id)) x
      from import_rows r join leads l on l.id = r.lead_id join clients c on c.id = l.client_id
     where r.batch_id = p_batch and r.status = 'imported' and app._dist_touched(r.lead_id) is not null order by r.row_no limit 30) t;
  return jsonb_build_object('batch', p_batch, 'file_name', b.file_name, 'status', b.status, 'total', v_total, 'touched', v_touched, 'per_employee', v_per, 'blocking', v_block,
                            'can_undo', (b.status = 'completed' and v_total > 0 and v_touched = 0));
end $$;

create or replace function app.dist_undo(p_batch uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare b import_batches; r record; v_prev jsonb; v_n int := 0; e record;
begin
  if not app._dist_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into b from import_batches where id = p_batch for update;                 -- two clicks / two tabs: the second one finds the status changed
  if b.status = 'rolled_back' then raise exception 'already undone'; end if;
  if b.status <> 'completed' then raise exception 'batch is not undoable'; end if;
  v_prev := app.dist_undo_preview(p_batch);
  if (v_prev->>'touched')::int > 0 then raise exception 'worked on: % leads were already worked on, undo refused', v_prev->>'touched'; end if;
  perform set_config('app.reason', 'تراجع عن توزيع: ' || b.file_name || ' — ' || p_reason, true);
  for r in select ir.id, ir.lead_id, ir.client_id from import_rows ir where ir.batch_id = p_batch and ir.status = 'imported' and ir.lead_id is not null loop
    update leads set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, app.me()), hidden_reason = 'تراجع عن توزيع: ' || p_reason,
           import_rolled_back_at = now(), archived_at = now() where id = r.lead_id;
    delete from client_identifiers where client_id = r.client_id;                    -- frees the phone / store so the corrected file is not flagged as duplicate
    update clients set status = 'archived', archived_at = now() where id = r.client_id;
    insert into lead_activities(lead_id, kind, note, created_by) values (r.lead_id, 'note', 'تم التراجع عن عملية التوزيع رقم ' || p_batch::text || ' — ' || p_reason, app.me());
    update import_rows set status = 'rolled_back', reason = 'تم التراجع عن التوزيع' where id = r.id;
    v_n := v_n + 1;
  end loop;
  update import_batches set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = app.me(),
         rollback_note = p_reason || ' — تم التراجع عن ' || v_n || ' عميل (لم يُحذف أي عميل)' where id = p_batch;
  for e in select employee_id, assigned from import_distribution where batch_id = p_batch loop
    perform app._notify(e.employee_id, 'lead_distribution', 'تم التراجع عن توزيع داتا', 'تم إلغاء توزيع ملف «' || b.file_name || '» (' || e.assigned || ' عميل) لأن فيه خطأ، وسيُعاد إرساله مصحّحًا', '/leads?tab=received', 'distundo:' || p_batch::text || ':' || e.employee_id::text);
  end loop;
  perform app._import_totals(p_batch);
  return jsonb_build_object('undone', v_n, 'batch', p_batch, 'preview', v_prev);
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
