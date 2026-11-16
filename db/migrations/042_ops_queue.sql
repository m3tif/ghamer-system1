-- 042: Phase 3 step 1 — Technical Manager receives financially approved clients and hands each one to an Account Manager.
-- The technical team job titles become roles (SEO, UI, developer, designer, content creator, media buyer).
begin;

-- roles
update roles set name_ar = 'المدير التقني', name_en = 'Technical Manager' where code = 'operations_manager';
insert into roles(code, name_ar, name_en, department_id, is_manager, mfa_required)
select r.code, r.name_ar, r.name_en, (select id from departments where code = 'technical'), false, false
from (values ('seo_specialist','SEO','SEO Specialist'), ('ui_designer','UI','UI Designer'), ('developer','مبرمج','Developer'),
             ('designer','ديزاينر','Designer'), ('content_creator','كونتنت كريتور','Content Creator'), ('media_buyer','ميديا باير','Media Buyer')) r(code, name_ar, name_en)
on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en;
insert into role_permissions(role_id, permission_key, scope)
select r.id, p.k, 'own' from roles r cross join (values ('tasks.view_own'), ('time.log')) p(k)
 where r.code in ('seo_specialist','ui_designer','developer','designer','content_creator','media_buyer')
on conflict do nothing;
-- the Technical Manager sees technical things only: no employee list, no contracts pages
delete from role_permissions where role_id = (select id from roles where code = 'operations_manager') and permission_key in ('employees.view','contracts.view');
insert into role_permissions(role_id, permission_key, scope) select id, 'ops.view', 'own' from roles where code = 'account_manager' on conflict do nothing;

-- the operations queue: one row per financially approved contract
create table if not exists client_operations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references contracts(id),
  client_id uuid not null references clients(id),
  deal_id uuid not null references deals(id),
  status text not null default 'new' check (status in ('new','assigned')),
  account_manager_id uuid references employees(id),
  assigned_by uuid references employees(id),
  assigned_at timestamptz,
  assign_note text check (length(assign_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_operations_am on client_operations(account_manager_id);
alter table client_operations enable row level security;
revoke all on client_operations from ghamer_app;                -- read and written only through the functions below
drop trigger if exists audit_client_operations on client_operations;
create trigger audit_client_operations after insert or update or delete on client_operations for each row execute function app.audit_row('updated_at');

-- clients approved before this step go into the queue too
insert into client_operations(contract_id, client_id, deal_id, created_at)
select c.id, c.client_id, c.deal_id, coalesce(c.approved_at, now()) from contracts c where c.status = 'approved' on conflict (contract_id) do nothing;

create or replace function app._ops_visible(p_am uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and app.has_perm('ops.view')
     and (app.is_admin() or app.role_code() = 'operations_manager' or p_am = app.me())
$$;

create or replace function app.ops_list(p_status text)
returns table(id uuid, status text, client_id uuid, client_name text, business_name text, phone text, store_url text, contract_id uuid, contract_no text,
              packages text[], start_date date, end_date date, duration_months int, contract_notes text, sales_name text, approved_at timestamptz,
              account_manager_id uuid, account_manager_name text, assigned_at timestamptz, assigned_by_name text, assign_note text, created_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select o.id, o.status, cl.id, cl.name, cl.business_name,
         (select cc.phone from client_contacts cc where cc.client_id = cl.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
         (select s.url_raw from client_stores s where s.client_id = cl.id order by s.created_at limit 1),
         c.id, c.contract_no,
         array(select sv.name_ar from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = c.id order by cs.sort),
         c.start_date, c.end_date, c.duration_months, c.notes, app.emp_name(c.sales_owner_id), c.approved_at,
         o.account_manager_id, app.emp_name(o.account_manager_id), o.assigned_at, app.emp_name(o.assigned_by), o.assign_note, o.created_at
    from client_operations o join contracts c on c.id = o.contract_id join clients cl on cl.id = o.client_id
   where app._ops_visible(o.account_manager_id) and (p_status is null or o.status = p_status)
   order by case when o.status = 'new' then 0 else 1 end, coalesce(o.assigned_at, o.created_at) desc
   limit 500
$$;

create or replace function app.ops_account_managers()
returns table(id uuid, full_name text, clients int)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, (select count(*)::int from client_operations o where o.account_manager_id = e.id)
    from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
   where r.code = 'account_manager' and u.is_active and app.has_perm('ops.assign')
   order by e.full_name
$$;

create or replace function app.ops_assign(p_id uuid, p_am uuid, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare o client_operations; v_client text;
begin
  if not app.has_perm('ops.assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from client_operations where id = p_id for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  if not exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_am and r.code = 'account_manager' and u.is_active) then
    raise exception 'invalid account manager'; end if;
  if o.account_manager_id = p_am then return; end if;                 -- pressed twice
  perform set_config('app.reason', coalesce(nullif(btrim(p_note),''), case when o.account_manager_id is null then 'تحويل للأكاونت مانجر' else 'تغيير الأكاونت مانجر' end), true);
  update client_operations set status = 'assigned', account_manager_id = p_am, assigned_by = app.me(), assigned_at = now(),
         assign_note = nullif(btrim(p_note),''), updated_at = now() where id = o.id;
  select cl.name into v_client from clients cl where cl.id = o.client_id;
  perform app._notify(p_am, 'ops_assigned', 'عميل جديد مسند إليك', v_client || coalesce(' — ' || nullif(btrim(p_note),''), ''), '/operations', 'opsas:' || o.id || ':' || p_am);
  if o.account_manager_id is not null then
    perform app._notify(o.account_manager_id, 'ops_unassigned', 'عميل اتنقل لأكاونت مانجر تاني', v_client, '/operations', 'opsun:' || o.id || ':' || extract(epoch from now())::bigint);
  end if;
end $$;

create or replace function app.contract_approve(p_contract uuid, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare c contracts; d deals; u record;
begin
  if not app.has_perm('finance.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  if c.status = 'approved' then return; end if;                                    -- pressed twice
  if c.status <> 'submitted' then raise exception 'contract is not waiting for Finance'; end if;
  perform set_config('app.reason', coalesce(nullif(btrim(p_note),''), 'اعتماد مالي'), true);
  update contracts set status = 'approved', approved_by = app.me(), approved_at = now(), updated_by = app.me() where id = c.id;
  select * into d from deals where id = c.deal_id for update;
  if d.stage <> 'Financially Approved' then
    update deals set stage = 'Financially Approved' where id = d.id;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
    values (d.id, d.stage, 'Financially Approved', 'اعتماد مالي للعقد ' || c.contract_no || coalesce(' — ' || nullif(btrim(p_note),''), ''), app.me());
  end if;
  -- Phase 3: the approved client goes to the Technical Manager's queue (once)
  insert into client_operations(contract_id, client_id, deal_id) values (c.id, c.client_id, c.deal_id) on conflict (contract_id) do nothing;
  for u in select us.id from users us join roles r on r.id = us.role_id where r.code = 'operations_manager' and us.is_active loop
    perform app._notify(u.id, 'ops_new', 'عميل جديد معتمد ماليًا', (select cl.name from clients cl where cl.id = c.client_id) || ' — ' || c.contract_no || ' · محتاج يتحوّل لأكاونت مانجر', '/operations', 'opsnew:' || c.id);
  end loop;
  perform app._notify(c.sales_owner_id, 'contract_approved', 'تم الاعتماد المالي للعقد', c.contract_no || ' — مبروك، العقد اتعتمد من المالية', '/contracts/' || c.id, 'ctapp:' || c.id);
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
