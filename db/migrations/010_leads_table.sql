-- 010: Excel-style leads table support + Tele Sales hand-off from any open status.

-- 1) a repeated attempt to register an existing client is recorded on that lead (throttled 1/hour per user) → "حالة التكرار"
create or replace function app._dup_response(p_client uuid, p_kinds text[], p_ambiguous boolean)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v_owner uuid; v_name text; v_lead uuid;
begin
  select l.id, l.current_owner_id into v_lead, v_owner from leads l where l.client_id = p_client order by l.created_at desc limit 1;
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
                            'matched_kinds',to_jsonb(p_kinds),'ambiguous',p_ambiguous);
end $$;

-- 1b) the same form submitted twice at the same moment: the second call waits, then returns the first lead (no false "duplicate")
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
    perform pg_advisory_xact_lock(hashtextextended('reg:' || v_me::text || ':' || v_req::text, 0)); -- concurrent retries of the same form wait for the first one
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

-- 2) hand-off from any open status (the person picks Interested / Qualified at the same step when needed)
drop function if exists app.handoff_lead(uuid, uuid, text);
create or replace function app.handoff_lead(p_lead uuid, p_to uuid, p_note text, p_status text default null) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_status text; v_ho uuid; v_admin uuid; v_name text;
begin
  if not app.has_perm('leads.handoff') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  select l.lead_status, c.name into v_status, v_name from leads l join clients c on c.id = l.client_id where l.id = p_lead for update of l;
  if v_status in ('Not Interested','Invalid Contact','Pending Sales Review','Accepted by Sales','Meeting Scheduled','Meeting Completed') then
    raise exception 'lead status does not allow handoff';
  end if;
  if exists (select 1 from lead_handoffs where lead_id = p_lead and status in ('pending_distribution','pending_review')) then
    raise exception 'lead already handed off';
  end if;
  if v_status not in ('Interested','Qualified Lead','Rejected by Sales') then
    if p_status is null or p_status not in ('Interested','Qualified Lead') then
      raise exception 'lead must be Interested or Qualified before handoff';
    end if;
    update leads set lead_status = p_status, last_contact_at = now(), updated_by = app.me() where id = p_lead;
    insert into lead_activities(lead_id, kind, status_from, status_to, note, created_by)
      values (p_lead, 'status_change', v_status, p_status, 'تحديث الحالة عند الإرسال إلى السيلز', app.me());
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

-- 3) the leads table: one definer function, visibility enforced INSIDE (never trusts the UI)
create or replace function app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text,
                                          p_sort text, p_dir text, p_limit int, p_offset int)
returns table(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text,
              call_notes text, next_followup_at timestamptz, created_at timestamptz, last_contact_at timestamptz,
              original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean,
              dup_attempts int, total int)
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
             l.last_contact_at, l.original_creator_id, l.assigned_sales_id, l.handed_off_at, count(*) over()::int total
      from leads l join clients c on c.id = l.client_id
      where ($1::text is null or c.name ilike $2 or c.business_name ilike $2
             or c.id in (select s.client_id from client_stores s where s.url_raw ilike $2 or s.url_key ilike $2))
        and ($3::text is null or c.id in (select cc.client_id from client_contacts cc where cc.phone like $3))
        and ($4::text is null or l.lead_status = $4) and ($5::date is null or l.created_month = $5)
        and ($6::uuid is null or l.original_creator_id = $6) and ($7::uuid is null or l.assigned_sales_id = $7)
        and ($8::text is null or l.lead_temperature = $8)
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
           f.total
    from f
  order by %s
  $q$, v_ord, v_ord2)
  using nullif(btrim(p_q),''), v_pat, case when p_phone is null then null else '%' || p_phone || '%' end,
        p_status, p_month, p_creator, p_sales, p_temp, v_role, v_me, v_team,
        least(coalesce(p_limit, 25), 100), greatest(coalesce(p_offset, 0), 0);
end $$;

-- 4) privileges (same rules as 007/008/009)
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
