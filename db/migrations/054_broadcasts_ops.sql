-- 054: the Technical Manager and the Account Managers can send pop-up messages too — to the technical team, the operations team,
-- or chosen people from those teams. The admin keeps every audience. The pop-up shows who sent it.
begin;
alter table broadcasts drop constraint if exists broadcasts_audience_check;
alter table broadcasts add constraint broadcasts_audience_check check (audience in ('all','tele','sales','finance','tech','ops','selected'));

create or replace function app._tech_ops_role(p_code text) returns boolean
language sql immutable as $$
  select p_code in ('operations_manager','account_manager','seo_specialist','ui_designer','developer','designer','branding_designer','content_creator',
                    'media_buyer','social_media_manager','technical_employee','technical_team_leader')
$$;

create or replace function app.broadcast_recipients() returns table(id uuid, full_name text, role_name text)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, r.name_ar from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
   where u.is_active and u.id <> app.me()
     and (app.is_super() or (app.role_code() in ('operations_manager','account_manager') and app._tech_ops_role(r.code)))
   order by r.name_ar, e.full_name
$$;

create or replace function app.broadcast_send(p_title text, p_body text, p_audience text, p_employees uuid[], p_request uuid) returns int
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid := coalesce(p_request, gen_random_uuid()); v_n int; v_super boolean := app.is_super();
begin
  if not (v_super or app.role_code() in ('operations_manager','account_manager')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_title),'') = '' or coalesce(btrim(p_body),'') = '' then raise exception 'message text required'; end if;
  if p_audience not in ('all','tele','sales','finance','tech','ops','selected') then raise exception 'invalid audience'; end if;
  if not v_super and p_audience not in ('tech','ops','selected') then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from broadcasts where id = v_id) then return (select recipients from broadcasts where id = v_id); end if;   -- pressed twice
  insert into broadcasts(id, title, body, audience, sent_by) values (v_id, btrim(p_title), btrim(p_body), p_audience, app.me());
  insert into notifications(user_id, kind, title, body, link, dedupe_key)
  select u.id, 'system', btrim(p_title), btrim(p_body), '/notifications', 'release:msg:' || v_id
    from users u join employees e on e.id = u.id join roles r on r.id = u.role_id
   where u.is_active and u.id <> app.me()
     and (v_super or app._tech_ops_role(r.code))                       -- non-admins reach the technical and operations teams only
     and case p_audience when 'all' then true
                         when 'tele' then r.code in ('tele_sales','tele_sales_manager')
                         when 'sales' then r.code in ('sales_rep','sales_manager')
                         when 'finance' then r.code in ('finance_manager','finance_employee')
                         when 'tech' then app._tech_ops_role(r.code) and r.code not in ('operations_manager','account_manager')
                         when 'ops' then r.code in ('operations_manager','account_manager')
                         else u.id = any(coalesce(p_employees, '{}')) end
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no recipients'; end if;
  update broadcasts set recipients = v_n where id = v_id;
  return v_n;
end $$;

drop function if exists app.broadcast_list();
create function app.broadcast_list() returns table(id uuid, title text, body text, audience text, recipients int, seen int, sent_by text, sent_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.title, b.body, b.audience, b.recipients,
         (select count(*)::int from notifications n where n.dedupe_key = 'release:msg:' || b.id and n.read_at is not null),
         app.emp_name(b.sent_by), b.sent_at
    from broadcasts b where app.is_super() or b.sent_by = app.me() order by b.sent_at desc limit 100
$$;

-- the pop-up for the signed-in user, with who sent it (when it is a message from a person who is not the admin)
create or replace function app.my_pending_notice() returns table(id uuid, title text, body text, link text, sender text)
language sql stable security definer set search_path = public, app as $$
  select n.id, n.title, n.body, n.link,
         (select app.emp_name(b.sent_by) || ' — ' || r.name_ar from broadcasts b join users u on u.id = b.sent_by join roles r on r.id = u.role_id
           where 'release:msg:' || b.id = n.dedupe_key and r.code <> 'super_admin')
    from notifications n where n.user_id = app.me() and n.read_at is null and n.kind = 'system' and n.dedupe_key like 'release:%'
   order by n.created_at desc limit 1
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
revoke execute on function app._notes_guard() from ghamer_app;
revoke execute on function app._notes_first() from ghamer_app;
grant execute on function app._tech_ops_role(text) to ghamer_app;

commit;
