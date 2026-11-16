-- 036: the system admin writes a message that pops up for the employees («رسالة من الإدارة»).
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 2000),
  audience text not null check (audience in ('all','tele','sales','finance','selected')),
  recipients int not null default 0,
  sent_by uuid references employees(id),
  sent_at timestamptz not null default now()
);
alter table broadcasts enable row level security;
drop policy if exists broadcasts_read on broadcasts;
create policy broadcasts_read on broadcasts for select to ghamer_app using ((select app.is_super()));
revoke all on broadcasts from ghamer_app; grant select on broadcasts to ghamer_app;
drop trigger if exists audit_broadcasts on broadcasts;
create trigger audit_broadcasts after insert or update or delete on broadcasts for each row execute function app.audit_row();

create or replace function app.broadcast_send(p_title text, p_body text, p_audience text, p_employees uuid[], p_request uuid) returns int
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid := coalesce(p_request, gen_random_uuid()); v_n int;
begin
  if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_title),'') = '' or coalesce(btrim(p_body),'') = '' then raise exception 'message text required'; end if;
  if p_audience not in ('all','tele','sales','finance','selected') then raise exception 'invalid audience'; end if;
  if exists (select 1 from broadcasts where id = v_id) then return (select recipients from broadcasts where id = v_id); end if;   -- pressed twice
  insert into broadcasts(id, title, body, audience, sent_by) values (v_id, btrim(p_title), btrim(p_body), p_audience, app.me());
  insert into notifications(user_id, kind, title, body, link, dedupe_key)
  select u.id, 'system', btrim(p_title), btrim(p_body), '/notifications', 'release:msg:' || v_id
    from users u join employees e on e.id = u.id join roles r on r.id = u.role_id
   where u.is_active and u.id <> app.me()
     and case p_audience when 'all' then true
                         when 'tele' then r.code in ('tele_sales','tele_sales_manager')
                         when 'sales' then r.code in ('sales_rep','sales_manager')
                         when 'finance' then r.code in ('finance_manager','finance_employee')
                         else u.id = any(coalesce(p_employees, '{}')) end
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no recipients'; end if;
  update broadcasts set recipients = v_n where id = v_id;
  return v_n;
end $$;

create or replace function app.broadcast_list() returns table(id uuid, title text, body text, audience text, recipients int, seen int, sent_by text, sent_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.title, b.body, b.audience, b.recipients,
         (select count(*)::int from notifications n where n.dedupe_key = 'release:msg:' || b.id and n.read_at is not null),
         app.emp_name(b.sent_by), b.sent_at
    from broadcasts b where app.is_super() order by b.sent_at desc limit 100
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
