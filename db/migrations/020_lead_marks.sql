-- 020_lead_marks.sql — per-user manual row order + cell colours on the leads table.
-- Each employee has their own arrangement and colours (they never change anyone else's view).
create table if not exists lead_marks (
  user_id uuid not null,
  lead_id uuid not null references leads(id) on delete cascade,
  pos double precision,
  colors jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);
create index if not exists lead_marks_user_pos_idx on lead_marks(user_id, pos);
alter table lead_marks enable row level security;          -- no policies / grants: only the definer functions below touch it

-- when an employee account is deleted, their marks go too
create or replace function app._marks_user_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin delete from lead_marks where user_id = old.id; return old; end $$;
drop trigger if exists marks_user_cleanup on users;
create trigger marks_user_cleanup after delete on users for each row execute function app._marks_user_cleanup();

drop function if exists app.list_leads(text, text, text, date, uuid, uuid, text, text, text, integer, integer, text);
create or replace function app.list_leads(p_q text, p_phone text, p_status text, p_month date, p_creator uuid, p_sales uuid, p_temp text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_hidden text DEFAULT 'visible'::text)
 RETURNS TABLE(id uuid, client_id uuid, name text, business_name text, phone text, store_url text, lead_status text, lead_temperature text, call_notes text, next_followup_at timestamp with time zone, created_at timestamp with time zone, last_contact_at timestamp with time zone, original_creator_id uuid, creator_name text, assigned_sales_id uuid, sales_name text, handed_off boolean, dup_attempts integer, total integer, hidden_at timestamp with time zone, hidden_by_name text, hidden_reason text, pos double precision, colors jsonb)
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
    when 'manual' then 'm.pos asc nulls last, l.created_at desc'
    else 'l.created_at ' || v_dir end;
  v_ord2 := replace(replace(replace(v_ord, 'c.name', 'f.name'), 'l.', 'f.'), 'm.pos', 'f.pos');
  return query execute format($q$
    with f as (
      select l.id, l.client_id, c.name, c.business_name, l.lead_status, l.lead_temperature, l.call_notes, l.next_followup_at, l.created_at,
             l.last_contact_at, l.original_creator_id, l.assigned_sales_id, l.handed_off_at, l.hidden_at, l.hidden_by, l.hidden_reason, count(*) over()::int total,
             m.pos, coalesce(m.colors, '{}'::jsonb) colors
      from leads l join clients c on c.id = l.client_id left join lead_marks m on m.lead_id = l.id and m.user_id = $10
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
           f.total, f.hidden_at, app.emp_name(f.hidden_by), f.hidden_reason, f.pos, f.colors
    from f
  order by %s
  $q$, v_ord, v_ord2)
  using nullif(btrim(p_q),''), v_pat, case when p_phone is null then null else '%' || ltrim(regexp_replace(p_phone,'\D','','g'),'0') || '%' end,
        p_status, p_month, p_creator, p_sales, p_temp, v_role, v_me, v_team,
        least(coalesce(p_limit, 25), 100), greatest(coalesce(p_offset, 0), 0), app.can_see_hidden(), coalesce(p_hidden,'visible');
end $function$;

create or replace function app.mark_cells(p_lead uuid, p_cols text[], p_color text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_valid text[] := array['name','store','phone','hunter','date','status','notes','dup','time','temp','sales','followup','actions'];
        v_new jsonb;
begin
  if app.me() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if p_cols is null or coalesce(array_length(p_cols, 1), 0) = 0 or array_length(p_cols, 1) > 13 or not (p_cols <@ v_valid) then raise exception 'invalid column'; end if;
  if p_color is not null and p_color not in ('red','orange','yellow','green','teal','blue','purple','pink','gray') then raise exception 'invalid color'; end if;
  insert into lead_marks(user_id, lead_id, colors) values (app.me(), p_lead, '{}'::jsonb) on conflict (user_id, lead_id) do nothing;
  if p_color is null then
    update lead_marks m set colors = m.colors - p_cols, updated_at = now() where m.user_id = app.me() and m.lead_id = p_lead;
  else
    select coalesce(jsonb_object_agg(c, p_color), '{}'::jsonb) into v_new from unnest(p_cols) c;
    update lead_marks m set colors = m.colors || v_new, updated_at = now() where m.user_id = app.me() and m.lead_id = p_lead;
  end if;
  delete from lead_marks m where m.user_id = app.me() and m.lead_id = p_lead and m.pos is null and m.colors = '{}'::jsonb;
end $$;

-- saves the order the user arranged: the given leads get positions 1024, 2048, ... in that order (only leads they can see)
create or replace function app.reorder_leads(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, app as $$
declare n int;
begin
  if app.me() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 2000 then raise exception 'invalid list'; end if;
  with ord as (select t.id, t.n from unnest(p_ids) with ordinality t(id, n)),
       ok as (select o.id, o.n from ord o where app.lead_visible(o.id))
  insert into lead_marks(user_id, lead_id, pos)
  select app.me(), ok.id, ok.n * 1024.0 from ok
  on conflict (user_id, lead_id) do update set pos = excluded.pos, updated_at = now();
  get diagnostics n = row_count;
  -- leads not in this list (not loaded on screen) that already had a place keep their relative order, but go after the arranged ones
  with rest as (select m.lead_id, row_number() over (order by m.pos, m.lead_id) r from lead_marks m
                where m.user_id = app.me() and m.pos is not null and m.lead_id <> all(p_ids))
  update lead_marks m set pos = (array_length(p_ids, 1) + rest.r) * 1024.0
    from rest where m.user_id = app.me() and m.lead_id = rest.lead_id;
  return n;
end $$;

create or replace function app.reset_lead_order() returns void language sql security definer set search_path = public, app as $$
  update lead_marks set pos = null where user_id = app.me();
  delete from lead_marks where user_id = app.me() and pos is null and colors = '{}'::jsonb;
$$;

create or replace function app.has_manual_order() returns boolean language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and exists (select 1 from lead_marks where user_id = app.me() and pos is not null)
$$;

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
