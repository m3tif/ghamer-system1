-- 044: Phase 3 step 3 — client onboarding (kickoff, operational brief, requirements checklist), task templates,
-- files on tasks, technical team performance, and the 360° client file.
begin;

-- ───────── onboarding ─────────
create table if not exists client_onboarding (
  ops_id uuid primary key references client_operations(id),
  kickoff_at timestamptz,
  kickoff_link text check (length(kickoff_link) <= 1000),
  goals text check (length(goals) <= 4000),
  audience text check (length(audience) <= 4000),
  brand_identity text check (length(brand_identity) <= 4000),
  competitors text check (length(competitors) <= 4000),
  products text check (length(products) <= 4000),
  channels text check (length(channels) <= 4000),
  kpis text check (length(kpis) <= 4000),
  priorities text check (length(priorities) <= 4000),
  links text check (length(links) <= 4000),
  plan text check (length(plan) <= 8000),
  updated_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists onboarding_items (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  label text not null check (length(btrim(label)) between 2 and 200),
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references employees(id),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_items_ops on onboarding_items(ops_id);

-- ───────── task templates ─────────
create table if not exists task_templates (
  id uuid primary key default gen_random_uuid(),
  service_code text references services(code),
  title text not null check (length(btrim(title)) between 2 and 200),
  description text check (length(description) <= 4000),
  estimated_hours numeric(6,2) check (estimated_hours > 0 and estimated_hours <= 1000),
  is_active boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

alter table client_onboarding enable row level security;
alter table onboarding_items enable row level security;
alter table task_templates enable row level security;
revoke all on client_onboarding, onboarding_items, task_templates from ghamer_app;
drop trigger if exists audit_client_onboarding on client_onboarding;
create trigger audit_client_onboarding after insert or update or delete on client_onboarding for each row execute function app.audit_row('updated_at');
drop trigger if exists audit_task_templates on task_templates;
create trigger audit_task_templates after insert or update or delete on task_templates for each row execute function app.audit_row();

create or replace function app.onboarding_get(p_ops uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'brief', (select to_jsonb(b) || jsonb_build_object('updated_by_name', app.emp_name(b.updated_by)) from client_onboarding b where b.ops_id = o.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'done', i.done, 'done_at', i.done_at, 'done_by', app.emp_name(i.done_by)) order by i.sort, i.created_at), '[]')
                from onboarding_items i where i.ops_id = o.id),
    'can_edit', app._task_can_manage(o.account_manager_id))
    from client_operations o where o.id = p_ops and app._ops_visible(o.account_manager_id)
$$;

create or replace function app.onboarding_save(p_ops uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
declare o client_operations;
begin
  select * into o from client_operations where id = p_ops;
  if not found or not app._task_can_manage(o.account_manager_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into client_onboarding(ops_id, kickoff_at, kickoff_link, goals, audience, brand_identity, competitors, products, channels, kpis, priorities, links, plan, updated_by)
  values (o.id, nullif(p->>'kickoff_at','')::timestamptz, nullif(btrim(p->>'kickoff_link'),''), nullif(btrim(p->>'goals'),''), nullif(btrim(p->>'audience'),''),
          nullif(btrim(p->>'brand_identity'),''), nullif(btrim(p->>'competitors'),''), nullif(btrim(p->>'products'),''), nullif(btrim(p->>'channels'),''),
          nullif(btrim(p->>'kpis'),''), nullif(btrim(p->>'priorities'),''), nullif(btrim(p->>'links'),''), nullif(btrim(p->>'plan'),''), app.me())
  on conflict (ops_id) do update set kickoff_at = excluded.kickoff_at, kickoff_link = excluded.kickoff_link, goals = excluded.goals, audience = excluded.audience,
     brand_identity = excluded.brand_identity, competitors = excluded.competitors, products = excluded.products, channels = excluded.channels, kpis = excluded.kpis,
     priorities = excluded.priorities, links = excluded.links, plan = excluded.plan, updated_by = app.me(), updated_at = now();
end $$;

-- add one requirement; with p_label null the standard starting list is added (once)
create or replace function app.onboarding_item_add(p_ops uuid, p_label text) returns void
language plpgsql security definer set search_path = public, app as $$
declare o client_operations; v_n int;
begin
  select * into o from client_operations where id = p_ops for update;
  if not found or not app._task_can_manage(o.account_manager_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select count(*) into v_n from onboarding_items where ops_id = o.id;
  if v_n >= 60 then raise exception 'too many rows'; end if;
  if p_label is null then
    if v_n > 0 then return; end if;
    insert into onboarding_items(ops_id, label, sort)
    select o.id, x.l, x.n from unnest(array['صلاحيات المتجر (سلة / زد)', 'صلاحيات حسابات السوشيال ميديا', 'صلاحيات الحسابات الإعلانية', 'اللوجو وملفات الهوية البصرية',
      'صور ومعلومات المنتجات', 'اجتماع الـ Kickoff مع العميل', 'اعتماد خطة التنفيذ من العميل']) with ordinality x(l, n);
  else
    if length(btrim(p_label)) < 2 then raise exception 'item label required'; end if;
    insert into onboarding_items(ops_id, label, sort) values (o.id, btrim(p_label), v_n + 1);
  end if;
end $$;

create or replace function app.onboarding_item_set(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare i onboarding_items; o client_operations;
begin
  select * into i from onboarding_items where id = p_item for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into o from client_operations where id = i.ops_id;
  if not app._task_can_manage(o.account_manager_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  update onboarding_items set done = p_done, done_at = case when p_done then now() end, done_by = case when p_done then app.me() end where id = i.id and done is distinct from p_done;
end $$;

-- templates: written by the Technical Manager, used by whoever writes tasks
create or replace function app.task_template_list(p_all boolean)
returns table(id uuid, service_code text, service_name text, title text, description text, estimated_hours numeric, is_active boolean)
language sql stable security definer set search_path = public, app as $$
  select t.id, t.service_code, sv.name_ar, t.title, t.description, t.estimated_hours, t.is_active
    from task_templates t left join services sv on sv.code = t.service_code
   where app.has_perm('tasks.manage') and (t.is_active or coalesce(p_all, false))
   order by sv.sort nulls last, t.created_at
$$;
create or replace function app.task_template_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_svc text := nullif(p->>'service','');
begin
  if not (app.is_super() or app.role_code() = 'operations_manager') then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p->>'title',''))) < 2 then raise exception 'task title required'; end if;
  if v_svc is not null and not exists (select 1 from services s where s.code = v_svc) then raise exception 'invalid service'; end if;
  insert into task_templates(service_code, title, description, estimated_hours, created_by)
  values (v_svc, btrim(p->>'title'), nullif(btrim(p->>'description'),''), nullif(p->>'estimated_hours','')::numeric, app.me()) returning id into v_id;
  return v_id;
end $$;
create or replace function app.task_template_set(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not (app.is_super() or app.role_code() = 'operations_manager') then raise exception 'not allowed' using errcode = '42501'; end if;
  update task_templates set is_active = p_active where id = p_id and is_active is distinct from p_active;
end $$;

-- ───────── files on a task ─────────
create or replace function app.task_attach(p_task uuid, p_filename text, p_mime text, p_content bytea) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations; v_id uuid; v_name text := left(regexp_replace(coalesce(p_filename,''), '^.*[/\\]', ''), 150); v_head text := encode(substring(p_content from 1 for 12), 'hex');
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into o from client_operations where id = t.ops_id;
  if not (t.assignee_id = app.me() or app._task_can_manage(o.account_manager_id)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'approved' then raise exception 'task is closed'; end if;
  if p_content is null or octet_length(p_content) = 0 then raise exception 'file is empty'; end if;
  if octet_length(p_content) > 4 * 1024 * 1024 then raise exception 'file too large'; end if;
  if (select count(*) from attachments a where a.entity_type = 'task' and a.entity_id = p_task) >= 20 then raise exception 'too many files'; end if;
  if not ((p_mime = 'application/pdf' and v_head like '25504446%')
       or (p_mime = 'image/jpeg' and v_head like 'ffd8ff%')
       or (p_mime = 'image/png' and v_head like '89504e470d0a1a0a%')
       or (p_mime = 'image/webp' and v_head like '52494646%' and substring(v_head from 17 for 8) = '57454250')) then
    raise exception 'unsupported file type';
  end if;
  if v_name = '' then v_name := 'file'; end if;
  insert into attachments(entity_type, entity_id, storage_path, filename, mime_type, size_bytes, uploaded_by, kind)
  values ('task', p_task, 'db', v_name, p_mime, octet_length(p_content), app.me(), 'other') returning id into v_id;
  insert into attachment_blobs(attachment_id, content) values (v_id, p_content);
  return v_id;
end $$;

create or replace function app.task_file_delete(p_attachment uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare a attachments; t tasks;
begin
  select * into a from attachments where id = p_attachment and entity_type = 'task';
  if not found then return; end if;
  select * into t from tasks where id = a.entity_id for update;
  if t.status = 'approved' then raise exception 'task is closed'; end if;
  if not (a.uploaded_by = app.me() or app.is_super()) then raise exception 'file delete not allowed: not the uploader' using errcode = '42501'; end if;
  delete from attachment_blobs where attachment_id = a.id;
  delete from attachments where id = a.id;
end $$;

-- download: contract files by the contract rule, task files by the task rule
create or replace function app.attachment_get(p_id uuid) returns table(filename text, mime_type text, content bytea)
language sql stable security definer set search_path = public, app as $$
  select a.filename, a.mime_type, b.content from attachments a join attachment_blobs b on b.attachment_id = a.id
   where a.id = p_id and (
     (a.entity_type = 'contract' and exists (select 1 from contracts c where c.id = a.entity_id and app.contract_visible(c.sales_owner_id, c.status)))
     or (a.entity_type = 'task' and exists (select 1 from tasks t join client_operations o on o.id = t.ops_id where t.id = a.entity_id and app._task_visible(o.account_manager_id, t.assignee_id))))
$$;

-- ───────── technical team performance (per month) ─────────
create or replace function app.tech_performance(p_month date)
returns table(employee_id uuid, full_name text, role_name text, assigned int, approved int, open_now int, late_now int, pending_review int, revisions int,
              on_time int, on_time_base int, minutes int, estimated_hours numeric)
language sql stable security definer set search_path = public, app as $$
  with m as (select date_trunc('month', coalesce(p_month, app._today()))::date d0, (date_trunc('month', coalesce(p_month, app._today())) + interval '1 month')::date d1),
       tz as (select app.company_tz() z)
  select e.id, e.full_name, r.name_ar,
    (select count(*)::int from tasks t, m, tz where t.assignee_id = e.id and (t.created_at at time zone tz.z)::date >= m.d0 and (t.created_at at time zone tz.z)::date < m.d1),
    (select count(*)::int from tasks t, m, tz where t.assignee_id = e.id and t.status = 'approved' and (t.reviewed_at at time zone tz.z)::date >= m.d0 and (t.reviewed_at at time zone tz.z)::date < m.d1),
    (select count(*)::int from tasks t where t.assignee_id = e.id and t.status <> 'approved'),
    (select count(*)::int from tasks t where t.assignee_id = e.id and t.status <> 'approved' and t.due_date < app._today()),
    (select count(*)::int from tasks t where t.assignee_id = e.id and t.status = 'submitted'),
    (select coalesce(sum(t.revisions), 0)::int from tasks t, m, tz where t.assignee_id = e.id and (t.created_at at time zone tz.z)::date >= m.d0 and (t.created_at at time zone tz.z)::date < m.d1),
    (select count(*)::int from tasks t, m, tz where t.assignee_id = e.id and t.status = 'approved' and t.due_date is not null and (t.reviewed_at at time zone tz.z)::date >= m.d0 and (t.reviewed_at at time zone tz.z)::date < m.d1
        and (t.submitted_at at time zone tz.z)::date <= t.due_date),
    (select count(*)::int from tasks t, m, tz where t.assignee_id = e.id and t.status = 'approved' and t.due_date is not null and (t.reviewed_at at time zone tz.z)::date >= m.d0 and (t.reviewed_at at time zone tz.z)::date < m.d1),
    (select coalesce(round(sum(extract(epoch from coalesce(l.ended_at, now()) - l.started_at)) / 60), 0)::int from task_time_logs l, m, tz
      where l.employee_id = e.id and (l.started_at at time zone tz.z)::date >= m.d0 and (l.started_at at time zone tz.z)::date < m.d1),
    (select coalesce(sum(t.estimated_hours), 0) from tasks t, m, tz where t.assignee_id = e.id and (t.created_at at time zone tz.z)::date >= m.d0 and (t.created_at at time zone tz.z)::date < m.d1)
  from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
  where (app.is_admin() or app.role_code() = 'operations_manager') and app._tech_role(e.id)
  order by r.name_ar, e.full_name
$$;

-- ───────── 360° client file ─────────
-- One file for the whole journey. Who: admins, Finance, the Technical Manager, and the client's Account Manager.
-- Money (contract value) is returned only to admins and Finance.
create or replace function app.client_360(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_fin boolean := coalesce(app.is_admin() or app.role_code() in ('finance_manager','finance_employee'), false); v_ok boolean; j jsonb;
begin
  v_ok := app.me() is not null and (v_fin or exists (select 1 from client_operations o where o.client_id = p_client and app._ops_visible(o.account_manager_id)));
  if not v_ok then return null; end if;
  select jsonb_build_object(
    'client', jsonb_build_object('id', cl.id, 'name', cl.name, 'business_name', cl.business_name, 'industry', cl.industry, 'city', cl.city, 'country', cl.country,
        'contact_person', cl.contact_person, 'source', cl.original_source, 'created_at', cl.created_at, 'creator', app.emp_name(cl.original_creator_id)),
    'show_money', v_fin,
    'phones', (select coalesce(jsonb_agg(cc.phone order by cc.is_primary desc, cc.created_at), '[]') from client_contacts cc where cc.client_id = cl.id and cc.phone is not null),
    'stores', (select coalesce(jsonb_agg(s.url_raw order by s.created_at), '[]') from client_stores s where s.client_id = cl.id),
    'leads', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'status', l.lead_status, 'creator', app.emp_name(l.original_creator_id), 'owner', app.emp_name(l.current_owner_id),
                 'sales', app.emp_name(l.assigned_sales_id), 'created_at', l.created_at, 'last_contact_at', l.last_contact_at) order by l.created_at), '[]') from leads l where l.client_id = cl.id),
    'meetings', (select coalesce(jsonb_agg(jsonb_build_object('at', mt.scheduled_at, 'status', mt.status, 'tele', app.emp_name(mt.tele_sales_id), 'sales', app.emp_name(mt.sales_rep_id),
                 'outcome', mt.outcome, 'notes', mt.result_notes) order by mt.scheduled_at desc), '[]') from meetings mt join leads l on l.id = mt.lead_id where l.client_id = cl.id),
    'deals', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'stage', d.stage, 'owner', app.emp_name(d.owner_sales_id), 'closer', app.emp_name(d.closing_sales_id), 'created_at', d.created_at,
                 'lost_reason', d.lost_reason) order by d.created_at), '[]') from deals d where d.client_id = cl.id),
    'contracts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'contract_no', c.contract_no, 'status', c.status, 'start_date', c.start_date, 'end_date', c.end_date,
                 'sales', app.emp_name(c.sales_owner_id), 'tele', app.emp_name(c.tele_sales_id), 'approved_at', c.approved_at, 'payment_method', case when v_fin then c.payment_method end,
                 'total', case when v_fin then c.total_amount end,
                 'packages', (select coalesce(jsonb_agg(sv.name_ar order by cs.sort), '[]') from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = c.id))
                 order by c.created_at), '[]') from contracts c where c.client_id = cl.id and c.status <> 'cancelled'),
    'ops', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'account_manager', app.emp_name(o.account_manager_id), 'assigned_at', o.assigned_at,
                 'kickoff_at', (select b.kickoff_at from client_onboarding b where b.ops_id = o.id),
                 'checklist_done', (select count(*) from onboarding_items i where i.ops_id = o.id and i.done), 'checklist_all', (select count(*) from onboarding_items i where i.ops_id = o.id),
                 'tasks_all', (select count(*) from tasks t where t.ops_id = o.id), 'tasks_done', (select count(*) from tasks t where t.ops_id = o.id and t.status = 'approved'),
                 'tasks_late', (select count(*) from tasks t where t.ops_id = o.id and t.status <> 'approved' and t.due_date < app._today()),
                 'minutes', (select coalesce(round(sum(extract(epoch from coalesce(lg.ended_at, now()) - lg.started_at)) / 60), 0)::int from task_time_logs lg join tasks t on t.id = lg.task_id where t.ops_id = o.id))
                 order by o.created_at), '[]') from client_operations o where o.client_id = cl.id),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'assignee', app.emp_name(t.assignee_id), 'due_date', t.due_date,
                 'delivery_link', t.delivery_link) order by t.created_at desc), '[]') from tasks t join client_operations o on o.id = t.ops_id where o.client_id = cl.id),
    'timeline', (select coalesce(jsonb_agg(to_jsonb(ev) order by ev.at desc), '[]') from (
        select * from (
          select cl.created_at as at, 'client_created'::text as kind, null::text as a, null::text as b, app.emp_name(cl.original_creator_id) as by
          union all select a.created_at, 'activity', a.status_to, a.note, app.emp_name(a.created_by) from lead_activities a join leads l on l.id = a.lead_id where l.client_id = cl.id
          union all select mt.scheduled_at, 'meeting', mt.status, null, app.emp_name(mt.sales_rep_id) from meetings mt join leads l on l.id = mt.lead_id where l.client_id = cl.id
          union all select h.at, 'stage', h.to_stage, h.reason, app.emp_name(h.by_employee) from deal_stage_history h join deals d on d.id = h.deal_id where d.client_id = cl.id
          union all select c.created_at, 'contract_created', c.contract_no, null, app.emp_name(c.created_by) from contracts c where c.client_id = cl.id
          union all select c.approved_at, 'contract_approved', c.contract_no, null, app.emp_name(c.approved_by) from contracts c where c.client_id = cl.id and c.approved_at is not null
          union all select o.assigned_at, 'ops_assigned', app.emp_name(o.account_manager_id), o.assign_note, app.emp_name(o.assigned_by) from client_operations o where o.client_id = cl.id and o.assigned_at is not null
          union all select b.kickoff_at, 'kickoff', null, null, app.emp_name(o.account_manager_id) from client_onboarding b join client_operations o on o.id = b.ops_id where o.client_id = cl.id and b.kickoff_at is not null
          union all select t.created_at, 'task_created', t.title, null, app.emp_name(t.created_by) from tasks t join client_operations o on o.id = t.ops_id where o.client_id = cl.id
          union all select t.reviewed_at, 'task_approved', t.title, null, app.emp_name(t.reviewed_by) from tasks t join client_operations o on o.id = t.ops_id where o.client_id = cl.id and t.status = 'approved'
        ) x order by x.at desc limit 300) ev))
    into j from clients cl where cl.id = p_client;
  return j;
end $$;

-- task_get: + files and the client's operational brief
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
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'filename', a.filename, 'size_bytes', a.size_bytes, 'by', app.emp_name(a.uploaded_by), 'at', a.created_at,
                 'can_delete', (a.uploaded_by = app.me() or app.is_super()) and t.status <> 'approved') order by a.created_at), '[]') from attachments a where a.entity_type = 'task' and a.entity_id = t.id),
      'brief', (select to_jsonb(b) from client_onboarding b where b.ops_id = o.id),
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
