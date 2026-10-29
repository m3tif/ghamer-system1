-- 015: name is optional (only the phone is required), phones are free-form, and the Admin can delete clients completely.
-- Deleting is a deliberate, Admin-only, logged action (the audit log keeps who deleted what, when and why). Nothing else in the system changes.

CREATE OR REPLACE FUNCTION app.register_lead(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
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
    values (coalesce(nullif(btrim(p->>'name'),''),'بدون اسم'), nullif(p->>'business_name',''), nullif(p->>'industry',''), coalesce(nullif(p->>'country',''),'SA'),
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
end $function$;

CREATE OR REPLACE FUNCTION app._import_classify(p_batch uuid, p_row bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
begin
  update import_rows r set status = 'new', reason = null, existing_client_id = null, existing_owner_name = null, diff = null
   where r.batch_id = p_batch and r.status in ('new','duplicate','invalid','review') and (p_row is null or r.id = p_row);

  update import_rows r set status = 'invalid',
         reason = case when coalesce(btrim(r.phone_raw),'') = '' then 'لا يوجد رقم هاتف' else 'رقم هاتف غير صالح: ' || r.phone_raw end
   where r.batch_id = p_batch and r.status = 'new' and r.phone_e164 is null and (p_row is null or r.id = p_row);

  update import_rows r set status = 'duplicate',
         reason = 'مكرر داخل الملف: نفس الرقم في الصف ' || (select min(o.row_no) from import_rows o where o.batch_id = r.batch_id and o.phone_e164 = r.phone_e164 and o.row_no < r.row_no and o.status not in ('invalid','skipped'))
   where r.batch_id = p_batch and r.status = 'new' and (p_row is null or r.id = p_row)
     and exists (select 1 from import_rows o where o.batch_id = r.batch_id and o.phone_e164 = r.phone_e164 and o.row_no < r.row_no and o.status not in ('invalid','skipped'));

  update import_rows r set status = 'duplicate', existing_client_id = ci.client_id, reason = 'الرقم مسجل بالفعل في النظام',
         existing_owner_name = app.emp_name(coalesce((select l.current_owner_id from leads l where l.client_id = ci.client_id order by l.created_at desc limit 1),
                                                     (select c.original_creator_id from clients c where c.id = ci.client_id)))
    from client_identifiers ci
   where r.batch_id = p_batch and r.status = 'new' and ci.kind = 'phone' and ci.value = r.phone_e164 and (p_row is null or r.id = p_row);

  update import_rows r set status = 'review',
         reason = case when not r.phone_valid then 'الرقم بصيغة غير مؤكدة'
                       when r.alt_e164 is not null and exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.alt_e164) then 'الرقم البديل مسجل لعميل آخر'
                       else 'رقم مشابه لرقم مسجل برمز دولة مختلف' end
   where r.batch_id = p_batch and r.status = 'new' and (p_row is null or r.id = p_row)
     and (not r.phone_valid
          or (r.alt_e164 is not null and exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.alt_e164))
          or exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value <> r.phone_e164
                       and right(regexp_replace(ci.value,'\D','','g'), 9) = right(regexp_replace(r.phone_e164,'\D','','g'), 9)));

  -- differences against the existing client, shown ONLY if the importer is allowed to see that client
  update import_rows r set diff = nullif(jsonb_strip_nulls(jsonb_build_object(
      'name', case when coalesce(btrim(r.name),'') <> '' and lower(btrim(r.name)) <> lower(btrim(c.name)) then jsonb_build_object('existing', c.name, 'file', r.name) end,
      'business_name', case when coalesce(btrim(r.business_name),'') <> '' and lower(btrim(r.business_name)) <> lower(coalesce(btrim(c.business_name),'')) then jsonb_build_object('existing', c.business_name, 'file', r.business_name) end,
      'store', case when r.store_key is not null and not exists (select 1 from client_stores s where s.client_id = c.id and s.url_key = r.store_key) then jsonb_build_object('existing', null, 'file', r.store_url) end)), '{}'::jsonb)
    from clients c
   where r.batch_id = p_batch and r.status = 'duplicate' and r.existing_client_id = c.id and (p_row is null or r.id = p_row)
     and (app.is_admin() or exists (select 1 from leads l where l.client_id = c.id and app.lead_visible(l.id)));
  update import_rows r set existing_owner_name = null, reason = 'الرقم مسجل لدى موظف آخر (لا تملك صلاحية رؤية تفاصيله)'
   where r.batch_id = p_batch and r.status = 'duplicate' and r.existing_client_id is not null and (p_row is null or r.id = p_row)
     and not (app.is_admin() or exists (select 1 from leads l where l.client_id = r.existing_client_id and app.lead_visible(l.id)));
  perform app._import_totals(p_batch);
end $function$;

CREATE OR REPLACE FUNCTION app.import_run(p_batch uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare b import_batches; r record; v_client uuid; v_lead uuid; v_created timestamptz; v_payload jsonb; v_ids jsonb; v_contacts jsonb; v_stores jsonb;
        v_sales uuid; v_role text; v_done int := 0; v_err int := 0; v_dup int := 0; v_status text; v_rem int; v_upd timestamptz;
begin
  if not app._import_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into b from import_batches where id = p_batch for update;       -- serialises double clicks / parallel tabs
  if b.status not in ('staged','importing') then raise exception 'batch is not runnable'; end if;
  if b.status = 'staged' then
    update import_batches set status = 'importing', started_at = now() where id = p_batch;
  end if;
  select ro.code into v_role from users u join roles ro on ro.id = u.role_id where u.id = b.data_owner_id;
  v_sales := case when v_role in ('sales_rep','sales_manager') then b.data_owner_id end;
  perform set_config('app.reason', 'استيراد بيانات سابقة: ' || b.file_name, true);
  for r in select * from import_rows where batch_id = p_batch and status = 'new' order by row_no limit least(greatest(coalesce(p_limit, 200), 1), 500) for update loop
    begin
      if exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.phone_e164) then
        update import_rows set status = 'duplicate', reason = 'سُجّل الرقم أثناء الاستيراد' where id = r.id; v_dup := v_dup + 1; continue;
      end if;
      v_ids := jsonb_build_array(jsonb_build_object('kind','phone','value',r.phone_e164,'label','mobile'));
      v_contacts := jsonb_build_array(jsonb_build_object('label','mobile','phone',r.phone_e164,'is_primary',true,'phone_raw',r.phone_raw,'phone_country',r.phone_country));
      v_stores := '[]'::jsonb;
      if r.alt_e164 is not null and r.alt_e164 <> r.phone_e164 and not exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.alt_e164) then
        v_ids := v_ids || jsonb_build_array(jsonb_build_object('kind','phone','value',r.alt_e164,'label','alt_mobile'));
        v_contacts := v_contacts || jsonb_build_array(jsonb_build_object('label','alt_mobile','phone',r.alt_e164,'is_primary',false,'phone_country',r.alt_country));
      end if;
      if r.store_key is not null then
        v_ids := v_ids || jsonb_build_array(jsonb_build_object('kind','store','value',r.store_key,'label','store'));
        v_stores := jsonb_build_array(jsonb_build_object('url_raw',r.store_url,'url_key',r.store_key));
      end if;
      v_payload := jsonb_build_object('identifiers', v_ids, 'contacts', v_contacts, 'stores', v_stores);
      v_created := case when r.original_added is not null then ((r.original_added::timestamp + interval '12 hours') at time zone app.company_tz()) else now() end;
      v_status := coalesce((select s from unnest(array['New Lead','Contacted','No Answer','Interested','Not Interested','Follow-up Required','Qualified Lead','Invalid Contact']) s where s = r.status_text), 'New Lead');
      insert into clients(name, business_name, country, original_source, original_creator_id, status, created_at)
        values (coalesce(nullif(btrim(r.name),''),'بدون اسم'), r.business_name, coalesce(nullif(split_part(coalesce(r.phone_country,''),' ',1),''),'SA'),
                coalesce(nullif(r.source,''),'imported'), b.data_owner_id, 'lead', v_created) returning id into v_client;
      perform app._write_contacts(v_client, v_payload, false);
      insert into leads(client_id, original_creator_id, current_owner_id, assigned_sales_id, lead_status, call_notes, last_contact_at, updated_by, created_at,
                        import_batch_id, imported_by, imported_at, original_employee_name, date_known)
        values (v_client, b.data_owner_id, b.data_owner_id, v_sales, v_status, r.notes, case when v_status <> 'New Lead' then v_created end, b.imported_by, v_created,
                b.id, b.imported_by, now(), b.original_employee_name, r.original_added is not null)
        returning id into v_lead;
      insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
        values (v_lead, 'owner', null, b.data_owner_id, b.imported_by, 'استيراد بيانات سابقة');
      insert into lead_activities(lead_id, kind, status_to, note, created_by)
        values (v_lead, 'note', v_status, 'مستورد من ملف «' || b.file_name || '» — أضافه أصلًا: ' || coalesce(b.original_employee_name, app.emp_name(b.data_owner_id))
                 || ' — تاريخ الإضافة الأصلي: ' || coalesce(r.original_added::text, 'غير معروف') || ' — استورده: ' || app.emp_name(b.imported_by), b.imported_by);
      if v_sales is not null then perform app._ensure_deal(v_lead, v_sales, 'New Lead'); end if;
      select updated_at into v_upd from leads where id = v_lead;
      update import_rows set status = 'imported', client_id = v_client, lead_id = v_lead, lead_updated_at = v_upd, error = null where id = r.id;
      v_done := v_done + 1;
    exception
      when unique_violation then
        update import_rows set status = 'duplicate', reason = 'سُجّل الرقم أثناء الاستيراد' where id = r.id; v_dup := v_dup + 1;
      when others then
        update import_rows set status = 'error', error = left(SQLERRM, 300) where id = r.id; v_err := v_err + 1;
    end;
  end loop;
  select count(*) into v_rem from import_rows where batch_id = p_batch and status = 'new';
  if v_rem = 0 then update import_batches set status = 'completed', finished_at = now() where id = p_batch; end if;
  perform app._import_totals(p_batch);
  return jsonb_build_object('imported', v_done, 'duplicates', v_dup, 'errors', v_err, 'remaining', v_rem, 'done', v_rem = 0);
end $function$;

-- ───────── complete removal of a client and everything attached to it ─────────
create or replace function app.delete_client(p_client uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_name text; v_phones jsonb; v_leads uuid[]; v_deals uuid[]; v_meetings uuid[]; v_n int;
begin
  if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select name into v_name from clients where id = p_client for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(value), '[]') into v_phones from client_identifiers where client_id = p_client and kind = 'phone';
  select array_agg(id) into v_leads from leads where client_id = p_client;
  v_leads := coalesce(v_leads, '{}');
  select array_agg(id) into v_deals from deals where client_id = p_client or lead_id = any(v_leads);
  v_deals := coalesce(v_deals, '{}');
  select array_agg(id) into v_meetings from meetings where lead_id = any(v_leads);
  v_meetings := coalesce(v_meetings, '{}');
  delete from meeting_events where meeting_id = any(v_meetings);
  delete from meeting_participants where meeting_id = any(v_meetings);
  delete from meetings where id = any(v_meetings);
  delete from deal_briefs where deal_id = any(v_deals);
  delete from deal_stage_history where deal_id = any(v_deals);
  delete from follow_ups where deal_id = any(v_deals) or lead_id = any(v_leads);
  delete from deals where id = any(v_deals);
  delete from lead_activities where lead_id = any(v_leads);
  delete from lead_assignments where lead_id = any(v_leads);
  delete from lead_handoffs where lead_id = any(v_leads);
  update import_rows set client_id = null, lead_id = null, status = case when status = 'imported' then 'rolled_back' else status end,
         reason = case when status = 'imported' then 'تم حذف العميل' else reason end where client_id = p_client or lead_id = any(v_leads) or existing_client_id = p_client;
  update import_rows set existing_client_id = null where existing_client_id = p_client;
  delete from duplicate_reviews where existing_client_id = p_client;
  delete from client_identifiers where client_id = p_client;
  delete from client_contacts where client_id = p_client;
  delete from client_stores where client_id = p_client;
  delete from leads where client_id = p_client;
  delete from clients where id = p_client;
  insert into audit_logs(actor_id, action, entity_type, entity_id, old_value, reason)
  values (app.me(), 'DELETE', 'clients', p_client::text,
          jsonb_build_object('name', v_name, 'phones', v_phones, 'leads', cardinality(v_leads), 'deals', cardinality(v_deals), 'meetings', cardinality(v_meetings)), btrim(p_reason));
  return jsonb_build_object('deleted', 1, 'leads', cardinality(v_leads));
end $$;

-- delete everything one employee added in one month (same confirmation rules in the UI)
create or replace function app.delete_leads_month(p_emp uuid, p_month date, p_reason text) returns int
language plpgsql security definer set search_path = public, app as $$
declare r record; n int := 0;
begin
  if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_emp is null or p_month is null then raise exception 'employee and month required'; end if;
  for r in select distinct l.client_id from leads l where l.original_creator_id = p_emp and l.created_month = date_trunc('month', p_month)::date loop
    perform app.delete_client(r.client_id, p_reason); n := n + 1;
  end loop;
  return n;
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
