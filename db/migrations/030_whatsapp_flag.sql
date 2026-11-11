-- 030: optional "has WhatsApp?" per lead (yes / no / not known yet) + a one-time "what's new" notification for every employee.
alter table leads add column if not exists has_whatsapp boolean;   -- null = not known yet
grant update (has_whatsapp) on leads to ghamer_app;

drop function if exists app.list_leads(text, text, text, date, uuid, uuid, text, text, text, integer, integer, text);
drop function if exists app.list_leads(text, text, text, date, uuid, uuid, text, text, text, integer, integer, text, text);
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
           f.received_at, app.emp_name(f.received_from_id), (select b.file_name from import_batches b where b.id = f.import_batch_id), f.original_source, f.has_whatsapp
    from f
  order by %s
  $q$, v_ord, v_ord2)
  using nullif(btrim(p_q),''), v_pat, case when p_phone is null then null else '%' || ltrim(regexp_replace(p_phone,'\D','','g'),'0') || '%' end,
        p_status, p_month, p_creator, p_sales, p_temp, v_role, v_me, v_team,
        least(coalesce(p_limit, 25), 100), greatest(coalesce(p_offset, 0), 0), app.can_see_hidden(), coalesce(p_hidden,'visible'), p_scope;
end $function$;

CREATE OR REPLACE FUNCTION app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_hidden text DEFAULT 'visible'::text)
 RETURNS TABLE(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text, call_notes text, next_followup_at timestamp with time zone, created_at timestamp with time zone, last_contact_at timestamp with time zone, original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean, dup_attempts integer, total integer, hidden_at timestamp with time zone, hidden_by_name text, hidden_reason text, pos double precision, colors jsonb, received_at timestamp with time zone, received_from text, batch_name text, source text, has_whatsapp boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$ select * from app.list_leads(p_q, p_phone, p_status, p_month, p_creator, p_sales, p_temp, p_sort, p_dir, p_limit, p_offset, p_hidden, null::text) $function$;

-- tell every active employee once
insert into notifications(user_id, kind, title, body, link, dedupe_key)
select u.id, 'system', 'تحديث جديد: خانة «واتساب»',
       'في نافذة تعديل العميل بقى فيه خانة «عنده واتساب؟» (نعم / لا). مش إجبارية — اختارها لما تعرف. وبتظهر جنب رقم العميل في الجدول.',
       '/leads', 'release:whatsapp-2026-11'
  from users u join employees e on e.id = u.id where u.is_active
on conflict (user_id, dedupe_key) do nothing;

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
