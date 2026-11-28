-- 065: Client Portal («بوابة العملاء»).
-- A client whose contract was approved gets his own login (mobile number + password), separate from employee accounts,
-- and follows his project: stages, progress, updates, tasks the team chose to show, approvals, documents, requests and
-- support tickets. The project IS the existing client_operations row (one per approved contract) — no duplicate client.
--
-- Security model
-- * Clients never get an employee identity: a portal request sets app.portal_id only, never app.user_id, so every
--   existing staff function (which reads app.me()) sees nobody.
-- * Every portal table is closed to ghamer_app (RLS on, no grants); clients reach data only through app.portal_*
--   functions, each scoped to the signed-in account's own client. Staff reach it through app.portal_staff_* functions
--   with the same rule as tasks: the client's Account Manager, the Technical Manager, the admin.
-- * Internal data (task comments, time logs, employee details, CRM notes) is never returned to a client. Anything a
--   client sees was published to him on purpose (an update, a visible task/file, a reply in his own thread).
-- * Every action is stored with who and when (portal_events), and the portal tables are audited.
begin;

-- ───────── tables ─────────
create table if not exists portal_stage_defaults (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now());
insert into portal_stage_defaults(name, sort)
select x.name, x.sort from (values ('البداية وتجميع البيانات', 1), ('التخطيط وخطة العمل', 2), ('تنفيذ الشغل', 3), ('مراجعة العميل', 4), ('التعديلات', 5), ('التسليم النهائي', 6), ('الدعم والمتابعة', 7)) x(name, sort)
where not exists (select 1 from portal_stage_defaults);

create table if not exists portal_projects (
  ops_id uuid primary key references client_operations(id),
  title text not null check (length(btrim(title)) between 2 and 160),
  start_date date, expected_end date,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references employees(id),
  updated_at timestamptz not null default now());

create table if not exists portal_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references clients(id),
  phone text not null unique,
  password_hash text not null,
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table if not exists portal_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references portal_accounts(id) on delete cascade,
  token_hash text not null unique,
  ip text, user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now());

create table if not exists project_stages (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  name text not null check (length(btrim(name)) between 2 and 80),
  sort int not null default 0,
  status text not null default 'pending' check (status in ('pending','current','done')),
  planned_date date,
  started_at timestamptz, done_at timestamptz,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now());
create index if not exists project_stages_ops on project_stages(ops_id, sort);
create unique index if not exists project_stages_one_current on project_stages(ops_id) where status = 'current';

create table if not exists project_updates (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  stage_id uuid references project_stages(id) on delete set null,
  title text not null check (length(btrim(title)) between 2 and 160),
  body text check (length(body) <= 4000),
  auto boolean not null default false,
  created_by uuid references employees(id),
  created_at timestamptz not null default now());
create index if not exists project_updates_ops on project_updates(ops_id, created_at desc);

create table if not exists portal_requests (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  title text not null check (length(btrim(title)) between 2 and 160),
  description text check (length(description) <= 2000),
  due_date date,
  status text not null default 'open' check (status in ('open','submitted','done','cancelled')),
  response text check (length(response) <= 4000),
  responded_at timestamptz,
  return_note text check (length(return_note) <= 1000),
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  closed_by uuid references employees(id), closed_at timestamptz);
create index if not exists portal_requests_ops on portal_requests(ops_id, status);

create table if not exists portal_tickets (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  subject text not null check (length(btrim(subject)) between 2 and 160),
  status text not null default 'open' check (status in ('open','answered','closed')),
  created_by_account uuid references portal_accounts(id),
  created_by_employee uuid references employees(id),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz, closed_by text);
create index if not exists portal_tickets_ops on portal_tickets(ops_id, last_activity_at desc);

-- a client-visible conversation line: on a ticket, an update, a shown task or a request
create table if not exists portal_messages (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  thread_kind text not null check (thread_kind in ('ticket','update','task','request')),
  thread_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  author_employee uuid references employees(id),
  author_account uuid references portal_accounts(id),
  created_at timestamptz not null default now(),
  check ((author_employee is null) <> (author_account is null)));
create index if not exists portal_messages_thread on portal_messages(thread_kind, thread_id, created_at);

create table if not exists portal_files (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  thread_kind text check (thread_kind in ('ticket','update','task','request')),
  thread_id uuid,
  filename text not null check (length(filename) between 1 and 200),
  mime_type text not null,
  size_bytes int not null check (size_bytes between 1 and 4194304),
  content bytea not null,
  visible_to_client boolean not null default false,
  uploaded_by_employee uuid references employees(id),
  uploaded_by_account uuid references portal_accounts(id),
  created_at timestamptz not null default now(),
  check ((uploaded_by_employee is null) <> (uploaded_by_account is null)));
create index if not exists portal_files_ops on portal_files(ops_id, created_at desc);

create table if not exists portal_notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references portal_accounts(id) on delete cascade,
  ops_id uuid references client_operations(id),
  title text not null, body text, link text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (account_id, dedupe_key));
create index if not exists portal_notifications_acc on portal_notifications(account_id, created_at desc);

-- the activity log of a project: every action by staff or client, with who and when
create table if not exists portal_events (
  id bigserial primary key,
  ops_id uuid not null references client_operations(id),
  at timestamptz not null default now(),
  actor_employee uuid references employees(id),
  actor_account uuid references portal_accounts(id),
  action text not null,
  detail text);
create index if not exists portal_events_ops on portal_events(ops_id, at desc);

alter table tasks add column if not exists client_visible boolean not null default false,
  add column if not exists portal_stage_id uuid references project_stages(id) on delete set null,
  add column if not exists client_note text check (length(client_note) <= 2000),
  add column if not exists client_decided_by_account uuid references portal_accounts(id);

do $$ declare t text; begin
  foreach t in array array['portal_stage_defaults','portal_projects','portal_accounts','portal_sessions','project_stages','project_updates','portal_requests','portal_tickets','portal_messages','portal_files','portal_notifications','portal_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from ghamer_app', t);
  end loop;
end $$;
revoke all on sequence portal_events_id_seq from ghamer_app;
drop trigger if exists audit_portal_projects on portal_projects;
create trigger audit_portal_projects after insert or update or delete on portal_projects for each row execute function app.audit_row();
drop trigger if exists audit_portal_accounts on portal_accounts;
create trigger audit_portal_accounts after insert or update or delete on portal_accounts for each row execute function app.audit_row('password_hash','failed_attempts','locked_until','last_login_at');
drop trigger if exists audit_project_stages on project_stages;
create trigger audit_project_stages after insert or update or delete on project_stages for each row execute function app.audit_row();
drop trigger if exists audit_project_updates on project_updates;
create trigger audit_project_updates after insert or update or delete on project_updates for each row execute function app.audit_row();
drop trigger if exists audit_portal_requests on portal_requests;
create trigger audit_portal_requests after insert or update or delete on portal_requests for each row execute function app.audit_row();
drop trigger if exists audit_portal_tickets on portal_tickets;
create trigger audit_portal_tickets after insert or update or delete on portal_tickets for each row execute function app.audit_row();
drop trigger if exists audit_portal_messages on portal_messages;
create trigger audit_portal_messages after insert or update or delete on portal_messages for each row execute function app.audit_row();
drop trigger if exists audit_portal_files on portal_files;
create trigger audit_portal_files after insert or update or delete on portal_files for each row execute function app.audit_row('content');
drop trigger if exists audit_portal_stage_defaults on portal_stage_defaults;
create trigger audit_portal_stage_defaults after insert or update or delete on portal_stage_defaults for each row execute function app.audit_row();

-- ───────── identity ─────────
-- the signed-in client account (never together with an employee identity)
create or replace function app.portal_me() returns uuid language sql stable security definer set search_path = public, app as $$
  select case when app.me() is null then nullif(current_setting('app.portal_id', true), '')::uuid end
$$;
create or replace function app._portal_client() returns uuid language sql stable security definer set search_path = public, app as $$
  select a.client_id from portal_accounts a where a.id = app.portal_me() and a.is_active
$$;
-- the project belongs to the signed-in client and is open in the portal
create or replace function app._portal_mine(p_ops uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from client_operations o join portal_projects p on p.ops_id = o.id
                  where o.id = p_ops and o.client_id = app._portal_client())
$$;
-- staff: may see / may run the portal of this project (same people as tasks)
create or replace function app._portal_staff_view(p_ops uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select coalesce((select app._ops_visible(o.account_manager_id) from client_operations o where o.id = p_ops), false)
$$;
create or replace function app._portal_staff(p_ops uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select coalesce((select app._task_can_manage(o.account_manager_id) from client_operations o where o.id = p_ops), false)
$$;
create or replace function app._portal_account_of(p_ops uuid) returns uuid language sql stable security definer set search_path = public, app as $$
  select a.id from portal_accounts a join client_operations o on o.client_id = a.client_id
   where o.id = p_ops and a.is_active and exists (select 1 from portal_projects p where p.ops_id = o.id)
$$;
create or replace function app._portal_log(p_ops uuid, p_action text, p_detail text) returns void language sql security definer set search_path = public, app as $$
  insert into portal_events(ops_id, actor_employee, actor_account, action, detail) values (p_ops, app.me(), app.portal_me(), p_action, left(p_detail, 500))
$$;
create or replace function app._portal_notify(p_ops uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void language sql security definer set search_path = public, app as $$
  insert into portal_notifications(account_id, ops_id, title, body, link, dedupe_key)
  select a, p_ops, p_title, left(p_body, 500), p_link, p_dedupe from (select app._portal_account_of(p_ops) a) x where a is not null
  on conflict (account_id, dedupe_key) do nothing
$$;
-- tell the client's Account Manager (or, with none, the Technical Managers) that the client did something
create or replace function app._portal_tell_staff(p_ops uuid, p_title text, p_body text, p_dedupe text) returns void language plpgsql security definer set search_path = public, app as $$
declare o client_operations; u uuid;
begin
  select * into o from client_operations where id = p_ops;
  for u in select o.account_manager_id where o.account_manager_id is not null
           union select us.id from users us join roles r on r.id = us.role_id where o.account_manager_id is null and r.code = 'operations_manager' and us.is_active loop
    perform app._notify(u, 'portal', p_title, p_body, '/operations/' || p_ops || '/portal', p_dedupe);
  end loop;
end $$;

-- progress: every stage has the same weight; finished stages count in full, the current one by the share of its
-- linked tasks that are done (cancelled tasks don't count). Shown to the client together with this explanation.
create or replace function app._portal_progress(p_ops uuid) returns int language sql stable security definer set search_path = public, app as $$
  with s as (select count(*) n, count(*) filter (where status = 'done') d from project_stages where ops_id = p_ops),
       c as (select coalesce(count(*) filter (where t.status = 'approved')::numeric / nullif(count(*) filter (where t.status <> 'cancelled'), 0), 0) f
               from project_stages ps left join tasks t on t.portal_stage_id = ps.id where ps.ops_id = p_ops and ps.status = 'current')
  select case when s.n = 0 then 0 else least(100, round(100 * (s.d + coalesce(c.f, 0)) / s.n))::int end from s, c
$$;

-- ───────── sign-in (called before anyone is signed in, like the staff ones) ─────────
create or replace function app.portal_auth_lookup(p_phone text) returns table(id uuid, password_hash text, is_active boolean, locked_until timestamptz)
language sql stable security definer set search_path = public, app as $$
  select a.id, a.password_hash, a.is_active and exists (select 1 from portal_projects p join client_operations o on o.id = p.ops_id where o.client_id = a.client_id), a.locked_until
    from portal_accounts a where a.phone = p_phone
$$;
create or replace function app.portal_auth_fail(p_id uuid) returns void language sql security definer set search_path = public, app as $$
  update portal_accounts set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
         locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end where id = p_id
$$;
create or replace function app.portal_session_create(p_id uuid, p_hash text, p_ttl_hours int, p_ip text, p_ua text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  update portal_accounts set failed_attempts = 0, locked_until = null, last_login_at = now() where id = p_id;
  delete from portal_sessions where account_id = p_id and expires_at < now();
  insert into portal_sessions(account_id, token_hash, ip, user_agent, expires_at) values (p_id, p_hash, p_ip, left(p_ua, 300), now() + make_interval(hours => p_ttl_hours));
end $$;
create or replace function app.portal_session_get(p_hash text) returns table(account_id uuid, client_name text, phone text, must_change_password boolean, unread int)
language plpgsql security definer set search_path = public, app as $$
begin
  update portal_sessions set last_seen_at = now() where token_hash = p_hash and last_seen_at < now() - interval '1 minute';
  return query
    select a.id, coalesce(nullif(c.business_name, ''), c.name), a.phone, a.must_change_password,
           (select count(*)::int from portal_notifications n where n.account_id = a.id and n.read_at is null)
      from portal_sessions s join portal_accounts a on a.id = s.account_id join clients c on c.id = a.client_id
     where s.token_hash = p_hash and s.expires_at > now() and a.is_active;
end $$;
create or replace function app.portal_session_delete(p_hash text) returns void language sql security definer set search_path = public, app as $$
  delete from portal_sessions where token_hash = p_hash
$$;
-- the client sets his own password (first sign-in, or later from his settings); other sessions are signed out
create or replace function app.portal_set_password(p_hash text, p_keep_session text) returns void language plpgsql security definer set search_path = public, app as $$
begin
  if app.portal_me() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.reason', 'بوابة العميل: غيّر كلمة المرور', true);
  update portal_accounts set password_hash = p_hash, must_change_password = false, updated_at = now() where id = app.portal_me();
  delete from portal_sessions where account_id = app.portal_me() and token_hash <> p_keep_session;
end $$;
create or replace function app.portal_password_hash() returns text language sql stable security definer set search_path = public, app as $$
  select password_hash from portal_accounts where id = app.portal_me()
$$;

-- ───────── staff: open the portal for a project ─────────
-- Creates the project (with the default stages, the first one current) and, if the client has no account yet,
-- his account with a temporary password the app generated (only its hash comes here). Returns whether a new
-- account was made, so the screen shows the temporary password once.
create or replace function app.portal_enable(p_ops uuid, p_phone text, p_hash text, p_title text) returns boolean
language plpgsql security definer set search_path = public, app as $$
declare o client_operations; c contracts; v_new boolean := false; v_first uuid; v_acc uuid;
begin
  select * into o from client_operations where id = p_ops for update;
  if not found or not app._portal_staff(p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if o.account_manager_id is null then raise exception 'assign an account manager first'; end if;
  select * into c from contracts where id = o.contract_id;
  if c.status <> 'approved' then raise exception 'contract is not approved'; end if;
  if coalesce(p_phone, '') !~ '^\+[0-9]{8,15}$' then raise exception 'invalid phone'; end if;
  perform set_config('app.reason', 'تفعيل بوابة العميل', true);
  if not exists (select 1 from portal_projects where ops_id = p_ops) then
    insert into portal_projects(ops_id, title, start_date, expected_end, enabled_by)
    values (p_ops, coalesce(nullif(btrim(p_title), ''), (select coalesce(nullif(cl.business_name, ''), cl.name) from clients cl where cl.id = o.client_id)), c.start_date, c.end_date, app.me());
    insert into project_stages(ops_id, name, sort, updated_by) select p_ops, d.name, d.sort, app.me() from portal_stage_defaults d where d.is_active order by d.sort;
    select id into v_first from project_stages where ops_id = p_ops order by sort limit 1;
    update project_stages set status = 'current', started_at = now() where id = v_first;
    perform app._portal_log(p_ops, 'تفعيل البوابة', null);
  end if;
  select id into v_acc from portal_accounts where client_id = o.client_id;
  if v_acc is null then
    if exists (select 1 from portal_accounts where phone = p_phone) then raise exception 'phone already has a portal account'; end if;
    insert into portal_accounts(client_id, phone, password_hash, created_by) values (o.client_id, p_phone, p_hash, app.me()) returning id into v_acc;
    v_new := true;
    perform app._portal_log(p_ops, 'إنشاء حساب العميل', p_phone);
  end if;
  return v_new;
end $$;

-- the admin gives the client a new temporary password (the client sets his own at the next sign-in)
create or replace function app.portal_reset_password(p_ops uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_acc uuid;
begin
  if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  select a.id into v_acc from portal_accounts a join client_operations o on o.client_id = a.client_id where o.id = p_ops;
  if v_acc is null then raise exception 'not found'; end if;
  perform set_config('app.reason', 'كلمة مرور مؤقتة جديدة لبوابة العميل', true);
  update portal_accounts set password_hash = p_hash, must_change_password = true, failed_attempts = 0, locked_until = null, updated_at = now() where id = v_acc;
  delete from portal_sessions where account_id = v_acc;
  perform app._portal_log(p_ops, 'كلمة مرور مؤقتة جديدة', null);
end $$;

-- stop / allow the client's sign-in (admin, Technical Manager)
create or replace function app.portal_set_active(p_ops uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_acc uuid;
begin
  if not (app.is_super() or app.role_code() = 'operations_manager') then raise exception 'not allowed' using errcode = '42501'; end if;
  select a.id into v_acc from portal_accounts a join client_operations o on o.client_id = a.client_id where o.id = p_ops;
  if v_acc is null then raise exception 'not found'; end if;
  update portal_accounts set is_active = p_active, updated_at = now() where id = v_acc;
  if not p_active then delete from portal_sessions where account_id = v_acc; end if;
  perform app._portal_log(p_ops, case when p_active then 'السماح بدخول العميل' else 'إيقاف دخول العميل' end, null);
end $$;

create or replace function app.portal_project_save(p_ops uuid, p_title text, p_start date, p_end date) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not app._portal_staff(p_ops) or not exists (select 1 from portal_projects where ops_id = p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'title required'; end if;
  if p_start is not null and p_end is not null and p_end < p_start then raise exception 'due date is before start date'; end if;
  update portal_projects set title = btrim(p_title), start_date = p_start, expected_end = p_end, updated_at = now() where ops_id = p_ops;
  perform app._portal_log(p_ops, 'تعديل بيانات المشروع', btrim(p_title));
end $$;

-- ───────── staff: stages ─────────
create or replace function app.portal_stage_save(p_ops uuid, p_stage uuid, p_name text, p_planned date) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app._portal_staff(p_ops) or not exists (select 1 from portal_projects where ops_id = p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'title required'; end if;
  if p_stage is null then
    insert into project_stages(ops_id, name, sort, planned_date, updated_by)
    values (p_ops, btrim(p_name), coalesce((select max(sort) from project_stages where ops_id = p_ops), 0) + 1, p_planned, app.me()) returning id into v_id;
    perform app._portal_log(p_ops, 'إضافة مرحلة', btrim(p_name));
  else
    update project_stages set name = btrim(p_name), planned_date = p_planned, updated_by = app.me(), updated_at = now() where id = p_stage and ops_id = p_ops returning id into v_id;
    if v_id is null then raise exception 'not found'; end if;
    perform app._portal_log(p_ops, 'تعديل مرحلة', btrim(p_name));
  end if;
  return v_id;
end $$;

create or replace function app.portal_stage_move(p_stage uuid, p_dir int) returns void
language plpgsql security definer set search_path = public, app as $$
declare s project_stages; n project_stages;
begin
  select * into s from project_stages where id = p_stage;
  if not found or not app._portal_staff(s.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into n from project_stages where ops_id = s.ops_id and case when p_dir < 0 then sort < s.sort else sort > s.sort end
   order by case when p_dir < 0 then -sort else sort end limit 1;
  if n.id is null then return; end if;
  update project_stages set sort = n.sort, updated_at = now() where id = s.id;
  update project_stages set sort = s.sort, updated_at = now() where id = n.id;
end $$;

create or replace function app.portal_stage_delete(p_stage uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare s project_stages;
begin
  select * into s from project_stages where id = p_stage;
  if not found or not app._portal_staff(s.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.status = 'current' then raise exception 'cannot delete the current stage'; end if;
  if (select count(*) from project_stages where ops_id = s.ops_id) <= 1 then raise exception 'cannot delete the current stage'; end if;
  perform set_config('app.reason', 'حذف مرحلة من مراحل المشروع', true);
  update tasks set portal_stage_id = null where portal_stage_id = s.id;
  delete from project_stages where id = s.id;
  perform app._portal_log(s.ops_id, 'حذف مرحلة', s.name);
end $$;

-- make a stage the current one: stages before it are done, after it are still to come. The client is told.
create or replace function app.portal_stage_set_current(p_stage uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare s project_stages;
begin
  select * into s from project_stages where id = p_stage;
  if not found or not app._portal_staff(s.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.status = 'current' then return; end if;
  update project_stages set status = 'pending', updated_at = now() where ops_id = s.ops_id and status = 'current';
  update project_stages set status = 'done', done_at = coalesce(done_at, now()), updated_at = now() where ops_id = s.ops_id and sort < s.sort and status <> 'done';
  update project_stages set status = 'pending', done_at = null, started_at = null, updated_at = now() where ops_id = s.ops_id and sort > s.sort;
  update project_stages set status = 'current', started_at = now(), done_at = null, updated_by = app.me(), updated_at = now() where id = s.id;
  insert into project_updates(ops_id, stage_id, title, body, auto, created_by) values (s.ops_id, s.id, 'المشروع دخل مرحلة: ' || s.name, null, true, app.me());
  perform app._portal_log(s.ops_id, 'المرحلة الحالية', s.name);
  perform app._portal_notify(s.ops_id, 'مشروعك دخل مرحلة جديدة', s.name, '/portal/project?p=' || s.ops_id, 'stage:' || s.id || ':' || extract(epoch from now())::bigint);
end $$;

-- the current stage is finished: it is done, the next becomes current (the last one finishing closes the project)
create or replace function app.portal_stage_advance(p_ops uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare cur project_stages; nxt project_stages;
begin
  if not app._portal_staff(p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into cur from project_stages where ops_id = p_ops and status = 'current';
  if cur.id is null then raise exception 'not found'; end if;
  select * into nxt from project_stages where ops_id = p_ops and sort > cur.sort order by sort limit 1;
  update project_stages set status = 'done', done_at = now(), updated_by = app.me(), updated_at = now() where id = cur.id;
  if nxt.id is not null then
    update project_stages set status = 'current', started_at = now(), updated_by = app.me(), updated_at = now() where id = nxt.id;
    insert into project_updates(ops_id, stage_id, title, auto, created_by) values (p_ops, nxt.id, 'خلصنا «' || cur.name || '» وبدأنا «' || nxt.name || '»', true, app.me());
    perform app._portal_notify(p_ops, 'مشروعك دخل مرحلة جديدة', nxt.name, '/portal/project?p=' || p_ops, 'stage:' || nxt.id || ':' || extract(epoch from now())::bigint);
  else
    insert into project_updates(ops_id, stage_id, title, auto, created_by) values (p_ops, cur.id, 'خلصنا آخر مرحلة: ' || cur.name, true, app.me());
    perform app._portal_notify(p_ops, 'خلصنا كل مراحل مشروعك 🎉', cur.name, '/portal/project?p=' || p_ops, 'stage:' || cur.id || ':done');
  end if;
  perform app._portal_log(p_ops, 'المرحلة خلصت', cur.name);
end $$;

-- ───────── staff: updates, requests, tickets, messages, files, tasks ─────────
create or replace function app.portal_update_post(p_ops uuid, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app._portal_staff(p_ops) or not exists (select 1 from portal_projects where ops_id = p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'title required'; end if;
  insert into project_updates(ops_id, stage_id, title, body, created_by)
  values (p_ops, (select id from project_stages where ops_id = p_ops and status = 'current'), btrim(p_title), nullif(btrim(p_body), ''), app.me()) returning id into v_id;
  perform app._portal_log(p_ops, 'نشر تحديث', btrim(p_title));
  perform app._portal_notify(p_ops, 'تحديث جديد على مشروعك', btrim(p_title), '/portal/project?p=' || p_ops || '#u-' || v_id, 'upd:' || v_id);
  return v_id;
end $$;

create or replace function app.portal_request_save(p_ops uuid, p_title text, p_desc text, p_due date) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app._portal_staff(p_ops) or not exists (select 1 from portal_projects where ops_id = p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'title required'; end if;
  insert into portal_requests(ops_id, title, description, due_date, created_by) values (p_ops, btrim(p_title), nullif(btrim(p_desc), ''), p_due, app.me()) returning id into v_id;
  perform app._portal_log(p_ops, 'طلب من العميل', btrim(p_title));
  perform app._portal_notify(p_ops, 'مطلوب منك', btrim(p_title), '/portal/tasks?p=' || p_ops || '#r-' || v_id, 'req:' || v_id);
  return v_id;
end $$;

-- the client's answer is accepted (done), sent back with a note (open again), or the request is cancelled
create or replace function app.portal_request_close(p_request uuid, p_result text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare r portal_requests;
begin
  select * into r from portal_requests where id = p_request for update;
  if not found or not app._portal_staff(r.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.status in ('done','cancelled') then raise exception 'request is closed'; end if;
  if p_result = 'done' then
    update portal_requests set status = 'done', closed_by = app.me(), closed_at = now(), return_note = null where id = r.id;
    perform app._portal_notify(r.ops_id, 'استلمنا اللي طلبناه منك ✓', r.title, '/portal/tasks?p=' || r.ops_id, 'reqdone:' || r.id);
  elsif p_result = 'return' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'reason required'; end if;
    update portal_requests set status = 'open', return_note = btrim(p_note) where id = r.id;
    perform app._portal_notify(r.ops_id, 'محتاجين حاجة زيادة', r.title || ' — ' || btrim(p_note), '/portal/tasks?p=' || r.ops_id || '#r-' || r.id, 'reqret:' || r.id || ':' || extract(epoch from now())::bigint);
  elsif p_result = 'cancel' then
    update portal_requests set status = 'cancelled', closed_by = app.me(), closed_at = now() where id = r.id;
  else raise exception 'invalid'; end if;
  perform app._portal_log(r.ops_id, case p_result when 'done' then 'استلام طلب' when 'return' then 'إرجاع طلب للعميل' else 'إلغاء طلب' end, r.title || coalesce(' — ' || nullif(btrim(p_note), ''), ''));
end $$;

-- a staff reply in a client-visible thread (ticket, update, shown task, request)
create or replace function app._portal_thread_ops(p_kind text, p_id uuid) returns uuid language sql stable security definer set search_path = public, app as $$
  select case p_kind
    when 'ticket' then (select ops_id from portal_tickets where id = p_id)
    when 'update' then (select ops_id from project_updates where id = p_id)
    when 'request' then (select ops_id from portal_requests where id = p_id)
    when 'task' then (select t.ops_id from tasks t where t.id = p_id and (t.client_visible or (t.needs_client and t.status in ('client_review','approved'))))
  end
$$;
create or replace function app.portal_staff_message(p_kind text, p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_ops uuid := app._portal_thread_ops(p_kind, p_id); v_id uuid;
begin
  if v_ops is null or not app._portal_staff(v_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'reply text required'; end if;
  insert into portal_messages(ops_id, thread_kind, thread_id, body, author_employee) values (v_ops, p_kind, p_id, btrim(p_body), app.me()) returning id into v_id;
  if p_kind = 'ticket' then update portal_tickets set status = 'answered', last_activity_at = now() where id = p_id and status <> 'closed'; end if;
  perform app._portal_log(v_ops, 'رد على العميل', left(btrim(p_body), 200));
  perform app._portal_notify(v_ops, case p_kind when 'ticket' then 'رد على طلب الدعم بتاعك' else 'رد جديد من فريقنا' end, left(btrim(p_body), 200),
    case p_kind when 'ticket' then '/portal/support/' || p_id when 'request' then '/portal/tasks?p=' || v_ops || '#r-' || p_id when 'task' then '/portal/approvals?p=' || v_ops || '#t-' || p_id else '/portal/project?p=' || v_ops || '#u-' || p_id end,
    'msg:' || v_id);
  return v_id;
end $$;

create or replace function app.portal_ticket_close(p_ticket uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare t portal_tickets;
begin
  select * into t from portal_tickets where id = p_ticket for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if not (app._portal_staff(t.ops_id) or (app.portal_me() is not null and app._portal_mine(t.ops_id))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'closed' then return; end if;
  update portal_tickets set status = 'closed', closed_at = now(), closed_by = case when app.me() is not null then 'staff' else 'client' end, last_activity_at = now() where id = t.id;
  perform app._portal_log(t.ops_id, 'قفل طلب دعم', t.subject);
  if app.me() is not null then
    perform app._portal_notify(t.ops_id, 'طلب الدعم اتقفل', t.subject, '/portal/support/' || t.id, 'tkclose:' || t.id);
  end if;
end $$;

create or replace function app.portal_staff_file_add(p_ops uuid, p_filename text, p_mime text, p_content bytea, p_visible boolean, p_kind text, p_thread uuid) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app._portal_staff(p_ops) or not exists (select 1 from portal_projects where ops_id = p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind is not null and app._portal_thread_ops(p_kind, p_thread) is distinct from p_ops then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into portal_files(ops_id, thread_kind, thread_id, filename, mime_type, size_bytes, content, visible_to_client, uploaded_by_employee)
  values (p_ops, p_kind, p_thread, left(p_filename, 200), p_mime, length(p_content), p_content, coalesce(p_visible, false), app.me()) returning id into v_id;
  perform app._portal_log(p_ops, 'رفع ملف' || case when p_visible then ' (يظهر للعميل)' else ' (داخلي)' end, p_filename);
  if p_visible then perform app._portal_notify(p_ops, 'ملف جديد على مشروعك', p_filename, '/portal/documents?p=' || p_ops, 'file:' || v_id); end if;
  return v_id;
end $$;

create or replace function app.portal_file_visibility(p_file uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare f record;
begin
  select id, ops_id, filename, uploaded_by_account into f from portal_files where id = p_file;
  if f.id is null or not app._portal_staff(f.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if f.uploaded_by_account is not null then raise exception 'not allowed' using errcode = '42501'; end if;   -- the client's own files are always his
  update portal_files set visible_to_client = p_visible where id = p_file;
  perform app._portal_log(f.ops_id, case when p_visible then 'إظهار ملف للعميل' else 'إخفاء ملف عن العميل' end, f.filename);
  if p_visible then perform app._portal_notify(f.ops_id, 'ملف جديد على مشروعك', f.filename, '/portal/documents?p=' || f.ops_id, 'file:' || f.id); end if;
end $$;

-- share a task's file (delivery) with the client: a copy goes to the project's files, shown to him
create or replace function app.portal_share_task_file(p_attachment uuid) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare a attachments; t tasks; v_id uuid;
begin
  select * into a from attachments where id = p_attachment and entity_type = 'task';
  if not found then raise exception 'not found'; end if;
  select * into t from tasks where id = a.entity_id;
  if not app._portal_staff(t.ops_id) or not exists (select 1 from portal_projects where ops_id = t.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into portal_files(ops_id, thread_kind, thread_id, filename, mime_type, size_bytes, content, visible_to_client, uploaded_by_employee)
  select t.ops_id, 'task', t.id, a.filename, coalesce(a.mime_type, 'application/octet-stream'), length(b.content), b.content, true, app.me()
    from attachment_blobs b where b.attachment_id = a.id returning id into v_id;
  if v_id is null then raise exception 'not found'; end if;
  perform app._portal_log(t.ops_id, 'مشاركة ملف تاسك مع العميل', a.filename);
  perform app._portal_notify(t.ops_id, 'ملف جديد على مشروعك', a.filename, '/portal/documents?p=' || t.ops_id, 'file:' || v_id);
  return v_id;
end $$;

-- what the client sees of a task: shown or not, its stage, and a note written for him
create or replace function app.portal_task_set(p_task uuid, p_visible boolean, p_stage uuid, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found or not app._portal_staff(t.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_stage is not null and not exists (select 1 from project_stages where id = p_stage and ops_id = t.ops_id) then raise exception 'invalid stage'; end if;
  update tasks set client_visible = coalesce(p_visible, false), portal_stage_id = p_stage, client_note = nullif(btrim(p_note), ''), updated_at = now() where id = t.id;
  perform app._portal_log(t.ops_id, case when p_visible then 'التاسك يظهر للعميل' else 'التاسك داخلي' end, t.title);
end $$;

create or replace function app.portal_stage_defaults_list() returns table(id uuid, name text, sort int, is_active boolean)
language sql stable security definer set search_path = public, app as $$
  select d.id, d.name, d.sort, d.is_active from portal_stage_defaults d where app.is_super() or app.role_code() = 'operations_manager' order by d.sort, d.created_at
$$;
create or replace function app.portal_stage_default_save(p_id uuid, p_name text, p_sort int, p_active boolean) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not (app.is_super() or app.role_code() = 'operations_manager') then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'title required'; end if;
  if p_id is null then insert into portal_stage_defaults(name, sort, is_active) values (btrim(p_name), coalesce(p_sort, 99), coalesce(p_active, true));
  else update portal_stage_defaults set name = btrim(p_name), sort = coalesce(p_sort, sort), is_active = coalesce(p_active, is_active) where id = p_id; end if;
end $$;

-- ───────── shared read helpers (only ever called from functions that already checked access) ─────────
create or replace function app._portal_thread(p_kind text, p_id uuid) returns jsonb language sql stable security definer set search_path = public, app as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'at', m.created_at, 'from_client', m.author_account is not null,
           'by', case when m.author_account is not null then 'أنت' else coalesce(app.emp_name(m.author_employee), 'فريق غامر') end) order by m.created_at), '[]')
    from portal_messages m where m.thread_kind = p_kind and m.thread_id = p_id
$$;
create or replace function app._portal_thread_files(p_kind text, p_id uuid) returns jsonb language sql stable security definer set search_path = public, app as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'filename', f.filename, 'size_bytes', f.size_bytes, 'from_client', f.uploaded_by_account is not null, 'at', f.created_at) order by f.created_at), '[]')
    from portal_files f where f.thread_kind = p_kind and f.thread_id = p_id and (f.visible_to_client or f.uploaded_by_account is not null or app.me() is not null)
$$;

-- the client's view of a task: nothing internal (no employee, time, comments, internal notes)
create or replace function app._portal_task_json(t tasks) returns jsonb language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object('id', t.id, 'title', t.title,
    'state', case when t.status = 'approved' then 'done' when t.status = 'client_review' then 'your_review' when t.status in ('submitted') then 'internal_review'
                  when t.status in ('in_progress','changes_requested') then 'working' when t.status = 'paused' then 'working' else 'planned' end,
    'due_date', t.due_date, 'stage', (select s.name from project_stages s where s.id = t.portal_stage_id), 'note', t.client_note,
    'needs_you', t.status = 'client_review',
    'link', case when t.status in ('client_review','approved') then t.delivery_link end,
    'decided_at', t.client_decided_at,
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'filename', f.filename, 'size_bytes', f.size_bytes)), '[]') from portal_files f where f.thread_kind = 'task' and f.thread_id = t.id and f.visible_to_client),
    'messages', app._portal_thread('task', t.id))
$$;

-- everything the staff screen of one project needs
create or replace function app.portal_staff_get(p_ops uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'ops_id', o.id, 'client_name', coalesce(nullif(cl.business_name, ''), cl.name), 'account_manager_id', o.account_manager_id,
    'can_manage', app._portal_staff(o.id), 'is_super', app.is_super(), 'can_toggle', app.is_super() or app.role_code() = 'operations_manager',
    'contract_approved', ct.status = 'approved', 'contract_start', ct.start_date, 'contract_end', ct.end_date,
    'client_phone', (select ci.value from client_identifiers ci where ci.client_id = cl.id and ci.kind = 'phone' order by ci.value limit 1),
    'project', (select to_jsonb(p) || jsonb_build_object('enabled_by_name', app.emp_name(p.enabled_by)) from portal_projects p where p.ops_id = o.id),
    'account', (select jsonb_build_object('phone', a.phone, 'is_active', a.is_active, 'must_change_password', a.must_change_password, 'last_login_at', a.last_login_at, 'created_at', a.created_at,
                                          'locked', a.locked_until > now()) from portal_accounts a where a.client_id = cl.id),
    'progress', app._portal_progress(o.id),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'sort', s.sort, 'status', s.status, 'planned_date', s.planned_date, 'started_at', s.started_at, 'done_at', s.done_at,
                   'tasks', (select count(*) from tasks t where t.portal_stage_id = s.id and t.status <> 'cancelled'), 'tasks_done', (select count(*) from tasks t where t.portal_stage_id = s.id and t.status = 'approved')) order by s.sort), '[]') from project_stages s where s.ops_id = o.id),
    'updates', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'title', u.title, 'body', u.body, 'auto', u.auto, 'by', app.emp_name(u.created_by), 'at', u.created_at,
                   'messages', app._portal_thread('update', u.id)) order by u.created_at desc), '[]') from (select * from project_updates where ops_id = o.id order by created_at desc limit 50) u),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'description', r.description, 'due_date', r.due_date, 'status', r.status, 'response', r.response, 'responded_at', r.responded_at,
                   'return_note', r.return_note, 'by', app.emp_name(r.created_by), 'at', r.created_at, 'closed_by', app.emp_name(r.closed_by), 'closed_at', r.closed_at,
                   'files', app._portal_thread_files('request', r.id), 'messages', app._portal_thread('request', r.id)) order by (r.status in ('done','cancelled')), r.created_at desc), '[]') from portal_requests r where r.ops_id = o.id),
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'status', t.status, 'at', t.created_at, 'last', t.last_activity_at, 'closed_by', t.closed_by,
                   'files', app._portal_thread_files('ticket', t.id), 'messages', app._portal_thread('ticket', t.id)) order by (t.status = 'closed'), t.last_activity_at desc), '[]') from portal_tickets t where t.ops_id = o.id),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date, 'client_visible', t.client_visible, 'needs_client', t.needs_client,
                   'stage_id', t.portal_stage_id, 'client_note', t.client_note, 'assignee', app.emp_name(t.assignee_id), 'client_decided_at', t.client_decided_at,
                   'decided_in_portal', t.client_decided_by_account is not null,
                   'messages', app._portal_thread('task', t.id),
                   'files', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'filename', a.filename, 'shared', exists (select 1 from portal_files pf where pf.thread_kind = 'task' and pf.thread_id = t.id and pf.filename = a.filename))), '[]')
                               from attachments a where a.entity_type = 'task' and a.entity_id = t.id)) order by t.created_at desc), '[]') from tasks t where t.ops_id = o.id and t.status <> 'cancelled'),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'filename', f.filename, 'size_bytes', f.size_bytes, 'visible', f.visible_to_client, 'thread_kind', f.thread_kind,
                   'by', coalesce(app.emp_name(f.uploaded_by_employee), 'العميل'), 'from_client', f.uploaded_by_account is not null, 'at', f.created_at) order by f.created_at desc), '[]') from portal_files f where f.ops_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'detail', e.detail, 'by', coalesce(app.emp_name(e.actor_employee), case when e.actor_account is not null then 'العميل' end)) order by e.at desc), '[]')
                 from (select * from portal_events where ops_id = o.id order by at desc limit 200) e))
  from client_operations o join clients cl on cl.id = o.client_id join contracts ct on ct.id = o.contract_id
  where o.id = p_ops and app._portal_staff_view(o.id)
$$;

-- ───────── client side (app.portal_me) ─────────
create or replace function app.portal_projects() returns table(ops_id uuid, title text, progress int, stage text)
language sql stable security definer set search_path = public, app as $$
  select p.ops_id, p.title, app._portal_progress(p.ops_id), (select s.name from project_stages s where s.ops_id = p.ops_id and s.status = 'current')
    from portal_projects p join client_operations o on o.id = p.ops_id where o.client_id = app._portal_client() order by p.enabled_at
$$;

create or replace function app.portal_project_get(p_ops uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'ops_id', o.id, 'title', p.title, 'client_name', coalesce(nullif(cl.business_name, ''), cl.name),
    'services', (select coalesce(jsonb_agg(sv.name_ar order by cs.sort), '[]') from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = o.contract_id),
    'start_date', coalesce(p.start_date, ct.start_date), 'expected_end', coalesce(p.expected_end, ct.end_date),
    'account_manager', app.emp_name(o.account_manager_id),
    'progress', app._portal_progress(o.id),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'planned_date', s.planned_date, 'started_at', s.started_at, 'done_at', s.done_at,
                   'tasks', (select count(*) from tasks t where t.portal_stage_id = s.id and t.status <> 'cancelled'), 'tasks_done', (select count(*) from tasks t where t.portal_stage_id = s.id and t.status = 'approved')) order by s.sort), '[]') from project_stages s where s.ops_id = o.id),
    'updates', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'title', u.title, 'body', u.body, 'auto', u.auto, 'by', coalesce(app.emp_name(u.created_by), 'فريق غامر'), 'at', u.created_at,
                   'stage', (select s.name from project_stages s where s.id = u.stage_id), 'messages', app._portal_thread('update', u.id)) order by u.created_at desc), '[]')
                 from (select * from project_updates where ops_id = o.id order by created_at desc limit 100) u),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'description', r.description, 'due_date', r.due_date, 'status', r.status, 'response', r.response,
                   'responded_at', r.responded_at, 'return_note', r.return_note, 'at', r.created_at, 'closed_at', r.closed_at,
                   'files', app._portal_thread_files('request', r.id), 'messages', app._portal_thread('request', r.id)) order by (r.status in ('done','cancelled')), r.due_date nulls last, r.created_at desc), '[]')
                 from portal_requests r where r.ops_id = o.id and r.status <> 'cancelled'),
    'tasks', (select coalesce(jsonb_agg(app._portal_task_json(t) order by t.due_date nulls last, t.created_at), '[]')
                from tasks t where t.ops_id = o.id and t.status <> 'cancelled' and (t.client_visible or (t.needs_client and t.status in ('client_review','approved')))),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'filename', f.filename, 'size_bytes', f.size_bytes, 'mime_type', f.mime_type, 'from_client', f.uploaded_by_account is not null,
                   'by', case when f.uploaded_by_account is not null then 'أنت' else coalesce(app.emp_name(f.uploaded_by_employee), 'فريق غامر') end, 'at', f.created_at, 'thread_kind', f.thread_kind) order by f.created_at desc), '[]')
                from portal_files f where f.ops_id = o.id and (f.visible_to_client or f.uploaded_by_account is not null)))
  from client_operations o join portal_projects p on p.ops_id = o.id join clients cl on cl.id = o.client_id join contracts ct on ct.id = o.contract_id
  where o.id = p_ops and app._portal_mine(o.id)
$$;

create or replace function app.portal_request_respond(p_request uuid, p_text text) returns void
language plpgsql security definer set search_path = public, app as $$
declare r portal_requests;
begin
  select * into r from portal_requests where id = p_request for update;
  if not found or not app._portal_mine(r.ops_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.status in ('done','cancelled') then raise exception 'request is closed'; end if;
  if coalesce(btrim(p_text), '') = '' and not exists (select 1 from portal_files f where f.thread_kind = 'request' and f.thread_id = r.id and f.uploaded_by_account is not null) then
    raise exception 'reply text required'; end if;
  perform set_config('app.reason', 'بوابة العميل: رد على طلب', true);
  update portal_requests set status = 'submitted', response = coalesce(nullif(btrim(p_text), ''), response), responded_at = now(), return_note = null where id = r.id;
  perform app._portal_log(r.ops_id, 'العميل رد على طلب', r.title);
  perform app._portal_tell_staff(r.ops_id, 'العميل رد على طلب: ' || r.title, left(coalesce(btrim(p_text), 'رفع ملف'), 200), 'preq:' || r.id || ':' || extract(epoch from now())::bigint);
end $$;

-- the client approves the work or asks for changes (with the reason) — the same result as when his Account Manager records it
create or replace function app.portal_task_decide(p_task uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations;
begin
  select * into t from tasks where id = p_task for update;
  if not found or not app._portal_mine(t.ops_id) or not (t.client_visible or t.needs_client) then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status <> 'client_review' then raise exception 'task is not waiting for the client'; end if;
  if not p_ok and coalesce(btrim(p_note), '') = '' then raise exception 'reason required'; end if;
  select * into o from client_operations where id = t.ops_id;
  perform set_config('app.reason', 'بوابة العميل: ' || case when p_ok then 'موافقة' else 'طلب تعديل' end, true);
  update tasks set status = case when p_ok then 'approved' else 'changes_requested' end, client_decided_at = now(), client_decided_by_account = app.portal_me(),
         review_note = case when p_ok then review_note else 'العميل طلب تعديل (من البوابة): ' || btrim(p_note) end,
         revisions = revisions + case when p_ok then 0 else 1 end, updated_at = now() where id = t.id;
  if coalesce(btrim(p_note), '') <> '' then
    insert into portal_messages(ops_id, thread_kind, thread_id, body, author_account) values (t.ops_id, 'task', t.id, btrim(p_note), app.portal_me());
  end if;
  perform app._notify(t.assignee_id, case when p_ok then 'task_approved' else 'task_changes' end,
    case when p_ok then 'العميل وافق من البوابة — التاسك اتعمد ✓' else 'العميل طلب تعديل من البوابة' end, t.title || coalesce(' — ' || nullif(btrim(p_note), ''), ''), '/tasks/' || t.id,
    'taskpc:' || t.id || ':' || p_ok || ':' || t.revisions);
  perform app._portal_tell_staff(t.ops_id, case when p_ok then 'العميل وافق: ' else 'العميل طلب تعديل: ' end || t.title, coalesce(nullif(btrim(p_note), ''), 'من البوابة'), 'ptask:' || t.id || ':' || t.revisions);
  perform app._portal_log(t.ops_id, case when p_ok then 'العميل وافق على الشغل' else 'العميل طلب تعديل' end, t.title || coalesce(' — ' || nullif(btrim(p_note), ''), ''));
end $$;

-- the client writes in a thread he can see (a comment on an update, a shown task, a request, or his ticket)
create or replace function app.portal_client_message(p_kind text, p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_ops uuid := app._portal_thread_ops(p_kind, p_id); v_id uuid; v_title text;
begin
  if v_ops is null or not app._portal_mine(v_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'reply text required'; end if;
  if p_kind = 'ticket' and (select status from portal_tickets where id = p_id) = 'closed' then raise exception 'ticket is closed'; end if;
  perform set_config('app.reason', 'بوابة العميل: تعليق', true);
  insert into portal_messages(ops_id, thread_kind, thread_id, body, author_account) values (v_ops, p_kind, p_id, btrim(p_body), app.portal_me()) returning id into v_id;
  if p_kind = 'ticket' then update portal_tickets set status = 'open', last_activity_at = now() where id = p_id; end if;
  v_title := case p_kind when 'ticket' then (select subject from portal_tickets where id = p_id) when 'update' then (select title from project_updates where id = p_id)
                         when 'request' then (select title from portal_requests where id = p_id) else (select title from tasks where id = p_id) end;
  perform app._portal_log(v_ops, 'العميل كتب', v_title || ' — ' || left(btrim(p_body), 200));
  perform app._portal_tell_staff(v_ops, 'رسالة من العميل: ' || v_title, left(btrim(p_body), 200), 'pmsg:' || v_id);
  return v_id;
end $$;

create or replace function app.portal_ticket_open(p_ops uuid, p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app._portal_mine(p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_subject, ''))) < 2 then raise exception 'title required'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'reply text required'; end if;
  perform set_config('app.reason', 'بوابة العميل: طلب دعم', true);
  insert into portal_tickets(ops_id, subject, created_by_account) values (p_ops, btrim(p_subject), app.portal_me()) returning id into v_id;
  insert into portal_messages(ops_id, thread_kind, thread_id, body, author_account) values (p_ops, 'ticket', v_id, btrim(p_body), app.portal_me());
  perform app._portal_log(p_ops, 'العميل فتح طلب دعم', btrim(p_subject));
  perform app._portal_tell_staff(p_ops, 'طلب دعم جديد من العميل', btrim(p_subject), 'ptk:' || v_id);
  return v_id;
end $$;

create or replace function app.portal_tickets() returns table(id uuid, ops_id uuid, project text, subject text, status text, created_at timestamptz, last_activity_at timestamptz, messages int)
language sql stable security definer set search_path = public, app as $$
  select t.id, t.ops_id, p.title, t.subject, t.status, t.created_at, t.last_activity_at, (select count(*)::int from portal_messages m where m.thread_kind = 'ticket' and m.thread_id = t.id)
    from portal_tickets t join portal_projects p on p.ops_id = t.ops_id where app._portal_mine(t.ops_id) order by (t.status = 'closed'), t.last_activity_at desc
$$;
create or replace function app.portal_ticket_get(p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object('id', t.id, 'ops_id', t.ops_id, 'subject', t.subject, 'status', t.status, 'created_at', t.created_at, 'closed_at', t.closed_at,
                            'messages', app._portal_thread('ticket', t.id), 'files', app._portal_thread_files('ticket', t.id))
    from portal_tickets t where t.id = p_ticket and app._portal_mine(t.ops_id)
$$;

create or replace function app.portal_client_file_add(p_ops uuid, p_filename text, p_mime text, p_content bytea, p_kind text, p_thread uuid) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app._portal_mine(p_ops) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind is not null and app._portal_thread_ops(p_kind, p_thread) is distinct from p_ops then raise exception 'not allowed' using errcode = '42501'; end if;
  if (select count(*) from portal_files where uploaded_by_account = app.portal_me() and created_at > now() - interval '1 day') >= 100 then raise exception 'too many files today'; end if;
  perform set_config('app.reason', 'بوابة العميل: رفع ملف', true);
  insert into portal_files(ops_id, thread_kind, thread_id, filename, mime_type, size_bytes, content, visible_to_client, uploaded_by_account)
  values (p_ops, p_kind, p_thread, left(p_filename, 200), p_mime, length(p_content), p_content, true, app.portal_me()) returning id into v_id;
  perform app._portal_log(p_ops, 'العميل رفع ملف', p_filename);
  perform app._portal_tell_staff(p_ops, 'العميل رفع ملف', p_filename, 'pfile:' || v_id);
  return v_id;
end $$;

-- one file, for whoever may have it: the client (shown to him, or his own) or the staff of the project
create or replace function app.portal_file_get(p_file uuid) returns table(filename text, mime_type text, content bytea)
language sql stable security definer set search_path = public, app as $$
  select f.filename, f.mime_type, f.content from portal_files f
   where f.id = p_file and ((app.portal_me() is not null and app._portal_mine(f.ops_id) and (f.visible_to_client or f.uploaded_by_account = app.portal_me()))
                            or (app.me() is not null and app._portal_staff_view(f.ops_id)))
$$;

create or replace function app.portal_notifications() returns table(id uuid, ops_id uuid, title text, body text, link text, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select n.id, n.ops_id, n.title, n.body, n.link, n.created_at, n.read_at from portal_notifications n where n.account_id = app.portal_me() order by n.created_at desc limit 100
$$;
create or replace function app.portal_notifications_read(p_id uuid) returns void language sql security definer set search_path = public, app as $$
  update portal_notifications set read_at = now() where account_id = app.portal_me() and read_at is null and (p_id is null or id = p_id)
$$;

create or replace function app.portal_profile() returns jsonb language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object('client_name', coalesce(nullif(c.business_name, ''), c.name), 'contact_name', c.name, 'phone', a.phone, 'last_login_at', a.last_login_at, 'created_at', a.created_at,
                            'account_manager', (select app.emp_name(o.account_manager_id) from client_operations o join portal_projects p on p.ops_id = o.id where o.client_id = c.id order by p.enabled_at limit 1))
    from portal_accounts a join clients c on c.id = a.client_id where a.id = app.portal_me()
$$;

-- ───────── tasks reaching the client on their own ─────────
-- when a task is sent to the client for review, or a shown task is done, the client is told (no extra step for the staff)
create or replace function app._portal_task_events() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from portal_projects where ops_id = NEW.ops_id) then return NEW; end if;
  if NEW.status = 'client_review' and OLD.status is distinct from 'client_review' and (NEW.client_visible or NEW.needs_client) then
    perform app._portal_notify(NEW.ops_id, 'شغل مستني موافقتك', NEW.title, '/portal/approvals?p=' || NEW.ops_id || '#t-' || NEW.id, 'appr:' || NEW.id || ':' || NEW.revisions);
    insert into portal_events(ops_id, actor_employee, action, detail) values (NEW.ops_id, app.me(), 'عرض شغل على العميل', NEW.title);
  elsif NEW.status = 'approved' and OLD.status is distinct from 'approved' and NEW.client_visible then
    perform app._portal_notify(NEW.ops_id, 'خلصنا: ' || NEW.title, coalesce(NEW.client_note, ''), '/portal/project?p=' || NEW.ops_id, 'tdone:' || NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists portal_task_events on tasks;
create trigger portal_task_events after update of status on tasks for each row execute function app._portal_task_events();

-- ───────── privileges ─────────
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
