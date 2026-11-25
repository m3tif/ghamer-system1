-- 062: «تراجع عن الرسالة». The sender (or the system admin) withdraws a message: it disappears from every employee's
-- screen (an open pop-up closes on the next live check) and notifications, and takes no more replies. The message
-- itself, who withdrew it and when, and any replies that already came in, stay on record.
begin;
alter table broadcasts add column if not exists recalled_at timestamptz, add column if not exists recalled_by uuid references employees(id);

create or replace function app.broadcast_recall(p_broadcast uuid) returns int
language plpgsql security definer set search_path = public, app as $$
declare b broadcasts; v_n int;
begin
  select * into b from broadcasts where id = p_broadcast for update;
  if b.id is null or not (app.is_super() or b.sent_by = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.recalled_at is not null then return 0; end if;
  perform set_config('app.reason', 'تراجع عن رسالة: ' || b.title, true);
  delete from notifications where dedupe_key = 'release:msg:' || b.id;
  get diagnostics v_n = row_count;
  update broadcasts set recalled_at = now(), recalled_by = app.me(), allow_reply = false where id = b.id;
  return v_n;
end $$;

-- all of my pop-ups that are still waiting (the live check closes any open one that is no longer here)
create or replace function app.my_open_notices() returns uuid[]
language sql stable security definer set search_path = public, app as $$
  select coalesce(array_agg(id), '{}') from notifications where user_id = app.me() and read_at is null and kind = 'system' and dedupe_key like 'release:%'
$$;

drop function if exists app.broadcast_list();
create function app.broadcast_list() returns table(id uuid, title text, body text, audience text, recipients int, seen int, sent_by text, sent_at timestamptz, allow_reply boolean, replies int, recalled_at timestamptz, recalled_by text, mine boolean)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.title, b.body, b.audience, b.recipients,
         (select count(*)::int from notifications n where n.dedupe_key = 'release:msg:' || b.id and n.read_at is not null),
         app.emp_name(b.sent_by), b.sent_at, b.allow_reply,
         (select count(*)::int from broadcast_replies r where r.broadcast_id = b.id),
         b.recalled_at, app.emp_name(b.recalled_by), b.sent_by = app.me()
    from broadcasts b where app.is_super() or b.sent_by = app.me() order by b.sent_at desc limit 100
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
