-- 047: existing clients («عميل قائم») go straight to the Technical Manager; she sets their packages and dates, then hands them to an Account Manager.
-- Before this, an existing client was saved with no lead and no queue entry, so nobody but the admin could ever see it.
begin;

alter table client_operations alter column contract_id drop not null;
alter table client_operations alter column deal_id drop not null;
alter table client_operations add column if not exists is_existing boolean not null default false;
alter table client_operations add column if not exists start_date date;
alter table client_operations add column if not exists end_date date;
alter table client_operations add column if not exists notes text check (length(notes) <= 4000);
alter table client_operations add column if not exists created_by uuid references employees(id);
alter table client_operations drop constraint if exists client_operations_source_chk;
alter table client_operations add constraint client_operations_source_chk check (is_existing or (contract_id is not null and deal_id is not null));
create unique index if not exists client_operations_one_existing on client_operations(client_id) where is_existing;

-- the packages of an existing client (a client with a contract takes them from the contract)
create table if not exists ops_services (
  id uuid primary key default gen_random_uuid(),
  ops_id uuid not null references client_operations(id),
  service_code text not null references services(code),
  sort int not null default 0,
  unique (ops_id, service_code)
);
alter table ops_services enable row level security;
revoke all on ops_services from ghamer_app;
drop trigger if exists audit_ops_services on ops_services;
create trigger audit_ops_services after insert or update or delete on ops_services for each row execute function app.audit_row();

-- existing clients added before this change: put them in the queue
insert into client_operations(client_id, is_existing, created_at, created_by)
select c.id, true, c.created_at, c.original_creator_id from clients c
 where (c.is_legacy or c.original_source = 'legacy') and c.archived_at is null
   and not exists (select 1 from client_operations o where o.client_id = c.id)
on conflict do nothing;

-- the Technical Manager sets the packages and contract dates of an existing client
create or replace function app.ops_set_packages(p_ops uuid, p_codes text[], p_start date, p_end date) returns void
language plpgsql security definer set search_path = public, app as $$
declare o client_operations;
begin
  if not app.has_perm('ops.assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from client_operations where id = p_ops for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  if not o.is_existing then raise exception 'packages come from the contract'; end if;
  if coalesce(array_length(p_codes, 1), 0) = 0 then raise exception 'packages required'; end if;
  if exists (select 1 from unnest(p_codes) x where not exists (select 1 from services s where s.code = x and s.is_active)) then raise exception 'invalid service'; end if;
  if p_start is not null and p_end is not null and p_end < p_start then raise exception 'end date is before start date'; end if;
  perform set_config('app.reason', 'تحديد باقات العميل القائم', true);
  delete from ops_services where ops_id = o.id and service_code <> all(p_codes);
  insert into ops_services(ops_id, service_code, sort)
  select o.id, x.code, x.n from unnest(p_codes) with ordinality x(code, n) on conflict (ops_id, service_code) do update set sort = excluded.sort;
  update client_operations set start_date = p_start, end_date = p_end, updated_at = now() where id = o.id;
end $$;

create or replace function app.ops_packages(p_ops uuid) returns text[]
language sql stable security definer set search_path = public, app as $$
  select coalesce(array_agg(os.service_code order by os.sort), '{}') from ops_services os join client_operations o on o.id = os.ops_id
   where os.ops_id = p_ops and app._ops_visible(o.account_manager_id)
$$;

CREATE OR REPLACE FUNCTION app.register_lead(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_me uuid := app.me(); v_role text := app.role_code(); v_ids jsonb := coalesce(p->'identifiers','[]'::jsonb);
  v_existing boolean := coalesce(p->>'mode','lead') = 'existing';
  v_client uuid; v_lead uuid; v_dup jsonb; v_sales uuid; v_status text; v_req uuid := nullif(p->>'request_id','')::uuid; v_prog jsonb; v_ops uuid; u record;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if v_existing then
    if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif not app.has_perm('leads.create') then raise exception 'not allowed' using errcode = '42501';
  end if;
  
  if jsonb_array_length(v_ids) = 0 then raise exception 'at least one phone or store required'; end if;

  -- idempotency: the same form submission (double click / retry) returns the lead it already created
  if v_req is not null then
    perform pg_advisory_xact_lock(hashtextextended('reg:' || v_me::text || ':' || v_req::text, 0)); -- concurrent retries of the same form wait for the first one
    select l.id, l.client_id into v_lead, v_client from leads l where l.request_id = v_req and l.original_creator_id = v_me;
    if found then return jsonb_build_object('status','created','client_id',v_client,'lead_id',v_lead,'repeat',true) || app._progress(v_me); end if;
  end if;
  v_dup := app._find_dup(v_ids);
  if v_dup is not null then return v_dup; end if;

  v_sales := case when v_role in ('sales_rep','sales_manager') then v_me end;
  v_status := coalesce(nullif(p->>'lead_status',''), 'New Lead');
  begin
    insert into clients(name, business_name, industry, country, city, contact_person, original_source, original_creator_id, status, is_legacy)
    values (coalesce(nullif(btrim(p->>'name'),''),'بدون اسم'), nullif(p->>'business_name',''), nullif(p->>'industry',''), coalesce(nullif(p->>'country',''),'SA'),
            nullif(p->>'city',''), nullif(p->>'contact_person',''),
            case when v_existing then 'legacy' else coalesce(nullif(p->>'source',''),'unknown') end,
            v_me, case when v_existing then 'active' else 'lead' end, v_existing)
    returning id into v_client;
    perform app._write_contacts(v_client, p, false);
    if v_existing then                                   -- an existing client goes straight to the Technical Manager's queue
      insert into client_operations(client_id, is_existing, notes, created_by) values (v_client, true, nullif(btrim(p->>'call_notes'),''), v_me) returning id into v_ops;
      insert into ops_services(ops_id, service_code, sort)
      select v_ops, x.code, x.n from jsonb_array_elements_text(coalesce(p->'packages','[]')) with ordinality x(code, n)
       where exists (select 1 from services s where s.code = x.code and s.is_active) on conflict do nothing;
      for u in select us.id from users us join roles r on r.id = us.role_id where r.code = 'operations_manager' and us.is_active loop
        perform app._notify(u.id, 'ops_new', 'عميل قائم جديد', coalesce(nullif(btrim(p->>'name'),''),'بدون اسم') || ' — حدّد الباقات وحوّله لأكاونت مانجر', '/operations', 'opsex:' || v_ops);
      end loop;
    end if;
    if not v_existing then
      insert into leads(client_id, original_creator_id, current_owner_id, assigned_sales_id, lead_status, required_services,
                        call_notes, next_followup_at, last_contact_at, updated_by, request_id, lead_temperature)
      values (v_client, v_me, v_me, v_sales, v_status,
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'required_services','[]')) x), '{}'),
              nullif(p->>'call_notes',''), nullif(p->>'next_followup_at','')::timestamptz,
              case when v_status <> 'New Lead' then now() end, v_me, v_req, nullif(p->>'lead_temperature',''))
      returning id into v_lead;
      insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
        values (v_lead, 'owner', null, v_me, v_me, 'التسجيل الأولي');
      insert into lead_activities(lead_id, kind, status_to, note, created_by)
        values (v_lead, 'note', v_status, coalesce(nullif(p->>'call_notes',''), 'تم تسجيل العميل'), v_me);
      if nullif(p->>'next_followup_at','') is not null then
        insert into follow_ups(lead_id, owner_id, due_at, reason, created_by)
        values (v_lead, v_me, (p->>'next_followup_at')::timestamptz, coalesce(nullif(btrim(p->>'followup_reason'),''), 'متابعة'), v_me);
      end if;
      if v_sales is not null then perform app._ensure_deal(v_lead, v_sales, 'New Lead'); end if;
    end if;
  exception when unique_violation then
    if v_req is not null then
      select l.id, l.client_id into v_lead, v_client from leads l where l.request_id = v_req and l.original_creator_id = v_me;
      if found then return jsonb_build_object('status','created','client_id',v_client,'lead_id',v_lead,'repeat',true) || app._progress(v_me); end if;
    end if;
    v_dup := app._find_dup(v_ids);
    if v_dup is null then raise; end if;
    return v_dup;
  end;
  if v_lead is not null then v_prog := app._award_leads(v_me); else v_prog := '{}'::jsonb; end if;
  return jsonb_build_object('status','created','client_id',v_client,'lead_id',v_lead,'ops_id',v_ops) || v_prog;
end $function$;

drop function if exists app.ops_list(text);
create function app.ops_list(p_status text)
returns table(id uuid, status text, client_id uuid, client_name text, business_name text, phone text, store_url text, contract_id uuid, contract_no text,
              packages text[], start_date date, end_date date, duration_months int, contract_notes text, sales_name text, approved_at timestamptz,
              account_manager_id uuid, account_manager_name text, assigned_at timestamptz, assigned_by_name text, assign_note text, created_at timestamptz, is_existing boolean)
language sql stable security definer set search_path = public, app as $$
  select o.id, o.status, cl.id, cl.name, cl.business_name,
         (select cc.phone from client_contacts cc where cc.client_id = cl.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
         (select s.url_raw from client_stores s where s.client_id = cl.id order by s.created_at limit 1),
         c.id, c.contract_no,
         case when o.is_existing then array(select sv.name_ar from ops_services os join services sv on sv.code = os.service_code where os.ops_id = o.id order by os.sort)
              else array(select sv.name_ar from contract_services cs join services sv on sv.code = cs.service_code where cs.contract_id = c.id order by cs.sort) end,
         coalesce(c.start_date, o.start_date), coalesce(c.end_date, o.end_date), c.duration_months, coalesce(c.notes, o.notes), app.emp_name(c.sales_owner_id), c.approved_at,
         o.account_manager_id, app.emp_name(o.account_manager_id), o.assigned_at, app.emp_name(o.assigned_by), o.assign_note, o.created_at, o.is_existing
    from client_operations o left join contracts c on c.id = o.contract_id join clients cl on cl.id = o.client_id
   where app._ops_visible(o.account_manager_id) and (p_status is null or o.status = p_status)
   order by case when o.status = 'new' then 0 else 1 end, coalesce(o.assigned_at, o.created_at) desc
   limit 500
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
  if o.is_existing and not exists (select 1 from ops_services s where s.ops_id = o.id) then raise exception 'packages required'; end if;
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

create or replace function app.ops_steps(p_ops uuid)
returns table(template_id uuid, service_name text, stage text, title text, description text, role_code text, role_name text, needs_client boolean, estimated_hours numeric,
              task_id uuid, task_status text, assignee_name text)
language sql stable security definer set search_path = public, app as $$
  select tt.id, sv.name_ar, tt.stage, tt.title, tt.description, tt.role_code, r.name_ar, tt.needs_client, tt.estimated_hours, tk.id, tk.status, app.emp_name(tk.assignee_id)
    from client_operations o
    join (select x.contract_id, null::uuid ops_id, x.service_code, x.sort from contract_services x
          union all select null, y.ops_id, y.service_code, y.sort from ops_services y) cs on (cs.contract_id = o.contract_id or cs.ops_id = o.id)
    join task_templates tt on tt.service_code = cs.service_code and tt.is_active
    join services sv on sv.code = tt.service_code
    left join roles r on r.code = tt.role_code
    left join lateral (select t.id, t.status, t.assignee_id from tasks t where t.ops_id = o.id and t.template_id = tt.id order by t.created_at desc limit 1) tk on true
   where o.id = p_ops and app._ops_visible(o.account_manager_id)
   order by cs.sort, tt.sort, tt.created_at
$$;

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
    'ops', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'is_existing', o.is_existing, 'start_date', o.start_date, 'end_date', o.end_date,
                 'packages', (select coalesce(jsonb_agg(sv.name_ar order by os.sort), '[]') from ops_services os join services sv on sv.code = os.service_code where os.ops_id = o.id), 'account_manager', app.emp_name(o.account_manager_id), 'assigned_at', o.assigned_at,
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
