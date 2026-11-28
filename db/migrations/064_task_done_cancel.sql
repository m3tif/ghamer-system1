-- 064: «تمت» and «إلغاء» on tasks.
-- * The client's Account Manager or the Technical Manager (or the admin) can mark a task done when the work happened
--   but the employee forgot to press anything: it closes as approved, the timer stops, the employee is told.
-- * Whoever sent a task (or the admin) can cancel it with a reason: it leaves everyone's open work, stays on record
--   as «اتلغى» with who, when and why. Nothing is deleted.
begin;
alter table tasks add column if not exists cancelled_at timestamptz, add column if not exists cancelled_by uuid references employees(id),
  add column if not exists cancel_reason text, add column if not exists closed_by_manager boolean not null default false;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'tasks'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table tasks drop constraint %I', c);
  end loop;
end $$;
alter table tasks add constraint tasks_status_check check (status in ('todo','in_progress','paused','submitted','changes_requested','client_review','approved','cancelled'));

-- a cancelled task counts as closed everywhere an approved one does (open work, late, timers, edits, files)
do $$ declare f text; d text; d0 text; begin
  foreach f in array array['admin_attention','client_360','task_add_time','task_assignees','task_attach','task_file_delete','task_get','task_list','task_save','task_start','task_submit','tech_performance'] loop
    select replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = f;
    d0 := d;
    d := replace(d, 't.status <> ''approved''', 't.status not in (''approved'',''cancelled'')');
    d := replace(d, 'from tasks where status <> ''approved''', 'from tasks where status not in (''approved'',''cancelled'')');
    d := replace(d, 'if t.status = ''approved'' then raise exception ''task is closed''', 'if t.status in (''approved'',''cancelled'') then raise exception ''task is closed''');
    d := replace(d, 't.status in (''submitted'',''client_review'',''approved'')', 't.status in (''submitted'',''client_review'',''approved'',''cancelled'')');
    if d = d0 then raise exception 'base changed: %', f; end if;
    execute d;
  end loop;
end $$;

create or replace function app.task_mark_done(p_task uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into o from client_operations where id = t.ops_id;
  if not (app.has_perm('tasks.review') and (app.is_super() or app.role_code() = 'operations_manager' or o.account_manager_id = app.me())) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'approved' then return; end if;
  if t.status = 'cancelled' then raise exception 'task is closed'; end if;
  perform set_config('app.reason', coalesce(nullif(btrim(p_note),''), 'المدير علّم إن التاسك تمت'), true);
  update task_time_logs set ended_at = now() where task_id = t.id and ended_at is null;
  update tasks set status = 'approved', closed_by_manager = true, reviewed_by = app.me(), reviewed_at = now(),
         review_note = coalesce(nullif(btrim(p_note),''), review_note), updated_at = now() where id = t.id;
  if t.assignee_id <> app.me() then
    perform app._notify(t.assignee_id, 'task_approved', 'التاسك اتقفل إنه تمت ✓', t.title || ' — ' || app.emp_name(app.me()) || coalesce(' — ' || nullif(btrim(p_note),''), ''), '/tasks/' || t.id, 'taskdone:' || t.id);
  end if;
end $$;

create or replace function app.task_cancel(p_task uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found or not (app.is_super() or t.created_by = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'cancelled' then return; end if;
  if t.status = 'approved' then raise exception 'task is closed'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  perform set_config('app.reason', 'إلغاء تاسك: ' || btrim(p_reason), true);
  update task_time_logs set ended_at = now() where task_id = t.id and ended_at is null;
  update tasks set status = 'cancelled', cancelled_at = now(), cancelled_by = app.me(), cancel_reason = btrim(p_reason), updated_at = now() where id = t.id;
  if t.assignee_id <> app.me() then
    perform app._notify(t.assignee_id, 'task_cancelled', 'التاسك اتلغى', t.title || ' — ' || btrim(p_reason), '/tasks/' || t.id, 'taskcancel:' || t.id);
  end if;
end $$;

-- the task page needs to know who may mark it done, who may cancel, and who cancelled
do $$ declare d text; d0 text; begin
  select replace(pg_get_functiondef('app.task_get(uuid)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, '''is_assignee'', t.assignee_id = app.me(),', '''is_assignee'', t.assignee_id = app.me(),
      ''can_cancel'', (app.is_super() or t.created_by = app.me()) and t.status not in (''approved'',''cancelled''),
      ''cancelled_by_name'', app.emp_name(t.cancelled_by),
      ''can_mark_done'', coalesce(app.has_perm(''tasks.review'') and (app.is_super() or app.role_code() = ''operations_manager'' or o.account_manager_id = app.me()), false) and t.status not in (''approved'',''cancelled''),');
  if d = d0 then raise exception 'base changed: task_get'; end if;
  execute d;
end $$;

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
