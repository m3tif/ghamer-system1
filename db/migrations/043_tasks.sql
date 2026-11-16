-- 043: Phase 3 step 2 — tasks, delivery & review, time tracking.
-- The Account Manager (or Technical Manager) writes tasks for a client and gives each to a technical employee.
-- The employee runs a timer (one at a time), delivers with a link, and the task goes to review: approved, or sent back with a reason.
begin;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  title text not null check (length(btrim(title)) between 2 and 200),
  description text check (length(description) <= 4000),
  service_code text references services(code),
  assignee_id uuid not null references employees(id),
  created_by uuid not null references employees(id),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  start_date date,
  due_date date,
  estimated_hours numeric(6,2) check (estimated_hours > 0 and estimated_hours <= 1000),
  status text not null default 'todo' check (status in ('todo','in_progress','paused','submitted','changes_requested','approved')),
  delivery_link text check (length(delivery_link) <= 1000),
  delivery_note text check (length(delivery_note) <= 2000),
  submitted_at timestamptz,
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 2000),
  revisions int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_ops on tasks(ops_id);
create index if not exists tasks_assignee on tasks(assignee_id, status);

-- every work period is its own row and is never deleted
create table if not exists task_time_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  employee_id uuid not null references employees(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  manual boolean not null default false,
  reason text check (length(reason) <= 500),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists task_time_logs_task on task_time_logs(task_id);
create unique index if not exists task_time_logs_one_running on task_time_logs(employee_id) where ended_at is null;   -- one running timer per employee

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  author_id uuid not null references employees(id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task on task_comments(task_id);

alter table tasks enable row level security;
alter table task_time_logs enable row level security;
alter table task_comments enable row level security;
revoke all on tasks, task_time_logs, task_comments from ghamer_app;          -- only through the functions below
drop trigger if exists audit_tasks on tasks;
create trigger audit_tasks after insert or update or delete on tasks for each row execute function app.audit_row('updated_at');
drop trigger if exists audit_task_time_logs on task_time_logs;
create trigger audit_task_time_logs after insert or update or delete on task_time_logs for each row execute function app.audit_row();

create or replace function app._task_can_manage(p_am uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce(app.has_perm('tasks.manage') and (app.is_super() or app.role_code() = 'operations_manager' or p_am = app.me()), false)
$$;
create or replace function app._task_visible(p_am uuid, p_assignee uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and (app.is_admin() or app.role_code() = 'operations_manager' or p_am = app.me() or p_assignee = app.me())
$$;
create or replace function app._tech_role(p_emp uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_emp and u.is_active
     and r.code in ('seo_specialist','ui_designer','developer','designer','content_creator','media_buyer','technical_employee','technical_team_leader'))
$$;
create or replace function app._today() returns date
language sql stable security definer set search_path = public, app as $$ select (now() at time zone app.company_tz())::date $$;

-- who can be given a task (with how much they already have open)
create or replace function app.task_assignees()
returns table(id uuid, full_name text, role_name text, open_tasks int)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, r.name_ar, (select count(*)::int from tasks t where t.assignee_id = e.id and t.status <> 'approved')
    from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
   where app.has_perm('tasks.manage') and app._tech_role(e.id)
   order by r.name_ar, e.full_name
$$;

-- create (p_task null) or edit a task
create or replace function app.task_save(p_ops uuid, p_task uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare o client_operations; t tasks; v_id uuid; v_as uuid := nullif(p->>'assignee','')::uuid; v_title text := btrim(coalesce(p->>'title',''));
        v_start date := nullif(p->>'start_date','')::date; v_due date := nullif(p->>'due_date','')::date; v_est numeric := nullif(p->>'estimated_hours','')::numeric;
        v_svc text := nullif(p->>'service',''); v_pri text := coalesce(nullif(p->>'priority',''), 'normal'); v_client text;
begin
  select * into o from client_operations where id = p_ops;
  if not found or not app._task_can_manage(o.account_manager_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(v_title) < 2 then raise exception 'task title required'; end if;
  if v_as is null or not app._tech_role(v_as) then raise exception 'invalid assignee'; end if;
  if v_start is not null and v_due is not null and v_due < v_start then raise exception 'due date is before start date'; end if;
  if v_svc is not null and not exists (select 1 from services s where s.code = v_svc) then raise exception 'invalid service'; end if;
  select cl.name into v_client from clients cl where cl.id = o.client_id;
  if p_task is null then
    insert into tasks(ops_id, title, description, service_code, assignee_id, created_by, priority, start_date, due_date, estimated_hours)
    values (o.id, v_title, nullif(btrim(p->>'description'),''), v_svc, v_as, app.me(), v_pri, v_start, v_due, v_est) returning id into v_id;
    perform app._notify(v_as, 'task_new', 'تاسك جديد', v_title || ' — ' || v_client, '/tasks/' || v_id, 'tasknew:' || v_id || ':' || v_as);
  else
    select * into t from tasks where id = p_task and ops_id = p_ops for update;
    if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
    if t.status = 'approved' then raise exception 'task is closed'; end if;
    v_id := t.id;
    if t.assignee_id <> v_as then                                   -- moved to someone else: stop the old timer, tell the new person
      update task_time_logs set ended_at = now() where task_id = t.id and ended_at is null;
      perform app._notify(v_as, 'task_new', 'تاسك جديد', v_title || ' — ' || v_client, '/tasks/' || v_id, 'tasknew:' || v_id || ':' || v_as);
    end if;
    update tasks set title = v_title, description = nullif(btrim(p->>'description'),''), service_code = v_svc, assignee_id = v_as, priority = v_pri,
           start_date = v_start, due_date = v_due, estimated_hours = v_est,
           status = case when t.assignee_id <> v_as and t.status in ('in_progress','paused') then 'todo' else t.status end, updated_at = now() where id = t.id;
  end if;
  return v_id;
end $$;

-- timer: start / resume (stops any other task I have running)
create or replace function app.task_start(p_task uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found or t.assignee_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status in ('submitted','approved') then raise exception 'task cannot be started now'; end if;
  if exists (select 1 from task_time_logs l where l.task_id = t.id and l.employee_id = app.me() and l.ended_at is null) then return; end if;
  update tasks set status = 'paused', updated_at = now()
   where status = 'in_progress' and id in (select l.task_id from task_time_logs l where l.employee_id = app.me() and l.ended_at is null);
  update task_time_logs set ended_at = now() where employee_id = app.me() and ended_at is null;
  insert into task_time_logs(task_id, employee_id) values (t.id, app.me());
  update tasks set status = 'in_progress', updated_at = now() where id = t.id;
end $$;

create or replace function app.task_pause(p_task uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found or t.assignee_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  update task_time_logs set ended_at = now() where task_id = t.id and employee_id = app.me() and ended_at is null;
  if t.status = 'in_progress' then update tasks set status = 'paused', updated_at = now() where id = t.id; end if;
end $$;

-- time added by hand needs a reason
create or replace function app.task_add_time(p_task uuid, p_minutes int, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found or t.assignee_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'approved' then raise exception 'task is closed'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 720 then raise exception 'invalid minutes'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  insert into task_time_logs(task_id, employee_id, started_at, ended_at, manual, reason)
  values (t.id, app.me(), now() - make_interval(mins => p_minutes), now(), true, btrim(p_reason));
end $$;

-- deliver: a link is required; the task goes to review
create or replace function app.task_submit(p_task uuid, p_link text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations; v_link text := btrim(coalesce(p_link,'')); u uuid;
begin
  select * into t from tasks where id = p_task for update;
  if not found or t.assignee_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'submitted' then return; end if;                      -- pressed twice
  if t.status = 'approved' then raise exception 'task is closed'; end if;
  if v_link !~* '^https?://[^\s]+$' then raise exception 'delivery link required'; end if;
  update task_time_logs set ended_at = now() where task_id = t.id and ended_at is null;
  update tasks set status = 'submitted', delivery_link = v_link, delivery_note = nullif(btrim(p_note),''), submitted_at = now(), updated_at = now() where id = t.id;
  select * into o from client_operations where id = t.ops_id;
  for u in select distinct x from unnest(array[o.account_manager_id, t.created_by]) x where x is not null and x <> app.me() loop
    perform app._notify(u, 'task_submitted', 'تاسك اتسلّم ومحتاج مراجعة', t.title || ' — ' || app.emp_name(t.assignee_id), '/tasks/' || t.id, 'tasksub:' || t.id || ':' || t.revisions);
  end loop;
end $$;

-- review: approve, or send back with a reason. Nobody reviews his own task.
create or replace function app.task_review(p_task uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into o from client_operations where id = t.ops_id;
  if not (app.has_perm('tasks.review') and (app.is_super() or app.role_code() = 'operations_manager' or o.account_manager_id = app.me())) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if t.assignee_id = app.me() then raise exception 'cannot review own task'; end if;
  if t.status = 'approved' and p_ok then return; end if;
  if t.status <> 'submitted' then raise exception 'task is not waiting for review'; end if;
  if not p_ok and coalesce(btrim(p_note),'') = '' then raise exception 'reason required'; end if;
  perform set_config('app.reason', coalesce(nullif(btrim(p_note),''), 'اعتماد التاسك'), true);
  update tasks set status = case when p_ok then 'approved' else 'changes_requested' end, reviewed_by = app.me(), reviewed_at = now(),
         review_note = nullif(btrim(p_note),''), revisions = revisions + case when p_ok then 0 else 1 end, updated_at = now() where id = t.id;
  perform app._notify(t.assignee_id, case when p_ok then 'task_approved' else 'task_changes' end,
    case when p_ok then 'التاسك اتعتمد ✓' else 'مطلوب تعديل على التاسك' end, t.title || coalesce(' — ' || nullif(btrim(p_note),''), ''), '/tasks/' || t.id,
    'taskrev:' || t.id || ':' || p_ok || ':' || t.revisions);
end $$;

create or replace function app.task_comment(p_task uuid, p_body text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations; u uuid;
begin
  select * into t from tasks where id = p_task;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into o from client_operations where id = t.ops_id;
  if not app._task_visible(o.account_manager_id, t.assignee_id) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'comment required'; end if;
  insert into task_comments(task_id, author_id, body) values (t.id, app.me(), btrim(p_body));
  for u in select distinct x from unnest(array[o.account_manager_id, t.assignee_id]) x where x is not null and x <> app.me() loop
    perform app._notify(u, 'task_comment', 'تعليق جديد على تاسك', t.title || ' — ' || left(btrim(p_body), 120), '/tasks/' || t.id, 'taskcom:' || t.id || ':' || extract(epoch from clock_timestamp())::bigint);
  end loop;
end $$;

-- list: p_scope 'mine' = given to me, anything else = everything I may see
create or replace function app.task_list(p_scope text, p_ops uuid)
returns table(id uuid, ops_id uuid, client_name text, title text, service_name text, assignee_id uuid, assignee_name text, role_name text, priority text, status text,
              start_date date, due_date date, estimated_hours numeric, minutes int, running boolean, late boolean, revisions int, created_by_name text,
              account_manager_name text, submitted_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select t.id, t.ops_id, cl.name, t.title, sv.name_ar, t.assignee_id, app.emp_name(t.assignee_id),
         (select r.name_ar from users u join roles r on r.id = u.role_id where u.id = t.assignee_id), t.priority, t.status, t.start_date, t.due_date, t.estimated_hours,
         coalesce((select round(sum(extract(epoch from coalesce(l.ended_at, now()) - l.started_at)) / 60) from task_time_logs l where l.task_id = t.id), 0)::int,
         exists (select 1 from task_time_logs l where l.task_id = t.id and l.ended_at is null),
         (t.due_date is not null and t.due_date < app._today() and t.status <> 'approved'), t.revisions, app.emp_name(t.created_by),
         app.emp_name(o.account_manager_id), t.submitted_at, t.created_at
    from tasks t join client_operations o on o.id = t.ops_id join clients cl on cl.id = o.client_id left join services sv on sv.code = t.service_code
   where app._task_visible(o.account_manager_id, t.assignee_id)
     and (p_scope is distinct from 'mine' or t.assignee_id = app.me())
     and (p_ops is null or t.ops_id = p_ops)
   order by case t.status when 'submitted' then 0 when 'changes_requested' then 1 when 'in_progress' then 2 when 'paused' then 3 when 'todo' then 4 else 9 end,
            t.due_date nulls last, t.created_at desc
   limit 1000
$$;

create or replace function app.task_get(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select to_jsonb(t) || jsonb_build_object(
      'client_name', cl.name, 'business_name', cl.business_name,
      'store_url', (select s.url_raw from client_stores s where s.client_id = cl.id order by s.created_at limit 1),
      'service_name', (select sv.name_ar from services sv where sv.code = t.service_code),
      'assignee_name', app.emp_name(t.assignee_id), 'created_by_name', app.emp_name(t.created_by), 'reviewed_by_name', app.emp_name(t.reviewed_by),
      'account_manager_name', app.emp_name(o.account_manager_id),
      'late', (t.due_date is not null and t.due_date < app._today() and t.status <> 'approved'),
      'is_assignee', t.assignee_id = app.me(),
      'can_manage', app._task_can_manage(o.account_manager_id),
      'can_review', coalesce(app.has_perm('tasks.review') and (app.is_super() or app.role_code() = 'operations_manager' or o.account_manager_id = app.me()) and t.assignee_id <> app.me(), false),
      'minutes', coalesce((select round(sum(extract(epoch from coalesce(l.ended_at, now()) - l.started_at)) / 60) from task_time_logs l where l.task_id = t.id), 0)::int,
      'running_since', (select l.started_at from task_time_logs l where l.task_id = t.id and l.ended_at is null limit 1),
      'logs', (select coalesce(jsonb_agg(jsonb_build_object('started_at', l.started_at, 'ended_at', l.ended_at, 'manual', l.manual, 'reason', l.reason, 'by', app.emp_name(l.employee_id),
                 'minutes', round(extract(epoch from coalesce(l.ended_at, now()) - l.started_at) / 60)::int) order by l.started_at desc), '[]') from task_time_logs l where l.task_id = t.id),
      'comments', (select coalesce(jsonb_agg(jsonb_build_object('by', app.emp_name(c.author_id), 'body', c.body, 'at', c.created_at) order by c.created_at), '[]') from task_comments c where c.task_id = t.id))
    from tasks t join client_operations o on o.id = t.ops_id join clients cl on cl.id = o.client_id
   where t.id = p_id and app._task_visible(o.account_manager_id, t.assignee_id)
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

commit;
