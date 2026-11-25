-- 063: «تراجع» from specific employees. The sender picks who loses the message (or everyone): it leaves only their
-- screens and notifications; the others keep it. Each withdrawal is recorded per employee (who, by whom, when).
begin;
create table if not exists broadcast_recalls (
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  user_id uuid not null references employees(id),
  recalled_by uuid references employees(id),
  recalled_at timestamptz not null default now(),
  primary key (broadcast_id, user_id));
alter table broadcast_recalls enable row level security;
drop trigger if exists audit_broadcast_recalls on broadcast_recalls;
create trigger audit_broadcast_recalls after insert or update or delete on broadcast_recalls for each row execute function app.audit_row();
-- messages already withdrawn from everyone before this (062) have no per-employee rows; they stay marked as a whole

drop function if exists app.broadcast_recall(uuid);
create function app.broadcast_recall(p_broadcast uuid, p_users uuid[] default null) returns int
language plpgsql security definer set search_path = public, app as $$
declare b broadcasts; v_n int;
begin
  select * into b from broadcasts where id = p_broadcast for update;
  if b.id is null or not (app.is_super() or b.sent_by = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.recalled_at is not null then return 0; end if;
  if p_users is not null and cardinality(p_users) = 0 then raise exception 'choose employees'; end if;
  perform set_config('app.reason', 'تراجع عن رسالة: ' || b.title, true);
  with gone as (delete from notifications where dedupe_key = 'release:msg:' || b.id and (p_users is null or user_id = any(p_users)) returning user_id)
  insert into broadcast_recalls(broadcast_id, user_id, recalled_by) select b.id, user_id, app.me() from gone
    on conflict do nothing;
  get diagnostics v_n = row_count;
  -- nobody left holding it: the message as a whole is withdrawn (no more replies)
  if not exists (select 1 from notifications where dedupe_key = 'release:msg:' || b.id) then
    update broadcasts set recalled_at = now(), recalled_by = app.me(), allow_reply = false where id = b.id;
  end if;
  return v_n;
end $$;

-- who a message went to, whether they saw it, and whether it was withdrawn from them (sender or admin only)
create or replace function app.broadcast_people(p_ids uuid[]) returns table(broadcast_id uuid, user_id uuid, name text, role_name text, seen boolean, recalled_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  with mine as (select id from broadcasts where id = any(p_ids) and (app.is_super() or sent_by = app.me()))
  select b.id, n.user_id, app.emp_name(n.user_id), ro.name_ar, n.read_at is not null, null::timestamptz
    from mine b join notifications n on n.dedupe_key = 'release:msg:' || b.id join users u on u.id = n.user_id join roles ro on ro.id = u.role_id
  union all
  select b.id, r.user_id, app.emp_name(r.user_id), ro.name_ar, false, r.recalled_at
    from mine b join broadcast_recalls r on r.broadcast_id = b.id join users u on u.id = r.user_id join roles ro on ro.id = u.role_id
  order by 1, 6 nulls first, 3
$$;

drop function if exists app.broadcast_list();
create function app.broadcast_list() returns table(id uuid, title text, body text, audience text, recipients int, seen int, sent_by text, sent_at timestamptz, allow_reply boolean, replies int, recalled_at timestamptz, recalled_by text, mine boolean, recalled_count int)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.title, b.body, b.audience, b.recipients,
         (select count(*)::int from notifications n where n.dedupe_key = 'release:msg:' || b.id and n.read_at is not null),
         app.emp_name(b.sent_by), b.sent_at, b.allow_reply,
         (select count(*)::int from broadcast_replies r where r.broadcast_id = b.id),
         b.recalled_at, app.emp_name(b.recalled_by), b.sent_by = app.me(),
         (select count(*)::int from broadcast_recalls r where r.broadcast_id = b.id)
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
