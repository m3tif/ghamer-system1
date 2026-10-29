-- 014: import of previous (legacy) data from Excel / CSV.
-- Safe by design: staging first (nothing touches real clients until the importer confirms), phone is the only duplicate rule,
-- existing clients are NEVER overwritten automatically, every batch is logged, and a batch can be rolled back softly (no deletes).

insert into permissions(key, description) values
  ('import.own', 'استيراد بيانات الموظف نفسه من ملف'),
  ('import.any', 'استيراد بيانات أي موظف وإدارة عمليات الاستيراد وتحديث العملاء الموجودين والتراجع')
on conflict (key) do nothing;
insert into role_permissions(role_id, permission_key, scope)
select r.id, p.k, p.s from roles r join (values
  ('tele_sales','import.own','own'),('tele_sales_manager','import.own','own'),('sales_rep','import.own','own'),('sales_manager','import.own','own'),
  ('super_admin','import.any','all')) as p(code,k,s) on p.code = r.code
on conflict do nothing;

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text not null,
  file_size int not null,
  file_kind text not null check (file_kind in ('xlsx','csv')),
  data_owner_id uuid not null references employees(id),
  original_employee_name text,
  default_country text not null default 'SA',
  mapping jsonb not null default '{}',
  imported_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz,
  status text not null default 'staged' check (status in ('staged','importing','completed','cancelled','rolled_back')),
  rows_total int not null default 0, c_new int not null default 0, c_duplicate int not null default 0, c_invalid int not null default 0,
  c_review int not null default 0, c_imported int not null default 0, c_skipped int not null default 0, c_updated int not null default 0, c_error int not null default 0,
  rolled_back_at timestamptz, rolled_back_by uuid references employees(id), rollback_note text
);
-- the same file for the same data owner can be active only once (a double click or a second upload cannot import it twice)
create unique index if not exists import_batches_active_uq on import_batches(file_hash, data_owner_id) where status in ('importing','completed');
create index if not exists import_batches_by_idx on import_batches(imported_by, created_at desc);

create table if not exists import_rows (
  id bigserial primary key,
  batch_id uuid not null references import_batches(id),
  row_no int not null,
  raw jsonb not null default '{}',
  name text, business_name text,
  phone_raw text, phone_e164 text, phone_country text, phone_valid boolean not null default false,
  alt_e164 text, alt_country text,
  store_url text, store_key text, source text, status_text text, notes text,
  original_added date, date_text text,
  status text not null default 'new' check (status in ('new','duplicate','invalid','review','imported','skipped','updated','error','rolled_back')),
  reason text, existing_client_id uuid references clients(id), existing_owner_name text, diff jsonb,
  client_id uuid references clients(id), lead_id uuid references leads(id), lead_updated_at timestamptz, error text,
  unique (batch_id, row_no)
);
create index if not exists import_rows_status_idx on import_rows(batch_id, status, row_no);
create index if not exists import_rows_phone_idx on import_rows(batch_id, phone_e164);
alter table import_batches enable row level security;
alter table import_rows enable row level security;   -- no policies and no grants: only the definer functions below can touch them
drop trigger if exists audit_import_batches on import_batches;
create trigger audit_import_batches after insert or update on import_batches for each row execute function app.audit_row();

-- origin of every imported lead: who really added it (name as in the old file), when (original date vs import date), who imported
alter table leads add column if not exists import_batch_id uuid references import_batches(id);
alter table leads add column if not exists imported_by uuid references employees(id);
alter table leads add column if not exists imported_at timestamptz;
alter table leads add column if not exists original_employee_name text;
alter table leads add column if not exists date_known boolean not null default true;
alter table leads add column if not exists import_rolled_back_at timestamptz;
create index if not exists leads_import_batch_idx on leads(import_batch_id) where import_batch_id is not null;

create or replace function app._import_can(p_batch uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and exists (select 1 from import_batches b where b.id = p_batch and (
      app.has_perm('import.any') or (b.imported_by = app.me() and b.data_owner_id = app.me() and app.has_perm('import.own'))))
$$;

-- ───────── classification (re-runnable; whole batch or one row) ─────────
create or replace function app._import_classify(p_batch uuid, p_row bigint default null) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  update import_rows r set status = 'new', reason = null, existing_client_id = null, existing_owner_name = null, diff = null
   where r.batch_id = p_batch and r.status in ('new','duplicate','invalid','review') and (p_row is null or r.id = p_row);

  update import_rows r set status = 'invalid',
         reason = case when coalesce(btrim(r.phone_raw),'') = '' then 'لا يوجد رقم هاتف' else 'رقم هاتف غير صالح: ' || r.phone_raw end
   where r.batch_id = p_batch and r.status = 'new' and r.phone_e164 is null and (p_row is null or r.id = p_row);

  update import_rows r set status = 'duplicate',
         reason = 'مكرر داخل الملف: نفس الرقم في الصف ' || (select min(o.row_no) from import_rows o where o.batch_id = r.batch_id and o.phone_e164 = r.phone_e164 and o.row_no < r.row_no and o.status not in ('invalid','skipped'))
   where r.batch_id = p_batch and r.status = 'new' and (p_row is null or r.id = p_row)
     and exists (select 1 from import_rows o where o.batch_id = r.batch_id and o.phone_e164 = r.phone_e164 and o.row_no < r.row_no and o.status not in ('invalid','skipped'));

  update import_rows r set status = 'duplicate', existing_client_id = ci.client_id, reason = 'الرقم مسجل بالفعل في النظام',
         existing_owner_name = app.emp_name(coalesce((select l.current_owner_id from leads l where l.client_id = ci.client_id order by l.created_at desc limit 1),
                                                     (select c.original_creator_id from clients c where c.id = ci.client_id)))
    from client_identifiers ci
   where r.batch_id = p_batch and r.status = 'new' and ci.kind = 'phone' and ci.value = r.phone_e164 and (p_row is null or r.id = p_row);

  update import_rows r set status = 'review',
         reason = case when coalesce(btrim(r.name),'') = '' then 'الاسم ناقص'
                       when not r.phone_valid then 'الرقم بصيغة غير مؤكدة لهذه الدولة'
                       when r.alt_e164 is not null and exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.alt_e164) then 'الرقم البديل مسجل لعميل آخر'
                       else 'رقم مشابه لرقم مسجل برمز دولة مختلف' end
   where r.batch_id = p_batch and r.status = 'new' and (p_row is null or r.id = p_row)
     and (coalesce(btrim(r.name),'') = '' or not r.phone_valid
          or (r.alt_e164 is not null and exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.alt_e164))
          or exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value <> r.phone_e164
                       and right(regexp_replace(ci.value,'\D','','g'), 9) = right(regexp_replace(r.phone_e164,'\D','','g'), 9)));

  -- differences against the existing client, shown ONLY if the importer is allowed to see that client
  update import_rows r set diff = nullif(jsonb_strip_nulls(jsonb_build_object(
      'name', case when coalesce(btrim(r.name),'') <> '' and lower(btrim(r.name)) <> lower(btrim(c.name)) then jsonb_build_object('existing', c.name, 'file', r.name) end,
      'business_name', case when coalesce(btrim(r.business_name),'') <> '' and lower(btrim(r.business_name)) <> lower(coalesce(btrim(c.business_name),'')) then jsonb_build_object('existing', c.business_name, 'file', r.business_name) end,
      'store', case when r.store_key is not null and not exists (select 1 from client_stores s where s.client_id = c.id and s.url_key = r.store_key) then jsonb_build_object('existing', null, 'file', r.store_url) end)), '{}'::jsonb)
    from clients c
   where r.batch_id = p_batch and r.status = 'duplicate' and r.existing_client_id = c.id and (p_row is null or r.id = p_row)
     and (app.is_admin() or exists (select 1 from leads l where l.client_id = c.id and app.lead_visible(l.id)));
  update import_rows r set existing_owner_name = null, reason = 'الرقم مسجل لدى موظف آخر (لا تملك صلاحية رؤية تفاصيله)'
   where r.batch_id = p_batch and r.status = 'duplicate' and r.existing_client_id is not null and (p_row is null or r.id = p_row)
     and not (app.is_admin() or exists (select 1 from leads l where l.client_id = r.existing_client_id and app.lead_visible(l.id)));
  perform app._import_totals(p_batch);
end $$;

create or replace function app._import_totals(p_batch uuid) returns void language sql security definer set search_path = public, app as $$
  update import_batches b set
    rows_total = (select count(*) from import_rows where batch_id = b.id),
    c_new = (select count(*) from import_rows where batch_id = b.id and status = 'new'),
    c_duplicate = (select count(*) from import_rows where batch_id = b.id and status = 'duplicate'),
    c_invalid = (select count(*) from import_rows where batch_id = b.id and status = 'invalid'),
    c_review = (select count(*) from import_rows where batch_id = b.id and status = 'review'),
    c_imported = (select count(*) from import_rows where batch_id = b.id and status = 'imported'),
    c_skipped = (select count(*) from import_rows where batch_id = b.id and status = 'skipped'),
    c_updated = (select count(*) from import_rows where batch_id = b.id and status = 'updated'),
    c_error = (select count(*) from import_rows where batch_id = b.id and status = 'error')
  where b.id = p_batch
$$;

-- ───────── 1) stage a parsed file ─────────
create or replace function app.import_create(p_header jsonb, p_rows jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_owner uuid := (p_header->>'data_owner_id')::uuid; v_batch uuid; v_hash text := p_header->>'file_hash';
begin
  if app.me() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (app.has_perm('import.any') or (app.has_perm('import.own') and v_owner = app.me())) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from employees e join users u on u.id = e.id where e.id = v_owner and u.is_active) then raise exception 'invalid target employee'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'empty file'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'too many rows'; end if;
  if exists (select 1 from import_batches b where b.file_hash = v_hash and b.data_owner_id = v_owner and b.status in ('importing','completed')) then
    raise exception 'file already imported';
  end if;
  perform set_config('app.reason', 'تجهيز استيراد ملف', true);
  insert into import_batches(file_name, file_hash, file_size, file_kind, data_owner_id, original_employee_name, default_country, mapping, imported_by)
  values (left(p_header->>'file_name', 200), v_hash, coalesce((p_header->>'file_size')::int, 0), p_header->>'file_kind', v_owner,
          nullif(btrim(p_header->>'original_employee_name'),''), coalesce(nullif(p_header->>'default_country',''),'SA'), coalesce(p_header->'mapping','{}'), app.me())
  returning id into v_batch;
  insert into import_rows(batch_id, row_no, raw, name, business_name, phone_raw, phone_e164, phone_country, phone_valid, alt_e164, alt_country, store_url, store_key, source, status_text, notes, original_added, date_text)
  select v_batch, x.row_no, coalesce(x.raw,'{}'), nullif(btrim(x.name),''), nullif(btrim(x.business_name),''), x.phone_raw, x.phone_e164, x.phone_country, coalesce(x.phone_valid,false),
         x.alt_e164, x.alt_country, nullif(btrim(x.store_url),''), x.store_key, nullif(btrim(x.source),''), nullif(btrim(x.status_text),''), nullif(btrim(x.notes),''), x.original_added, x.date_text
  from jsonb_to_recordset(p_rows) as x(row_no int, raw jsonb, name text, business_name text, phone_raw text, phone_e164 text, phone_country text, phone_valid boolean,
                                         alt_e164 text, alt_country text, store_url text, store_key text, source text, status_text text, notes text, original_added date, date_text text);
  perform app._import_classify(v_batch);
  return v_batch;
end $$;

-- fix one row in the preview (name / phone) and re-classify it
create or replace function app.import_fix_row(p_row bigint, p_name text, p_phone_e164 text, p_country text, p_valid boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_batch uuid; v_status text;
begin
  select batch_id, status into v_batch, v_status from import_rows where id = p_row;
  if v_batch is null or not app._import_can(v_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if (select status from import_batches where id = v_batch) <> 'staged' then raise exception 'batch is not editable'; end if;
  if v_status not in ('invalid','review','new','duplicate') then raise exception 'row is not editable'; end if;
  update import_rows set name = coalesce(nullif(btrim(p_name),''), name), phone_e164 = coalesce(p_phone_e164, phone_e164), phone_country = coalesce(p_country, phone_country),
         phone_valid = case when p_phone_e164 is not null then coalesce(p_valid,false) else phone_valid end,
         phone_raw = case when p_phone_e164 is not null then p_phone_e164 else phone_raw end where id = p_row;
  perform app._import_classify(v_batch, p_row);
end $$;

create or replace function app.import_skip_row(p_row bigint, p_skip boolean default true) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_batch uuid;
begin
  select batch_id into v_batch from import_rows where id = p_row;
  if v_batch is null or not app._import_can(v_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if (select status from import_batches where id = v_batch) <> 'staged' then raise exception 'batch is not editable'; end if;
  if p_skip then update import_rows set status = 'skipped', reason = 'تخطّيته يدويًا' where id = p_row and status in ('new','review','invalid','duplicate');
  else update import_rows set status = 'new' where id = p_row and status = 'skipped'; perform app._import_classify(v_batch, p_row); end if;
  perform app._import_totals(v_batch);
end $$;

create or replace function app.import_cancel(p_batch uuid) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not app._import_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  update import_batches set status = 'cancelled', finished_at = now() where id = p_batch and status = 'staged';
end $$;

-- ───────── 2) run: small chunks, each row isolated, safe to call again until done ─────────
create or replace function app.import_run(p_batch uuid, p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare b import_batches; r record; v_client uuid; v_lead uuid; v_created timestamptz; v_payload jsonb; v_ids jsonb; v_contacts jsonb; v_stores jsonb;
        v_sales uuid; v_role text; v_done int := 0; v_err int := 0; v_dup int := 0; v_status text; v_rem int; v_upd timestamptz;
begin
  if not app._import_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into b from import_batches where id = p_batch for update;       -- serialises double clicks / parallel tabs
  if b.status not in ('staged','importing') then raise exception 'batch is not runnable'; end if;
  if b.status = 'staged' then
    update import_batches set status = 'importing', started_at = now() where id = p_batch;
  end if;
  select ro.code into v_role from users u join roles ro on ro.id = u.role_id where u.id = b.data_owner_id;
  v_sales := case when v_role in ('sales_rep','sales_manager') then b.data_owner_id end;
  perform set_config('app.reason', 'استيراد بيانات سابقة: ' || b.file_name, true);
  for r in select * from import_rows where batch_id = p_batch and status = 'new' order by row_no limit least(greatest(coalesce(p_limit, 200), 1), 500) for update loop
    begin
      if exists (select 1 from client_identifiers ci where ci.kind = 'phone' and ci.value = r.phone_e164) then
        update import_rows set status = 'duplicate', reason = 'سُجّل الرقم أثناء الاستيراد' where id = r.id; v_dup := v_dup + 1; continue;
      end if;
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
      v_created := case when r.original_added is not null then ((r.original_added::timestamp + interval '12 hours') at time zone app.company_tz()) else now() end;
      v_status := coalesce((select s from unnest(array['New Lead','Contacted','No Answer','Interested','Not Interested','Follow-up Required','Qualified Lead','Invalid Contact']) s where s = r.status_text), 'New Lead');
      insert into clients(name, business_name, country, original_source, original_creator_id, status, created_at)
        values (coalesce(btrim(r.name),'—'), r.business_name, coalesce(nullif(split_part(coalesce(r.phone_country,''),' ',1),''),'SA'),
                coalesce(nullif(r.source,''),'imported'), b.data_owner_id, 'lead', v_created) returning id into v_client;
      perform app._write_contacts(v_client, v_payload, false);
      insert into leads(client_id, original_creator_id, current_owner_id, assigned_sales_id, lead_status, call_notes, last_contact_at, updated_by, created_at,
                        import_batch_id, imported_by, imported_at, original_employee_name, date_known)
        values (v_client, b.data_owner_id, b.data_owner_id, v_sales, v_status, r.notes, case when v_status <> 'New Lead' then v_created end, b.imported_by, v_created,
                b.id, b.imported_by, now(), b.original_employee_name, r.original_added is not null)
        returning id into v_lead;
      insert into lead_assignments(lead_id, kind, from_employee_id, to_employee_id, assigned_by, reason)
        values (v_lead, 'owner', null, b.data_owner_id, b.imported_by, 'استيراد بيانات سابقة');
      insert into lead_activities(lead_id, kind, status_to, note, created_by)
        values (v_lead, 'note', v_status, 'مستورد من ملف «' || b.file_name || '» — أضافه أصلًا: ' || coalesce(b.original_employee_name, app.emp_name(b.data_owner_id))
                 || ' — تاريخ الإضافة الأصلي: ' || coalesce(r.original_added::text, 'غير معروف') || ' — استورده: ' || app.emp_name(b.imported_by), b.imported_by);
      if v_sales is not null then perform app._ensure_deal(v_lead, v_sales, 'New Lead'); end if;
      select updated_at into v_upd from leads where id = v_lead;
      update import_rows set status = 'imported', client_id = v_client, lead_id = v_lead, lead_updated_at = v_upd, error = null where id = r.id;
      v_done := v_done + 1;
    exception
      when unique_violation then
        update import_rows set status = 'duplicate', reason = 'سُجّل الرقم أثناء الاستيراد' where id = r.id; v_dup := v_dup + 1;
      when others then
        update import_rows set status = 'error', error = left(SQLERRM, 300) where id = r.id; v_err := v_err + 1;
    end;
  end loop;
  select count(*) into v_rem from import_rows where batch_id = p_batch and status = 'new';
  if v_rem = 0 then update import_batches set status = 'completed', finished_at = now() where id = p_batch; end if;
  perform app._import_totals(p_batch);
  return jsonb_build_object('imported', v_done, 'duplicates', v_dup, 'errors', v_err, 'remaining', v_rem, 'done', v_rem = 0);
end $$;

-- ───────── 3) update an existing client from a duplicate row: separate, admin-only, fills EMPTY fields only ─────────
create or replace function app.import_apply_update(p_row bigint) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare r import_rows; v_changed text[] := '{}'; c clients;
begin
  if not app.has_perm('import.any') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from import_rows where id = p_row for update;
  if not found or r.status <> 'duplicate' or r.existing_client_id is null then raise exception 'row is not an updatable duplicate'; end if;
  select * into c from clients where id = r.existing_client_id for update;
  perform set_config('app.reason', 'تحديث عميل موجود من ملف استيراد (حقول فارغة فقط)', true);
  if c.business_name is null and r.business_name is not null then update clients set business_name = r.business_name where id = c.id; v_changed := array_append(v_changed, 'business_name'); end if;
  if r.store_key is not null and not exists (select 1 from client_stores s where s.client_id = c.id and s.url_key = r.store_key) then
    insert into client_stores(client_id, url_raw, url_key) values (c.id, r.store_url, r.store_key);
    insert into client_identifiers(client_id, kind, value, label) values (c.id, 'store', r.store_key, 'store') on conflict do nothing;
    v_changed := array_append(v_changed, 'store');
  end if;
  update import_rows set status = 'updated', reason = 'تم تحديث الحقول الفارغة: ' || coalesce(array_to_string(v_changed, '، '), '') where id = p_row;
  perform app._import_totals(r.batch_id);
  return jsonb_build_object('changed', to_jsonb(v_changed));
end $$;

-- ───────── 4) soft rollback of one batch ─────────
-- Leads that nobody touched since the import are hidden + their phone numbers released (so the file can be imported again).
-- Anything modified later (status, notes, hand-off, meetings, follow-ups, deals) is left exactly as it is.
create or replace function app.import_rollback(p_batch uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare b import_batches; r record; v_ok int := 0; v_kept int := 0; v_untouched boolean;
begin
  if not app._import_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into b from import_batches where id = p_batch for update;
  if b.status not in ('completed','importing') then raise exception 'batch is not rollbackable'; end if;
  perform set_config('app.reason', 'تراجع عن استيراد: ' || p_reason, true);
  for r in select ir.*, l.updated_at cur_upd from import_rows ir join leads l on l.id = ir.lead_id where ir.batch_id = p_batch and ir.status = 'imported' loop
    v_untouched := r.cur_upd = r.lead_updated_at
      and (select count(*) from lead_activities a where a.lead_id = r.lead_id) = 1
      and not exists (select 1 from lead_handoffs h where h.lead_id = r.lead_id)
      and not exists (select 1 from meetings m where m.lead_id = r.lead_id)
      and not exists (select 1 from follow_ups f where f.lead_id = r.lead_id)
      and not exists (select 1 from deal_stage_history dh join deals d on d.id = dh.deal_id where d.lead_id = r.lead_id and dh.to_stage <> 'New Lead')
      and not exists (select 1 from client_contacts cc where cc.client_id = r.client_id and cc.created_at > r.cur_upd);
    if v_untouched then
      update leads set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, app.me()), hidden_reason = 'تراجع عن استيراد: ' || p_reason, import_rolled_back_at = now(), archived_at = now() where id = r.lead_id;
      delete from client_identifiers where client_id = r.client_id;
      update clients set status = 'archived', archived_at = now() where id = r.client_id;
      update import_rows set status = 'rolled_back', reason = 'تم التراجع' where id = r.id;
      v_ok := v_ok + 1;
    else
      v_kept := v_kept + 1;
    end if;
  end loop;
  update import_batches set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = app.me(),
         rollback_note = p_reason || ' — تم التراجع عن ' || v_ok || ' وأُبقي ' || v_kept || ' لأنه عُدّل بعد الاستيراد' where id = p_batch;
  perform app._import_totals(p_batch);
  return jsonb_build_object('rolled_back', v_ok, 'kept', v_kept);
end $$;

-- ───────── 5) reading (UI) ─────────
create or replace function app.import_batches_list(p_limit int default 50)
returns table(id uuid, file_name text, file_kind text, status text, data_owner_name text, original_employee_name text, imported_by_name text, created_at timestamptz, finished_at timestamptz,
              rows_total int, c_new int, c_duplicate int, c_invalid int, c_review int, c_imported int, c_skipped int, c_updated int, c_error int, rollback_note text)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.file_name, b.file_kind, b.status, app.emp_name(b.data_owner_id), b.original_employee_name, app.emp_name(b.imported_by), b.created_at, b.finished_at,
         b.rows_total, b.c_new, b.c_duplicate, b.c_invalid, b.c_review, b.c_imported, b.c_skipped, b.c_updated, b.c_error, b.rollback_note
  from import_batches b where app.me() is not null and (app.has_perm('import.any') or (b.imported_by = app.me() and app.has_perm('import.own')))
  order by b.created_at desc limit least(coalesce(p_limit, 50), 200)
$$;
create or replace function app.import_get(p_batch uuid) returns table(id uuid, file_name text, file_kind text, status text, data_owner_id uuid, data_owner_name text, original_employee_name text, imported_by_name text,
              created_at timestamptz, started_at timestamptz, finished_at timestamptz, default_country text, mapping jsonb, rows_total int, c_new int, c_duplicate int, c_invalid int, c_review int,
              c_imported int, c_skipped int, c_updated int, c_error int, rollback_note text)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.file_name, b.file_kind, b.status, b.data_owner_id, app.emp_name(b.data_owner_id), b.original_employee_name, app.emp_name(b.imported_by), b.created_at, b.started_at, b.finished_at,
         b.default_country, b.mapping, b.rows_total, b.c_new, b.c_duplicate, b.c_invalid, b.c_review, b.c_imported, b.c_skipped, b.c_updated, b.c_error, b.rollback_note
  from import_batches b where app._import_can(b.id) and b.id = p_batch
$$;
create or replace function app.import_rows_page(p_batch uuid, p_status text, p_limit int default 50, p_offset int default 0)
returns table(id bigint, row_no int, name text, business_name text, phone_raw text, phone_e164 text, store_url text, original_added date, date_text text, status text, reason text,
              existing_owner_name text, diff jsonb, error text, raw jsonb, total int)
language sql stable security definer set search_path = public, app as $$
  select r.id, r.row_no, r.name, r.business_name, r.phone_raw, r.phone_e164, r.store_url, r.original_added, r.date_text, r.status, r.reason, r.existing_owner_name, r.diff, r.error, r.raw,
         count(*) over()::int
  from import_rows r where app._import_can(r.batch_id) and r.batch_id = p_batch and (p_status is null or r.status = p_status)
  order by r.row_no limit least(coalesce(p_limit, 50), 5000) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- column mapping can be changed in the preview: the importer re-sends the normalised values (computed from the stored raw cells) and the batch is re-classified
create or replace function app.import_apply_mapping(p_batch uuid, p_mapping jsonb, p_rows jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not app._import_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if (select status from import_batches where id = p_batch) <> 'staged' then raise exception 'batch is not editable'; end if;
  update import_batches set mapping = p_mapping, default_country = coalesce(nullif(p_mapping->>'default_country',''), default_country) where id = p_batch;
  update import_rows r set name = nullif(btrim(x.name),''), business_name = nullif(btrim(x.business_name),''), phone_raw = x.phone_raw, phone_e164 = x.phone_e164, phone_country = x.phone_country,
         phone_valid = coalesce(x.phone_valid,false), alt_e164 = x.alt_e164, alt_country = x.alt_country, store_url = nullif(btrim(x.store_url),''), store_key = x.store_key,
         source = nullif(btrim(x.source),''), status_text = nullif(btrim(x.status_text),''), notes = nullif(btrim(x.notes),''), original_added = x.original_added, date_text = x.date_text
    from jsonb_to_recordset(p_rows) as x(row_no int, name text, business_name text, phone_raw text, phone_e164 text, phone_country text, phone_valid boolean,
                                         alt_e164 text, alt_country text, store_url text, store_key text, source text, status_text text, notes text, original_added date, date_text text)
   where r.batch_id = p_batch and r.row_no = x.row_no and r.status in ('new','duplicate','invalid','review');
  perform app._import_classify(p_batch);
end $$;
create or replace function app.import_raw_rows(p_batch uuid) returns table(row_no int, raw jsonb)
language sql stable security definer set search_path = public, app as $$
  select r.row_no, r.raw from import_rows r where app._import_can(r.batch_id) and r.batch_id = p_batch order by r.row_no
$$;

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
revoke execute on function app.protect_leads() from ghamer_app;
revoke execute on function app.protect_meetings() from ghamer_app;
revoke execute on function app.touch_updated_at() from ghamer_app;
revoke execute on function app.set_created_month() from ghamer_app;
