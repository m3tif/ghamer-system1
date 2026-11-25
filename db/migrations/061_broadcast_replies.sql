-- 061: a message can ask for a reply. The employees get a box under the pop-up (and on the notifications page) to
-- write back; the sender sees every reply with who wrote it and when, and gets a notification for each one.
begin;
alter table broadcasts add column if not exists allow_reply boolean not null default false;
create table if not exists broadcast_replies (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  employee_id uuid not null references employees(id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists broadcast_replies_b on broadcast_replies(broadcast_id, created_at);
alter table broadcast_replies enable row level security;
revoke all on broadcast_replies from ghamer_app;
drop trigger if exists audit_broadcast_replies on broadcast_replies;
create trigger audit_broadcast_replies after insert or update or delete on broadcast_replies for each row execute function app.audit_row();

drop function if exists app.broadcast_send(text, text, text, uuid[], uuid);
create function app.broadcast_send(p_title text, p_body text, p_audience text, p_employees uuid[], p_request uuid, p_allow_reply boolean default false) returns int
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid := coalesce(p_request, gen_random_uuid()); v_n int; v_super boolean := app.is_super();
begin
  if not (v_super or app.role_code() in ('operations_manager','account_manager')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_title),'') = '' or coalesce(btrim(p_body),'') = '' then raise exception 'message text required'; end if;
  if p_audience not in ('all','tele','sales','finance','tech','ops','selected') then raise exception 'invalid audience'; end if;
  if not v_super and p_audience not in ('tech','ops','selected') then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from broadcasts where id = v_id) then return (select recipients from broadcasts where id = v_id); end if;   -- pressed twice
  insert into broadcasts(id, title, body, audience, sent_by, allow_reply) values (v_id, btrim(p_title), btrim(p_body), p_audience, app.me(), coalesce(p_allow_reply, false));
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

-- a recipient writes back (only to a message that asks for replies and that reached him)
create or replace function app.broadcast_reply(p_broadcast uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare b broadcasts; v_id uuid;
begin
  select * into b from broadcasts where id = p_broadcast;
  if b.id is null or not exists (select 1 from notifications where user_id = app.me() and dedupe_key = 'release:msg:' || b.id) then raise exception 'no access' using errcode = '42501'; end if;
  if not b.allow_reply then raise exception 'replies closed'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'reply text required'; end if;
  insert into broadcast_replies(broadcast_id, employee_id, body) values (b.id, app.me(), btrim(p_body)) returning id into v_id;
  update notifications set read_at = coalesce(read_at, now()) where user_id = app.me() and dedupe_key = 'release:msg:' || b.id;
  if b.sent_by is not null then
    perform app._notify(b.sent_by, 'broadcast_reply', 'رد على رسالتك: ' || b.title, app.emp_name(app.me()) || ': ' || left(btrim(p_body), 300), '/messages?b=' || b.id, 'brr:' || v_id);
  end if;
  return v_id;
end $$;

-- the sender (or the admin) reads the replies
create or replace function app.broadcast_replies(p_broadcast uuid) returns table(id uuid, employee text, role_name text, body text, created_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select r.id, app.emp_name(r.employee_id), ro.name_ar, r.body, r.created_at
    from broadcast_replies r join broadcasts b on b.id = r.broadcast_id join users u on u.id = r.employee_id join roles ro on ro.id = u.role_id
   where r.broadcast_id = p_broadcast and (app.is_super() or b.sent_by = app.me())
   order by r.created_at
$$;

-- what the signed-in employee can still reply to, and what he already wrote (for the notifications page)
create or replace function app.my_replyable() returns table(notification_id uuid, broadcast_id uuid, my_replies jsonb)
language sql stable security definer set search_path = public, app as $$
  select n.id, b.id, coalesce((select jsonb_agg(jsonb_build_object('body', r.body, 'at', r.created_at) order by r.created_at) from broadcast_replies r where r.broadcast_id = b.id and r.employee_id = app.me()), '[]')
    from notifications n join broadcasts b on 'release:msg:' || b.id = n.dedupe_key
   where n.user_id = app.me() and b.allow_reply
$$;

drop function if exists app.broadcast_list();
create function app.broadcast_list() returns table(id uuid, title text, body text, audience text, recipients int, seen int, sent_by text, sent_at timestamptz, allow_reply boolean, replies int)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.title, b.body, b.audience, b.recipients,
         (select count(*)::int from notifications n where n.dedupe_key = 'release:msg:' || b.id and n.read_at is not null),
         app.emp_name(b.sent_by), b.sent_at, b.allow_reply,
         (select count(*)::int from broadcast_replies r where r.broadcast_id = b.id)
    from broadcasts b where app.is_super() or b.sent_by = app.me() order by b.sent_at desc limit 100
$$;

drop function if exists app.my_pending_notice();
create function app.my_pending_notice() returns table(id uuid, title text, body text, link text, sender text, broadcast_id uuid, allow_reply boolean)
language sql stable security definer set search_path = public, app as $$
  select n.id, n.title, n.body, n.link,
         (select app.emp_name(b.sent_by) || ' — ' || r.name_ar from broadcasts b join users u on u.id = b.sent_by join roles r on r.id = u.role_id
           where 'release:msg:' || b.id = n.dedupe_key and r.code <> 'super_admin'),
         b2.id, coalesce(b2.allow_reply, false)
    from notifications n left join broadcasts b2 on 'release:msg:' || b2.id = n.dedupe_key
   where n.user_id = app.me() and n.read_at is null and n.kind = 'system' and n.dedupe_key like 'release:%'
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
