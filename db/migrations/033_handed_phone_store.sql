-- 033: the «تم تحويلها إلى السيلز» list also shows the client's phone and store link.
drop function if exists app.my_lead_outcomes(text);
create or replace function app.my_lead_outcomes(p_q text default null)
 RETURNS TABLE(lead_id uuid, client_name text, business_name text, lead_status text, handed_off_at timestamp with time zone, handoff_status text, to_name text, decided_at timestamp with time zone, meeting_status text, deal_outcome text, phone text, store_url text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
  with q as (select nullif(btrim(coalesce(p_q,'')), '') t),
       qq as (select t, '%' || app.ar_norm(replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_')) || '%' pat,
                     nullif(ltrim(regexp_replace(translate(t, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'), '0'), '') dig from q)
  select l.id, c.name, c.business_name, l.lead_status, coalesce(mh.handed_at, l.handed_off_at),
    (select h.status from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
    coalesce(app.emp_name(l.assigned_sales_id), app.emp_name(mh.to_employee_id)),
    (select h.decided_at from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1),
    (select m.status from meetings m where m.lead_id = l.id order by m.created_at desc limit 1),
    (select case when d.stage in ('Signed / Finance Pending','Financially Approved') then 'won' when d.stage = 'Lost' then 'lost' else 'open' end
       from deals d where d.lead_id = l.id order by d.created_at desc limit 1),
    (select cc.phone from client_contacts cc where cc.client_id = c.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
    (select s.url_raw from client_stores s where s.client_id = c.id order by s.created_at limit 1)
  from leads l join clients c on c.id = l.client_id cross join qq
  left join lateral (select h.handed_at, h.to_employee_id from lead_handoffs h where h.lead_id = l.id and h.from_employee_id = app.me() order by h.handed_at desc limit 1) mh on true
  where app.me() is not null and l.hidden_at is null
    and (mh.handed_at is not null or (l.original_creator_id = app.me() and l.handed_off_at is not null))
    and (qq.t is null
         or c.search_norm like qq.pat
         or exists (select 1 from client_stores s where s.client_id = c.id and (s.url_raw ilike qq.pat or s.url_key ilike qq.pat))
         or (qq.dig is not null and length(qq.dig) >= 3 and exists (select 1 from client_contacts cc where cc.client_id = c.id
               and (regexp_replace(coalesce(cc.phone,''),'\D','','g') like '%' || qq.dig || '%' or regexp_replace(coalesce(cc.phone_raw,''),'\D','','g') like '%' || qq.dig || '%'))))
  order by coalesce(mh.handed_at, l.handed_off_at) desc limit 5000
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
revoke execute on function app._notes_guard() from ghamer_app;
revoke execute on function app._notes_first() from ghamer_app;
