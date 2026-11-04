-- 019: Bulk lead distribution — import a sheet and split the NEW leads evenly between the Tele Sales employees chosen by the manager.
-- Reuses the import staging tables and the same phone-only duplicate rule. Nothing touches real clients until the manager confirms;
-- the confirmation is ONE transaction (all or nothing), serialised on the batch row (a double click cannot import twice).
-- Existing clients are never changed; duplicates and rows needing review are excluded from the distribution.

insert into permissions(key, description) values ('leads.bulk_distribute', 'استيراد وتوزيع العملاء تلقائيًا على موظفي Tele Sales')
on conflict (key) do nothing;
insert into role_permissions(role_id, permission_key, scope)
select r.id, 'leads.bulk_distribute', 'all' from roles r where r.code in ('super_admin', 'sales_manager') on conflict do nothing;

alter table import_batches add column if not exists kind text not null default 'legacy';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_batches_kind_chk') then
    alter table import_batches add constraint import_batches_kind_chk check (kind in ('legacy', 'distribution'));
  end if;
end $$;
alter table import_batches add column if not exists source_url text;
alter table import_rows add column if not exists hunter text;

create table if not exists import_distribution (
  batch_id uuid not null references import_batches(id),
  employee_id uuid not null references employees(id),
  employee_name text not null,
  planned int not null default 0,
  assigned int not null default 0,
  primary key (batch_id, employee_id)
);
alter table import_distribution enable row level security;      -- no policies / grants: definer functions only

-- the legacy importer must never operate on a distribution batch (and vice versa)
create or replace function app._import_can(p_batch uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and exists (select 1 from import_batches b where b.id = p_batch and b.kind = 'legacy' and (
      app.has_perm('import.any') or (b.imported_by = app.me() and b.data_owner_id = app.me() and app.has_perm('import.own'))))
$$;
create or replace function app._dist_can(p_batch uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and app.has_perm('leads.bulk_distribute') and exists (
    select 1 from import_batches b where b.id = p_batch and b.kind = 'distribution' and (app.is_super() or b.imported_by = app.me()))
$$;

-- legacy list must not show distribution operations
create or replace function app.import_batches_list(p_limit int default 50)
returns table(id uuid, file_name text, file_kind text, status text, data_owner_name text, original_employee_name text, imported_by_name text, created_at timestamptz, finished_at timestamptz,
              rows_total int, c_new int, c_duplicate int, c_invalid int, c_review int, c_imported int, c_skipped int, c_updated int, c_error int, rollback_note text)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.file_name, b.file_kind, b.status, app.emp_name(b.data_owner_id), b.original_employee_name, app.emp_name(b.imported_by), b.created_at, b.finished_at,
         b.rows_total, b.c_new, b.c_duplicate, b.c_invalid, b.c_review, b.c_imported, b.c_skipped, b.c_updated, b.c_error, b.rollback_note
  from import_batches b where b.kind = 'legacy' and app.me() is not null and (app.has_perm('import.any') or (b.imported_by = app.me() and app.has_perm('import.own')))
  order by b.created_at desc limit least(coalesce(p_limit, 50), 200)
$$;

-- ───────── staging ─────────
create or replace function app.dist_create(p_header jsonb, p_rows jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_batch uuid; v_hash text := p_header->>'file_hash';
begin
  if app.me() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not app.has_perm('leads.bulk_distribute') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'empty file'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'too many rows'; end if;
  if exists (select 1 from import_batches b where b.file_hash = v_hash and b.data_owner_id = app.me() and b.status in ('importing','completed')) then raise exception 'file already imported'; end if;
  perform set_config('app.reason', 'تجهيز توزيع عملاء', true);
  insert into import_batches(kind, file_name, file_hash, file_size, file_kind, data_owner_id, original_employee_name, default_country, mapping, imported_by, source_url)
  values ('distribution', left(p_header->>'file_name', 200), v_hash, coalesce((p_header->>'file_size')::int, 0), coalesce(p_header->>'file_kind', 'csv'), app.me(), null, 'SA',
          coalesce(p_header->'mapping', '{}'), app.me(), left(p_header->>'source_url', 500))
  returning id into v_batch;
  insert into import_rows(batch_id, row_no, raw, name, business_name, phone_raw, phone_e164, phone_country, phone_valid, alt_e164, alt_country, store_url, store_key, source, status_text, notes, original_added, date_text, hunter)
  select v_batch, x.row_no, coalesce(x.raw, '{}'), nullif(btrim(x.name), ''), nullif(btrim(x.business_name), ''), x.phone_raw, x.phone_e164, x.phone_country, coalesce(x.phone_valid, false),
         x.alt_e164, x.alt_country, nullif(btrim(x.store_url), ''), x.store_key, nullif(btrim(x.source), ''), nullif(btrim(x.status_text), ''), nullif(btrim(x.notes), ''), x.original_added, x.date_text, nullif(btrim(x.hunter), '')
  from jsonb_to_recordset(p_rows) as x(row_no int, raw jsonb, name text, business_name text, phone_raw text, phone_e164 text, phone_country text, phone_valid boolean,
                                         alt_e164 text, alt_country text, store_url text, store_key text, source text, status_text text, notes text, original_added date, date_text text, hunter text);
  perform app._import_classify(v_batch);
  return v_batch;
end $$;

create or replace function app.dist_apply_mapping(p_batch uuid, p_mapping jsonb, p_rows jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not app._dist_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if (select status from import_batches where id = p_batch) <> 'staged' then raise exception 'batch is not editable'; end if;
  update import_batches set mapping = p_mapping where id = p_batch;
  update import_rows r set name = nullif(btrim(x.name),''), business_name = nullif(btrim(x.business_name),''), phone_raw = x.phone_raw, phone_e164 = x.phone_e164, phone_country = x.phone_country,
         phone_valid = coalesce(x.phone_valid,false), alt_e164 = x.alt_e164, alt_country = x.alt_country, store_url = nullif(btrim(x.store_url),''), store_key = x.store_key,
         source = nullif(btrim(x.source),''), status_text = nullif(btrim(x.status_text),''), notes = nullif(btrim(x.notes),''), original_added = x.original_added, date_text = x.date_text, hunter = nullif(btrim(x.hunter),'')
    from jsonb_to_recordset(p_rows) as x(row_no int, name text, business_name text, phone_raw text, phone_e164 text, phone_country text, phone_valid boolean,
                                         alt_e164 text, alt_country text, store_url text, store_key text, source text, status_text text, notes text, original_added date, date_text text, hunter text)
   where r.batch_id = p_batch and r.row_no = x.row_no and r.status in ('new','duplicate','invalid','review');
  perform app._import_classify(p_batch);
end $$;
create or replace function app.dist_raw_rows(p_batch uuid) returns table(row_no int, raw jsonb)
language sql stable security definer set search_path = public, app as $$
  select r.row_no, r.raw from import_rows r where app._dist_can(r.batch_id) and r.batch_id = p_batch order by r.row_no
$$;

create or replace function app.dist_skip_row(p_row bigint, p_skip boolean default true) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_batch uuid;
begin
  select batch_id into v_batch from import_rows where id = p_row;
  if v_batch is null or not app._dist_can(v_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if (select status from import_batches where id = v_batch) <> 'staged' then raise exception 'batch is not editable'; end if;
  if p_skip then update import_rows set status = 'skipped', reason = 'استبعدته يدويًا' where id = p_row and status in ('new','review','invalid');
  else update import_rows set status = 'new' where id = p_row and status = 'skipped'; perform app._import_classify(v_batch, p_row); end if;
  perform app._import_totals(v_batch);
end $$;

create or replace function app.dist_cancel(p_batch uuid) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not app._dist_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  update import_batches set status = 'cancelled', finished_at = now() where id = p_batch and status = 'staged';
end $$;

-- ───────── reading ─────────
create or replace function app.dist_candidates() returns table(id uuid, full_name text, open_leads int)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, (select count(*)::int from leads l where l.current_owner_id = e.id and l.handed_off_at is null)
  from employees e join users u on u.id = e.id join roles ro on ro.id = u.role_id
  where app.has_perm('leads.bulk_distribute') and u.is_active and ro.code = 'tele_sales' order by e.full_name
$$;
create or replace function app.dist_get(p_batch uuid) returns table(id uuid, file_name text, file_kind text, source_url text, status text, imported_by_name text, created_at timestamptz, started_at timestamptz,
              finished_at timestamptz, mapping jsonb, rows_total int, c_new int, c_duplicate int, c_invalid int, c_review int, c_imported int, c_skipped int, c_error int)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.file_name, b.file_kind, b.source_url, b.status, app.emp_name(b.imported_by), b.created_at, b.started_at, b.finished_at, b.mapping,
         b.rows_total, b.c_new, b.c_duplicate, b.c_invalid, b.c_review, b.c_imported, b.c_skipped, b.c_error
  from import_batches b where app._dist_can(b.id) and b.id = p_batch
$$;
create or replace function app.dist_rows_page(p_batch uuid, p_status text, p_limit int default 50, p_offset int default 0)
returns table(id bigint, row_no int, name text, phone_raw text, phone_e164 text, store_url text, hunter text, original_added date, status text, reason text, existing_owner_name text, total int)
language sql stable security definer set search_path = public, app as $$
  select r.id, r.row_no, r.name, r.phone_raw, r.phone_e164, r.store_url, r.hunter, r.original_added, r.status, r.reason, r.existing_owner_name, count(*) over()::int
  from import_rows r where app._dist_can(r.batch_id) and r.batch_id = p_batch and (p_status is null or r.status = p_status)
  order by r.row_no limit least(coalesce(p_limit, 50), 500) offset greatest(coalesce(p_offset, 0), 0)
$$;
create or replace function app.dist_breakdown(p_batch uuid) returns table(employee_id uuid, employee_name text, planned int, assigned int)
language sql stable security definer set search_path = public, app as $$
  select d.employee_id, d.employee_name, d.planned, d.assigned from import_distribution d where app._dist_can(d.batch_id) and d.batch_id = p_batch order by d.employee_name
$$;
create or replace function app.dist_list(p_limit int default 100)
returns table(id uuid, file_name text, source_url text, status text, imported_by_name text, created_at timestamptz, finished_at timestamptz, rows_total int, c_new int, c_duplicate int, c_imported int, employees int, split text)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.file_name, b.source_url, b.status, app.emp_name(b.imported_by), b.created_at, b.finished_at, b.rows_total, b.c_new, b.c_duplicate, b.c_imported,
         (select count(*)::int from import_distribution d where d.batch_id = b.id),
         (select string_agg(d.employee_name || ': ' || d.assigned, ' · ' order by d.employee_name) from import_distribution d where d.batch_id = b.id)
  from import_batches b where b.kind = 'distribution' and app.me() is not null and app.has_perm('leads.bulk_distribute') and b.status <> 'cancelled' and (app.is_super() or b.imported_by = app.me())
  order by b.created_at desc limit least(coalesce(p_limit, 100), 300)
$$;

-- ───────── plan (preview) ─────────
-- employees with the FEWEST open leads come first, so the extra lead of an uneven split goes to the least loaded employee
create or replace function app._dist_order(p_emps uuid[]) returns table(employee_id uuid, employee_name text, rn int)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, (row_number() over (order by (select count(*) from leads l where l.current_owner_id = e.id and l.handed_off_at is null), e.full_name, e.id))::int
  from employees e join users u on u.id = e.id join roles ro on ro.id = u.role_id
  where e.id = any(p_emps) and u.is_active and ro.code = 'tele_sales'
$$;
create or replace function app.dist_plan(p_batch uuid, p_emps uuid[]) returns table(employee_id uuid, employee_name text, open_leads int, planned int)
language plpgsql security definer set search_path = public, app as $$
declare n int; k int;
begin
  if not app._dist_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if (select status from import_batches where id = p_batch) = 'staged' then perform app._import_classify(p_batch); end if;     -- fresh duplicate check
  select count(*) into n from import_rows where batch_id = p_batch and status = 'new';
  select count(*) into k from app._dist_order(p_emps);
  return query select o.employee_id, o.employee_name, (select count(*)::int from leads l where l.current_owner_id = o.employee_id and l.handed_off_at is null),
                      case when k = 0 then 0 else n / k + (case when o.rn <= n % k then 1 else 0 end) end
               from app._dist_order(p_emps) o order by o.rn;
end $$;

-- ───────── confirm: one transaction, all or nothing ─────────
create or replace function app.dist_confirm(p_batch uuid, p_emps uuid[]) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare b import_batches; r record; v_ord uuid[]; v_names text[]; k int; n int; i int := 0; v_emp uuid;
        v_client uuid; v_lead uuid; v_payload jsonb; v_ids jsonb; v_contacts jsonb; v_stores jsonb; v_status text; v_cnt int[]; v_found int; v_hunter text;
begin
  if not app._dist_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into b from import_batches where id = p_batch for update;                       -- serialises double clicks / two tabs
  if b.status <> 'staged' then raise exception 'batch is not runnable'; end if;
  if p_emps is null or coalesce(array_length(p_emps, 1), 0) = 0 then raise exception 'choose employees'; end if;
  select count(*) into v_found from (select distinct unnest(p_emps)) x;
  select array_agg(o.employee_id order by o.rn), array_agg(o.employee_name order by o.rn) into v_ord, v_names from app._dist_order(p_emps) o;
  k := coalesce(array_length(v_ord, 1), 0);
  if k = 0 or k <> v_found then raise exception 'invalid target employee'; end if;           -- inactive / not Tele Sales / unknown
  perform app._import_classify(p_batch);                                                    -- duplicates are re-checked at the moment of confirmation
  select count(*) into n from import_rows where batch_id = p_batch and status = 'new';
  if n = 0 then raise exception 'nothing to distribute'; end if;
  perform set_config('app.reason', 'توزيع جماعي: ' || b.file_name, true);
  update import_batches set status = 'importing', started_at = now() where id = p_batch;
  v_cnt := array_fill(0, array[k]);
  for r in select * from import_rows where batch_id = p_batch and status = 'new' order by row_no for update loop
    v_emp := v_ord[i % k + 1];
    v_ids := jsonb_build_array(jsonb_build_object('kind','phone','value',r.phone_e164,'label','mobile'));
    v_contacts := jsonb_build_array(jsonb_build_object('label','mobile','phone',r.phone_e164,'is_primary',true,'phone_raw',r.phone_raw,'phone_country',r.phone_country));
    v_stores := '[]'::jsonb;
    if r.alt_e164 is not null and r.alt_e164 <> r.phone_e164 and not exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.alt_e164) then
      v_ids := v_ids || jsonb_build_array(jsonb_build_object('kind','phone','value',r.alt_e164,'label','alt_mobile'));
      v_contacts := v_contacts || jsonb_build_array(jsonb_build_object('label','alt_mobile','phone',r.alt_e164,'is_primary',false,'phone_country',r.alt_country));
    end if;
    if r.store_key is not null then
      v_ids := v_ids || jsonb_build_array(jsonb_build_object('kind','store','value',r.store_key,'label','store'));
      v_stores := jsonb_build_array(jsonb_build_object('url_raw',r.store_url,'url_key',r.store_key));
    end if;
    v_payload := jsonb_build_object('identifiers', v_ids, 'contacts', v_contacts, 'stores', v_stores);
    v_status := coalesce((select s from unnest(array['New Lead','Contacted','No Answer','Interested','Not Interested','Follow-up Required','Qualified Lead','Invalid Contact']) s where s = r.status_text), 'New Lead');
    v_hunter := r.hunter;
    insert into clients(name, business_name, country, original_source, original_creator_id, status)
      values (coalesce(nullif(btrim(r.name),''), 'بدون اسم'), r.business_name, coalesce(nullif(split_part(coalesce(r.phone_country,''),' ',1),''),'SA'), coalesce(nullif(r.source,''),'imported'), b.imported_by, 'lead')
      returning id into v_client;
    perform app._write_contacts(v_client, v_payload, false);
    insert into leads(client_id, original_creator_id, current_owner_id, lead_status, call_notes, updated_by, import_batch_id, imported_by, imported_at, original_employee_name, date_known)
      values (v_client, b.imported_by, v_emp, v_status, r.notes, b.imported_by, b.id, b.imported_by, now(), v_hunter, r.original_added is not null)
      returning id into v_lead;
    insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason) values (v_lead, 'owner', null, v_emp, b.imported_by, 'توزيع جماعي تلقائي');
    insert into lead_activities(lead_id, kind, status_to, note, created_by)
      values (v_lead, 'assignment', v_status, 'موزّع تلقائيًا من ملف «' || b.file_name || '» على ' || v_names[i % k + 1] || coalesce(' — Hunter الأصلي: ' || v_hunter, '')
               || coalesce(' — تاريخ الـ Hunt: ' || r.original_added::text, '') || ' — نفّذه: ' || app.emp_name(b.imported_by), b.imported_by);
    update import_rows set status = 'imported', client_id = v_client, lead_id = v_lead where id = r.id;
    v_cnt[i % k + 1] := v_cnt[i % k + 1] + 1;
    i := i + 1;
  end loop;
  for j in 1..k loop
    insert into import_distribution(batch_id, employee_id, employee_name, planned, assigned) values (p_batch, v_ord[j], v_names[j], v_cnt[j], v_cnt[j]);
    perform app._notify(v_ord[j], 'lead_distribution', 'تم توزيع عملاء جدد عليك', v_cnt[j] || ' عميل جديد من ملف «' || b.file_name || '»', '/leads', 'dist:' || p_batch::text);
  end loop;
  update import_batches set status = 'completed', finished_at = now() where id = p_batch;
  perform app._import_totals(p_batch);
  return jsonb_build_object('imported', i, 'employees', k, 'split', (select jsonb_agg(jsonb_build_object('name', v_names[j], 'count', v_cnt[j]) order by j) from generate_series(1, k) j));
end $$;

-- privileges
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
