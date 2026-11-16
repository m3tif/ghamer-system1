-- 045: package work steps (from the agency's «full» flow chart), client approval on a task, Social Media Manager role.
-- The Account Manager sees the steps of the client's packages in order and sends each one to the right employee himself.
-- A step that needs the client: after the Account Manager's review it waits for the client; the Account Manager records «وافق» or «طلب تعديل».
begin;

insert into roles(code, name_ar, name_en, department_id, is_manager, mfa_required)
select 'social_media_manager', 'سوشيال ميديا مانجر', 'Social Media Manager', (select id from departments where code = 'technical'), false, false
on conflict (code) do update set name_ar = excluded.name_ar;
insert into role_permissions(role_id, permission_key, scope)
select r.id, p.k, 'own' from roles r cross join (values ('tasks.view_own'), ('time.log')) p(k) where r.code = 'social_media_manager' on conflict do nothing;

create or replace function app._tech_role(p_emp uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_emp and u.is_active
     and r.code in ('seo_specialist','ui_designer','developer','designer','content_creator','media_buyer','social_media_manager','technical_employee','technical_team_leader'))
$$;

alter table task_templates add column if not exists stage text check (length(stage) <= 100);
alter table task_templates add column if not exists role_code text references roles(code);
alter table task_templates add column if not exists needs_client boolean not null default false;
alter table task_templates add column if not exists sort int not null default 0;
alter table tasks add column if not exists template_id uuid references task_templates(id);
alter table tasks add column if not exists needs_client boolean not null default false;
alter table tasks add column if not exists client_decided_at timestamptz;
alter table tasks add column if not exists client_note text check (length(client_note) <= 2000);
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('todo','in_progress','paused','submitted','changes_requested','client_review','approved'));

-- the «full» package steps, as drawn by the agency (only if that package has no steps yet)
insert into task_templates(service_code, stage, title, description, role_code, needs_client, sort)
select 'full_service', x.stage, x.title, x.descr, x.role, x.nc, x.n
from (values
  (1, 'إنشاء وتهيئة', 'اختيار المنصة المناسبة للمتجر', 'السيو يختار المنصة ويبلّغ الأكاونت مانجر، والأكاونت يقولها للعميل. لو العميل وافق السيو يبدأ.', 'seo_specialist', true),
  (2, 'إنشاء وتهيئة', 'اختيار الدومين', 'السيو يختار الدومين ويبعته للأكاونت مانجر، والعميل يشتريه.', 'seo_specialist', true),
  (3, 'إنشاء وتهيئة', 'إنشاء وتهيئة المتجر', 'إنشاء المتجر على المنصة وتهيئته، وبعدها يتسلّم للـ UI.', 'seo_specialist', false),
  (4, 'Branding', 'الهوية البصرية (البراندينج)', 'الديزاينر يجهّز الهوية، وبتوصل للكونتنت كريتور من خلال الأكاونت مانجر.', 'designer', true),
  (5, 'Web', 'تصميم واجهة المتجر (UI)', 'الـ UI يصمم الواجهة، والأكاونت يبعتها للعميل.', 'ui_designer', true),
  (6, 'Web', 'تطبيق الـ UI على المتجر', 'بعد موافقة العميل، المبرمج يطبّق الـ UI على المتجر.', 'developer', false),
  (7, 'Web', 'ربط الدومين بالمتجر', 'بعد ما العميل يشتري الدومين، المبرمج يربطه بالمتجر.', 'developer', false),
  (8, 'Content Plan', 'خطة المحتوى (البلان)', 'الكونتنت كريتور يجهّز البلان، والأكاونت يبعته للعميل.', 'content_creator', true),
  (9, 'Designs', 'تصميمات البلان', 'لو البلان اتقبل، الديزاينر ينفّذ التصميمات ويبعتها للأكاونت، والأكاونت يبعتها للعميل يعتمد.', 'designer', true),
  (10, 'Social Media', 'نشر التصميمات', 'بعد موافقة العميل على التصميمات، السوشيال ميديا مانجر ينشر.', 'social_media_manager', false)
) x(n, stage, title, descr, role, nc)
where not exists (select 1 from task_templates t where t.service_code = 'full_service');

drop function if exists app.task_assignees();
create function app.task_assignees()
returns table(id uuid, full_name text, role_name text, open_tasks int, role_code text)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, r.name_ar, (select count(*)::int from tasks t where t.assignee_id = e.id and t.status <> 'approved'), r.code
    from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
   where app.has_perm('tasks.manage') and app._tech_role(e.id)
   order by r.name_ar, e.full_name
$$;

drop function if exists app.task_template_list(boolean);
create function app.task_template_list(p_all boolean)
returns table(id uuid, service_code text, service_name text, title text, description text, estimated_hours numeric, is_active boolean,
              stage text, role_code text, role_name text, needs_client boolean, sort int)
language sql stable security definer set search_path = public, app as $$
  select t.id, t.service_code, sv.name_ar, t.title, t.description, t.estimated_hours, t.is_active, t.stage, t.role_code, r.name_ar, t.needs_client, t.sort
    from task_templates t left join services sv on sv.code = t.service_code left join roles r on r.code = t.role_code
   where app.has_perm('tasks.manage') and (t.is_active or coalesce(p_all, false))
   order by sv.sort nulls last, t.sort, t.created_at
$$;

create or replace function app.task_template_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_svc text := nullif(p->>'service',''); v_role text := nullif(p->>'role','');
begin
  if not (app.is_super() or app.role_code() = 'operations_manager') then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p->>'title',''))) < 2 then raise exception 'task title required'; end if;
  if v_svc is not null and not exists (select 1 from services s where s.code = v_svc) then raise exception 'invalid service'; end if;
  if v_role is not null and not exists (select 1 from roles r where r.code = v_role) then raise exception 'invalid assignee'; end if;
  insert into task_templates(service_code, title, description, estimated_hours, created_by, stage, role_code, needs_client, sort)
  values (v_svc, btrim(p->>'title'), nullif(btrim(p->>'description'),''), nullif(p->>'estimated_hours','')::numeric, app.me(), nullif(btrim(p->>'stage'),''), v_role,
          coalesce((p->>'needs_client')::boolean, false), coalesce(nullif(p->>'sort','')::int, (select coalesce(max(sort), 0) + 1 from task_templates where service_code is not distinct from v_svc)))
  returning id into v_id;
  return v_id;
end $$;

-- the steps of this client's packages, each with the task it was sent as (if any)
create or replace function app.ops_steps(p_ops uuid)
returns table(template_id uuid, service_name text, stage text, title text, description text, role_code text, role_name text, needs_client boolean, estimated_hours numeric,
              task_id uuid, task_status text, assignee_name text)
language sql stable security definer set search_path = public, app as $$
  select tt.id, sv.name_ar, tt.stage, tt.title, tt.description, tt.role_code, r.name_ar, tt.needs_client, tt.estimated_hours, tk.id, tk.status, app.emp_name(tk.assignee_id)
    from client_operations o
    join contract_services cs on cs.contract_id = o.contract_id
    join task_templates tt on tt.service_code = cs.service_code and tt.is_active
    join services sv on sv.code = tt.service_code
    left join roles r on r.code = tt.role_code
    left join lateral (select t.id, t.status, t.assignee_id from tasks t where t.ops_id = o.id and t.template_id = tt.id order by t.created_at desc limit 1) tk on true
   where o.id = p_ops and app._ops_visible(o.account_manager_id)
   order by cs.sort, tt.sort, tt.created_at
$$;

-- the client's answer on a task that needed him, recorded by the Account Manager
create or replace function app.task_client(p_task uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into o from client_operations where id = t.ops_id;
  if not (app.has_perm('tasks.review') and (app.is_super() or app.role_code() = 'operations_manager' or o.account_manager_id = app.me())) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'approved' and p_ok then return; end if;
  if t.status <> 'client_review' then raise exception 'task is not waiting for the client'; end if;
  if not p_ok and coalesce(btrim(p_note),'') = '' then raise exception 'reason required'; end if;
  perform set_config('app.reason', coalesce(nullif(btrim(p_note),''), 'موافقة العميل'), true);
  update tasks set status = case when p_ok then 'approved' else 'changes_requested' end, client_decided_at = now(), client_note = nullif(btrim(p_note),''),
         review_note = case when p_ok then review_note else 'العميل طلب تعديل: ' || btrim(p_note) end,
         revisions = revisions + case when p_ok then 0 else 1 end, updated_at = now() where id = t.id;
  perform app._notify(t.assignee_id, case when p_ok then 'task_approved' else 'task_changes' end,
    case when p_ok then 'العميل وافق — التاسك اتعتمد ✓' else 'العميل طلب تعديل على التاسك' end, t.title || coalesce(' — ' || nullif(btrim(p_note),''), ''), '/tasks/' || t.id,
    'taskcl:' || t.id || ':' || p_ok || ':' || t.revisions);
end $$;

create or replace function app.task_save(p_ops uuid, p_task uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare o client_operations; t tasks; v_id uuid; v_as uuid := nullif(p->>'assignee','')::uuid; v_title text := btrim(coalesce(p->>'title',''));
        v_start date := nullif(p->>'start_date','')::date; v_due date := nullif(p->>'due_date','')::date; v_est numeric := nullif(p->>'estimated_hours','')::numeric;
        v_svc text := nullif(p->>'service',''); v_pri text := coalesce(nullif(p->>'priority',''), 'normal'); v_client text; v_tpl uuid := nullif(p->>'template','')::uuid; v_nc boolean := coalesce((p->>'needs_client')::boolean, false);
begin
  select * into o from client_operations where id = p_ops;
  if not found or not app._task_can_manage(o.account_manager_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(v_title) < 2 then raise exception 'task title required'; end if;
  if v_as is null or not app._tech_role(v_as) then raise exception 'invalid assignee'; end if;
  if v_start is not null and v_due is not null and v_due < v_start then raise exception 'due date is before start date'; end if;
  if v_svc is not null and not exists (select 1 from services s where s.code = v_svc) then raise exception 'invalid service'; end if;
  select cl.name into v_client from clients cl where cl.id = o.client_id;
  if p_task is null then
    if v_tpl is not null and not exists (select 1 from task_templates tt where tt.id = v_tpl) then raise exception 'invalid template'; end if;
    insert into tasks(ops_id, title, description, service_code, assignee_id, created_by, priority, start_date, due_date, estimated_hours, template_id, needs_client)
    values (o.id, v_title, nullif(btrim(p->>'description'),''), v_svc, v_as, app.me(), v_pri, v_start, v_due, v_est, v_tpl, v_nc) returning id into v_id;
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
           start_date = v_start, due_date = v_due, estimated_hours = v_est, needs_client = v_nc,
           status = case when t.assignee_id <> v_as and t.status in ('in_progress','paused') then 'todo' else t.status end, updated_at = now() where id = t.id;
  end if;
  return v_id;
end $$;

create or replace function app.task_start(p_task uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found or t.assignee_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status in ('submitted','client_review','approved') then raise exception 'task cannot be started now'; end if;
  if exists (select 1 from task_time_logs l where l.task_id = t.id and l.employee_id = app.me() and l.ended_at is null) then return; end if;
  update tasks set status = 'paused', updated_at = now()
   where status = 'in_progress' and id in (select l.task_id from task_time_logs l where l.employee_id = app.me() and l.ended_at is null);
  update task_time_logs set ended_at = now() where employee_id = app.me() and ended_at is null;
  insert into task_time_logs(task_id, employee_id) values (t.id, app.me());
  update tasks set status = 'in_progress', updated_at = now() where id = t.id;
end $$;

create or replace function app.task_submit(p_task uuid, p_link text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations; v_link text := btrim(coalesce(p_link,'')); u uuid;
begin
  select * into t from tasks where id = p_task for update;
  if not found or t.assignee_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'submitted' then return; end if;                      -- pressed twice
  if t.status = 'approved' then raise exception 'task is closed'; end if;
  if t.status = 'client_review' then raise exception 'task cannot be started now'; end if;
  if v_link !~* '^https?://[^\s]+$' then raise exception 'delivery link required'; end if;
  update task_time_logs set ended_at = now() where task_id = t.id and ended_at is null;
  update tasks set status = 'submitted', delivery_link = v_link, delivery_note = nullif(btrim(p_note),''), submitted_at = now(), updated_at = now() where id = t.id;
  select * into o from client_operations where id = t.ops_id;
  for u in select distinct x from unnest(array[o.account_manager_id, t.created_by]) x where x is not null and x <> app.me() loop
    perform app._notify(u, 'task_submitted', 'تاسك اتسلّم ومحتاج مراجعة', t.title || ' — ' || app.emp_name(t.assignee_id), '/tasks/' || t.id, 'tasksub:' || t.id || ':' || t.revisions);
  end loop;
end $$;

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
  update tasks set status = case when p_ok and t.needs_client then 'client_review' when p_ok then 'approved' else 'changes_requested' end, reviewed_by = app.me(), reviewed_at = now(),
         review_note = nullif(btrim(p_note),''), revisions = revisions + case when p_ok then 0 else 1 end, updated_at = now() where id = t.id;
  perform app._notify(t.assignee_id, case when p_ok then 'task_approved' else 'task_changes' end,
    case when p_ok and t.needs_client then 'الأكاونت اعتمد التاسك — مستني موافقة العميل' when p_ok then 'التاسك اتعتمد ✓' else 'مطلوب تعديل على التاسك' end, t.title || coalesce(' — ' || nullif(btrim(p_note),''), ''), '/tasks/' || t.id,
    'taskrev:' || t.id || ':' || p_ok || ':' || t.revisions);
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

commit;
