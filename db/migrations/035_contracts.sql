-- 035: Phase 2, step 1 — contracts.
-- The Sales rep writes the contract for his deal (services, FINAL prices = VAT included, dates, instalments), uploads the signed
-- file and sends it to Finance. Nothing here approves money: payments, financial approval and commissions come in the next steps.
-- Phase 1 is untouched except one junction: a deal reaches «تم الاتفاق / التوقيع» only through a submitted contract.

-- ───────── services catalogue (same codes as the sales brief) ─────────
create table if not exists services (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name_ar text not null,
  is_active boolean not null default true,
  sort int not null default 0
);
insert into services(code, name_ar, sort) values
  ('social_media','إدارة السوشيال ميديا',1), ('paid_ads','الإعلانات المدفوعة',2), ('seo','SEO',3), ('branding','الهوية البصرية',4),
  ('website','تطوير مواقع',5), ('content','إنتاج محتوى',6), ('video','إنتاج فيديو',7), ('other','أخرى',99)
on conflict (code) do nothing;
alter table services enable row level security;
drop policy if exists services_read on services;
create policy services_read on services for select to ghamer_app using ((select app.me()) is not null);
revoke all on services from ghamer_app; grant select on services to ghamer_app;

-- ───────── contracts ─────────
create table if not exists contract_counters (year int primary key, last int not null);
revoke all on contract_counters from ghamer_app;

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  contract_no text not null unique,
  deal_id uuid not null references deals(id),
  client_id uuid not null references clients(id),
  lead_id uuid not null references leads(id),
  sales_owner_id uuid not null references employees(id),       -- the Sales rep who closed it
  tele_sales_id uuid references employees(id),                 -- the Tele who brought / handed the client (kept for her commission)
  status text not null default 'draft' check (status in ('draft','submitted','returned','approved','cancelled')),
  package text not null default 'monthly' check (package in ('monthly','quarterly','semiannual','annual','one_time','custom')),
  duration_months int check (duration_months between 1 and 120),
  start_date date, end_date date,
  agreed_at date,
  prices_include_vat boolean not null default true,
  vat_rate numeric(5,4) not null check (vat_rate >= 0 and vat_rate < 1),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),   -- what the client pays in the end (VAT inside)
  net_amount numeric(12,2) not null default 0,                               -- service value without VAT (basis for commissions / revenue)
  vat_amount numeric(12,2) not null default 0,
  payment_method text check (payment_method in ('bank_transfer','cash','card','payment_link','other')),
  payment_terms text check (length(payment_terms) <= 2000),
  notes text check (length(notes) <= 4000),
  return_reason text,
  created_by uuid references employees(id), created_at timestamptz not null default now(),
  updated_by uuid references employees(id), updated_at timestamptz not null default now(),
  submitted_by uuid references employees(id), submitted_at timestamptz,
  returned_by uuid references employees(id), returned_at timestamptz,
  approved_by uuid references employees(id), approved_at timestamptz,
  cancelled_by uuid references employees(id), cancelled_at timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date),
  check (abs(total_amount - net_amount - vat_amount) < 0.005)
);
create unique index if not exists contracts_one_active_per_deal on contracts(deal_id) where status <> 'cancelled';
create index if not exists contracts_status on contracts(status, created_at desc);
create index if not exists contracts_sales on contracts(sales_owner_id);
create index if not exists contracts_client on contracts(client_id);

create table if not exists contract_services (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id),
  service_code text not null references services(code),
  description text check (length(description) <= 500),
  amount numeric(12,2) not null check (amount > 0),     -- final price of this service (VAT inside)
  sort int not null default 0
);
create index if not exists contract_services_contract on contract_services(contract_id);

create table if not exists payment_installments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id),
  seq int not null,
  kind text not null default 'installment' check (kind in ('down_payment','installment','full')),
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  note text check (length(note) <= 300),
  unique (contract_id, seq)
);

-- files: meta in attachments (already there from the first design), bytes in a separate table so lists never drag them along
alter table attachments add column if not exists kind text not null default 'other';
create index if not exists attachments_entity on attachments(entity_type, entity_id);
create table if not exists attachment_blobs (attachment_id uuid primary key references attachments(id), content bytea not null);

-- ───────── who may see a contract ─────────
create or replace function app.contract_visible(p_sales uuid, p_status text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and app.has_perm('contracts.view') and (
    app.is_admin()
    or app.role_code() in ('finance_manager','finance_employee')
    or (app.role_code() = 'operations_manager' and p_status = 'approved')
    or p_sales = app.me()
    or (app.role_code() = 'sales_manager' and app.is_report(p_sales)))
$$;

alter table contracts enable row level security;
alter table contract_services enable row level security;
alter table payment_installments enable row level security;
alter table attachments enable row level security;
alter table attachment_blobs enable row level security;
drop policy if exists contracts_read on contracts;
create policy contracts_read on contracts for select to ghamer_app using (app.contract_visible(sales_owner_id, status));
drop policy if exists contract_services_read on contract_services;
create policy contract_services_read on contract_services for select to ghamer_app using (exists (select 1 from contracts c where c.id = contract_id));
drop policy if exists installments_read on payment_installments;
create policy installments_read on payment_installments for select to ghamer_app using (exists (select 1 from contracts c where c.id = contract_id));
drop policy if exists attachments_read on attachments;
create policy attachments_read on attachments for select to ghamer_app using (entity_type = 'contract' and exists (select 1 from contracts c where c.id = entity_id));
-- every write goes through the functions below; the file bytes are never readable directly
revoke all on contracts, contract_services, payment_installments, attachments, attachment_blobs from ghamer_app;
grant select on contracts, contract_services, payment_installments, attachments to ghamer_app;

drop trigger if exists audit_contracts on contracts;
create trigger audit_contracts after insert or update or delete on contracts for each row execute function app.audit_row('updated_at');
drop trigger if exists audit_contract_services on contract_services;
create trigger audit_contract_services after insert or update or delete on contract_services for each row execute function app.audit_row();
drop trigger if exists audit_installments on payment_installments;
create trigger audit_installments after insert or update or delete on payment_installments for each row execute function app.audit_row();
drop trigger if exists audit_attachments on attachments;
create trigger audit_attachments after insert or update or delete on attachments for each row execute function app.audit_row();
drop trigger if exists contracts_touch on contracts;
create trigger contracts_touch before update on contracts for each row execute function app.touch_updated_at();

-- ───────── helpers ─────────
create or replace function app._contract_no() returns text language plpgsql security definer set search_path = public, app as $$
declare y int := extract(year from (now() at time zone app.company_tz()))::int; n int;
begin
  insert into contract_counters(year, last) values (y, 1)
    on conflict (year) do update set last = contract_counters.last + 1 returning last into n;
  return 'GH-' || y || '-' || lpad(n::text, 4, '0');
end $$;

-- the Tele who gets the credit for this client: the one whose hand-off Sales accepted, else the Tele who added the client
create or replace function app._tele_for_lead(p_lead uuid) returns uuid language sql stable security definer set search_path = public, app as $$
  select coalesce(
    (select h.from_employee_id from lead_handoffs h join users u on u.id = h.from_employee_id join roles r on r.id = u.role_id
      where h.lead_id = p_lead and h.status = 'accepted' and r.code in ('tele_sales','tele_sales_manager') order by h.decided_at desc nulls last, h.handed_at desc limit 1),
    (select l.original_creator_id from leads l join users u on u.id = l.original_creator_id join roles r on r.id = u.role_id
      where l.id = p_lead and r.code in ('tele_sales','tele_sales_manager')))
$$;

-- may the current user write this deal's contract? (the deal's Sales rep, his manager, or the admin)
create or replace function app._contract_can_write(p_owner uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.me() is not null and (app.has_perm('contracts.manage') or (app.has_perm('deals.edit') and app.deal_visible(p_owner)))
$$;

-- ───────── save (create / edit while it is still with Sales) ─────────
create or replace function app.contract_save(p_deal uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare d deals; c contracts; v_id uuid; v_vat numeric; v_items jsonb := coalesce(p->'items', '[]'::jsonb); v_inst jsonb := coalesce(p->'installments', '[]'::jsonb);
        v_sum numeric := 0; v_disc numeric := coalesce(nullif(p->>'discount','')::numeric, 0); v_total numeric; v_net numeric; it jsonb; i int := 0; v_isum numeric := 0;
        v_start date := nullif(p->>'start_date','')::date; v_end date := nullif(p->>'end_date','')::date; v_months int := nullif(p->>'duration_months','')::int;
        v_pkg text := coalesce(nullif(p->>'package',''), 'monthly');
begin
  select * into d from deals where id = p_deal for update;
  if not found or not app._contract_can_write(d.owner_sales_id) then raise exception 'no access' using errcode = '42501'; end if;
  if d.stage in ('Lost','Financially Approved') then raise exception 'deal is closed'; end if;
  select * into c from contracts where deal_id = p_deal and status <> 'cancelled' for update;
  if found and c.status not in ('draft','returned') then raise exception 'contract is locked: it is with Finance'; end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'contract needs at least one service'; end if;
  if jsonb_array_length(v_items) > 30 or jsonb_array_length(v_inst) > 60 then raise exception 'too many rows'; end if;
  for it in select * from jsonb_array_elements(v_items) loop
    if coalesce(nullif(it->>'amount','')::numeric, 0) <= 0 then raise exception 'service price must be greater than zero'; end if;
    if not exists (select 1 from services s where s.code = it->>'service' and s.is_active) then raise exception 'invalid service'; end if;
    v_sum := v_sum + round((it->>'amount')::numeric, 2);
  end loop;
  if v_disc < 0 or v_disc >= v_sum then raise exception 'invalid discount'; end if;
  v_total := v_sum - round(v_disc, 2);
  v_vat := (select (value #>> '{}')::numeric from settings where key = 'vat_rate');
  v_net := round(v_total / (1 + v_vat), 2);                       -- prices are final: the VAT is inside them
  if v_months is not null and (v_months < 1 or v_months > 120) then raise exception 'invalid duration'; end if;
  if v_end is null and v_start is not null and v_months is not null then v_end := (v_start + make_interval(months => v_months) - interval '1 day')::date; end if;
  if v_start is not null and v_end is not null and v_end < v_start then raise exception 'end date is before start date'; end if;
  for it in select * from jsonb_array_elements(v_inst) loop
    if coalesce(nullif(it->>'amount','')::numeric, 0) <= 0 or nullif(it->>'due_date','') is null then raise exception 'each instalment needs an amount and a date'; end if;
    v_isum := v_isum + round((it->>'amount')::numeric, 2);
  end loop;
  if jsonb_array_length(v_inst) > 0 and v_isum <> v_total then raise exception 'instalments must add up to the contract total'; end if;

  if c.id is null then
    insert into contracts(contract_no, deal_id, client_id, lead_id, sales_owner_id, tele_sales_id, package, duration_months, start_date, end_date, agreed_at,
                          vat_rate, discount_amount, total_amount, net_amount, vat_amount, payment_method, payment_terms, notes, created_by, updated_by)
    values (app._contract_no(), d.id, d.client_id, d.lead_id, d.owner_sales_id, app._tele_for_lead(d.lead_id), v_pkg, v_months, v_start, v_end, nullif(p->>'agreed_at','')::date,
            v_vat, round(v_disc, 2), v_total, v_net, v_total - v_net, nullif(p->>'payment_method',''), nullif(btrim(p->>'payment_terms'),''), nullif(btrim(p->>'notes'),''), app.me(), app.me())
    returning id into v_id;
  else
    v_id := c.id;
    update contracts set package = v_pkg, duration_months = v_months, start_date = v_start, end_date = v_end, agreed_at = nullif(p->>'agreed_at','')::date,
           vat_rate = v_vat, discount_amount = round(v_disc, 2), total_amount = v_total, net_amount = v_net, vat_amount = v_total - v_net,
           payment_method = nullif(p->>'payment_method',''), payment_terms = nullif(btrim(p->>'payment_terms'),''), notes = nullif(btrim(p->>'notes'),''),
           sales_owner_id = d.owner_sales_id, updated_by = app.me() where id = v_id;
    delete from contract_services where contract_id = v_id;
    delete from payment_installments where contract_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(v_items) loop
    i := i + 1;
    insert into contract_services(contract_id, service_code, description, amount, sort) values (v_id, it->>'service', nullif(btrim(it->>'description'),''), round((it->>'amount')::numeric, 2), i);
  end loop;
  i := 0;
  for it in select * from jsonb_array_elements(v_inst) loop
    i := i + 1;
    insert into payment_installments(contract_id, seq, kind, due_date, amount, note)
    values (v_id, i, coalesce(nullif(it->>'kind',''), 'installment'), (it->>'due_date')::date, round((it->>'amount')::numeric, 2), nullif(btrim(it->>'note'),''));
  end loop;
  -- a contract being written = the deal is at «العقد قيد التوقيع»
  if d.stage not in ('Contract Pending','Signed / Finance Pending') then
    update deals set stage = 'Contract Pending' where id = d.id;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (d.id, d.stage, 'Contract Pending', 'إنشاء عقد', app.me());
  end if;
  return v_id;
end $$;

-- ───────── files ─────────
create or replace function app.contract_attach(p_contract uuid, p_kind text, p_filename text, p_mime text, p_content bytea) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare c contracts; v_id uuid; v_name text := left(regexp_replace(coalesce(p_filename,''), '^.*[/\\]', ''), 150); v_head text := encode(substring(p_content from 1 for 12), 'hex');
begin
  select * into c from contracts where id = p_contract for update;
  if not found or not app.contract_visible(c.sales_owner_id, c.status) then raise exception 'no access' using errcode = '42501'; end if;
  if p_kind not in ('signed_contract','other') then raise exception 'invalid file kind'; end if;
  if not (app._contract_can_write(c.sales_owner_id) or app.has_perm('finance.record')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind = 'signed_contract' and (c.status not in ('draft','returned') or not app._contract_can_write(c.sales_owner_id)) then
    raise exception 'contract is locked: it is with Finance'; end if;
  if c.status = 'cancelled' then raise exception 'contract is cancelled'; end if;
  if p_content is null or octet_length(p_content) = 0 then raise exception 'file is empty'; end if;
  if octet_length(p_content) > 4 * 1024 * 1024 then raise exception 'file too large'; end if;
  if (select count(*) from attachments a where a.entity_type = 'contract' and a.entity_id = p_contract) >= 20 then raise exception 'too many files'; end if;
  -- the real content decides the type, not the name the browser sent
  if not ((p_mime = 'application/pdf' and v_head like '25504446%')
       or (p_mime = 'image/jpeg' and v_head like 'ffd8ff%')
       or (p_mime = 'image/png' and v_head like '89504e470d0a1a0a%')
       or (p_mime = 'image/webp' and v_head like '52494646%' and substring(v_head from 17 for 8) = '57454250')) then
    raise exception 'unsupported file type';
  end if;
  if v_name = '' then v_name := 'file'; end if;
  insert into attachments(entity_type, entity_id, storage_path, filename, mime_type, size_bytes, uploaded_by, kind)
  values ('contract', p_contract, 'db', v_name, p_mime, octet_length(p_content), app.me(), p_kind) returning id into v_id;
  insert into attachment_blobs(attachment_id, content) values (v_id, p_content);
  return v_id;
end $$;

create or replace function app.attachment_get(p_id uuid) returns table(filename text, mime_type text, content bytea)
language sql stable security definer set search_path = public, app as $$
  select a.filename, a.mime_type, b.content from attachments a join attachment_blobs b on b.attachment_id = a.id
   where a.id = p_id and a.entity_type = 'contract'
     and exists (select 1 from contracts c where c.id = a.entity_id and app.contract_visible(c.sales_owner_id, c.status))
$$;

-- ───────── send to Finance ─────────
create or replace function app.contract_submit(p_contract uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare c contracts; d deals; v_name text; u record;
begin
  select * into c from contracts where id = p_contract for update;
  if not found or not app._contract_can_write(c.sales_owner_id) then raise exception 'no access' using errcode = '42501'; end if;
  if c.status = 'submitted' then return; end if;                                   -- pressed twice: nothing happens twice
  if c.status not in ('draft','returned') then raise exception 'contract is locked: it is with Finance'; end if;
  if not exists (select 1 from attachments a where a.entity_type = 'contract' and a.entity_id = c.id and a.kind = 'signed_contract') then
    raise exception 'signed contract file required'; end if;
  if c.start_date is null or c.end_date is null then raise exception 'contract dates required'; end if;
  if c.total_amount <= 0 or not exists (select 1 from contract_services s where s.contract_id = c.id) then raise exception 'contract needs at least one service'; end if;
  if not exists (select 1 from payment_installments i where i.contract_id = c.id) then          -- no schedule written = one payment on the start date
    insert into payment_installments(contract_id, seq, kind, due_date, amount) values (c.id, 1, 'full', c.start_date, c.total_amount);
  elsif (select sum(amount) from payment_installments i where i.contract_id = c.id) <> c.total_amount then
    raise exception 'instalments must add up to the contract total';
  end if;
  select * into d from deals where id = c.deal_id for update;
  if d.stage in ('Lost','Financially Approved') then raise exception 'deal is closed'; end if;
  update contracts set status = 'submitted', submitted_by = app.me(), submitted_at = now(), agreed_at = coalesce(agreed_at, (now() at time zone app.company_tz())::date),
         return_reason = null, updated_by = app.me() where id = c.id;
  if d.stage <> 'Signed / Finance Pending' then
    update deals set stage = 'Signed / Finance Pending', closing_sales_id = d.owner_sales_id where id = d.id;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (d.id, d.stage, 'Signed / Finance Pending', 'تم إرسال العقد ' || c.contract_no || ' للمالية', app.me());
  end if;
  select cl.name into v_name from clients cl where cl.id = c.client_id;
  for u in select distinct us.id from users us join role_permissions rp on rp.role_id = us.role_id
            where us.is_active and rp.permission_key in ('finance.verify','finance.approve') and us.id <> app.me() loop
    perform app._notify(u.id, 'contract_submitted', 'عقد جديد بانتظار المراجعة المالية', c.contract_no || ' — ' || v_name || ' — ' || app.emp_name(c.sales_owner_id),
                        '/contracts/' || c.id, 'ctsub:' || c.id || ':' || extract(epoch from now())::bigint || ':' || u.id);
  end loop;
end $$;

-- ───────── Finance sends it back for a fix ─────────
create or replace function app.contract_return(p_contract uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare c contracts; d deals;
begin
  if not (app.has_perm('finance.verify') or app.has_perm('finance.approve')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  if c.status <> 'submitted' then raise exception 'contract is not waiting for Finance'; end if;
  perform set_config('app.reason', p_reason, true);
  update contracts set status = 'returned', returned_by = app.me(), returned_at = now(), return_reason = btrim(p_reason), updated_by = app.me() where id = c.id;
  select * into d from deals where id = c.deal_id for update;
  if d.stage = 'Signed / Finance Pending' then
    update deals set stage = 'Contract Pending' where id = d.id;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (d.id, d.stage, 'Contract Pending', 'المالية رجّعت العقد: ' || btrim(p_reason), app.me());
  end if;
  perform app._notify(c.sales_owner_id, 'contract_returned', 'المالية رجّعت العقد للتعديل', c.contract_no || ' — ' || btrim(p_reason), '/contracts/' || c.id, 'ctret:' || c.id || ':' || extract(epoch from now())::bigint);
end $$;

-- ───────── read ─────────
create or replace function app.contract_list(p_status text, p_q text, p_limit int, p_offset int)
returns table(id uuid, contract_no text, client_name text, business_name text, sales_name text, status text, total_amount numeric, net_amount numeric,
              start_date date, end_date date, created_at timestamptz, submitted_at timestamptz, deal_id uuid, has_signed boolean, total bigint)
language sql stable security definer set search_path = public, app as $$
  select c.id, c.contract_no, cl.name, cl.business_name, app.emp_name(c.sales_owner_id), c.status, c.total_amount, c.net_amount, c.start_date, c.end_date,
         c.created_at, c.submitted_at, c.deal_id,
         exists (select 1 from attachments a where a.entity_type = 'contract' and a.entity_id = c.id and a.kind = 'signed_contract'), count(*) over()
    from contracts c join clients cl on cl.id = c.client_id
   where app.contract_visible(c.sales_owner_id, c.status)
     and (coalesce(p_status,'') = '' or c.status = p_status)
     and (coalesce(btrim(p_q),'') = '' or c.contract_no ilike '%' || btrim(p_q) || '%' or app.client_matches(c.client_id, p_q))
   order by (c.status = 'submitted') desc, coalesce(c.submitted_at, c.created_at) desc, c.contract_no desc
   limit least(coalesce(p_limit, 20), 100) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function app.contract_get(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'contract', to_jsonb(c) || jsonb_build_object('client_name', cl.name, 'business_name', cl.business_name,
        'store_url', (select s.url_raw from client_stores s where s.client_id = cl.id order by s.created_at limit 1),
        'phone', (select cc.phone from client_contacts cc where cc.client_id = cl.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1),
        'sales_name', app.emp_name(c.sales_owner_id), 'tele_name', app.emp_name(c.tele_sales_id),
        'created_by_name', app.emp_name(c.created_by), 'submitted_by_name', app.emp_name(c.submitted_by), 'returned_by_name', app.emp_name(c.returned_by),
        'deal_stage', d.stage, 'can_write', app._contract_can_write(c.sales_owner_id)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('service', s.service_code, 'service_name', sv.name_ar, 'description', s.description, 'amount', s.amount) order by s.sort), '[]')
                from contract_services s join services sv on sv.code = s.service_code where s.contract_id = c.id),
    'installments', (select coalesce(jsonb_agg(jsonb_build_object('seq', i.seq, 'kind', i.kind, 'due_date', i.due_date, 'amount', i.amount, 'note', i.note) order by i.seq), '[]')
                from payment_installments i where i.contract_id = c.id),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'filename', a.filename, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes,
                'uploaded_by', app.emp_name(a.uploaded_by), 'created_at', a.created_at) order by a.created_at desc), '[]')
                from attachments a where a.entity_type = 'contract' and a.entity_id = c.id))
    from contracts c join clients cl on cl.id = c.client_id join deals d on d.id = c.deal_id
   where c.id = p_id and app.contract_visible(c.sales_owner_id, c.status)
$$;

-- the contract of a deal (for the deal page)
create or replace function app.deal_contract(p_deal uuid) returns table(id uuid, contract_no text, status text, total_amount numeric)
language sql stable security definer set search_path = public, app as $$
  select c.id, c.contract_no, c.status, c.total_amount from contracts c
   where c.deal_id = p_deal and c.status <> 'cancelled' and app.contract_visible(c.sales_owner_id, c.status)
$$;

-- ───────── the one junction with Phase 1: the deal stage machine ─────────
CREATE OR REPLACE FUNCTION app.move_deal_stage(p_deal uuid, p_to text, p_reason text, p_followup timestamp with time zone, p_followup_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
declare d deals; c contracts;
begin
  if not app.has_perm('deals.edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from deals where id = p_deal for update;
  if not found or not app.deal_visible(d.owner_sales_id) then raise exception 'no access' using errcode = '42501'; end if;
  if d.stage = p_to then return; end if;
  if d.stage in ('Lost','Financially Approved') then raise exception 'deal is closed'; end if;
  select * into c from contracts where deal_id = p_deal and status <> 'cancelled' for update;
  -- «تم الاتفاق / التوقيع» is reached only by sending the signed contract to Finance
  if p_to = 'Signed / Finance Pending' then raise exception 'signed stage needs a contract: send the signed contract to Finance'; end if;
  if c.status = 'submitted' then raise exception 'contract is locked: it is with Finance'; end if;
  if p_to = 'Financially Approved' then
    raise exception 'financial approval is done by Finance only' using errcode = '42501';
  end if;
  if p_to = 'Lost' and coalesce(btrim(p_reason),'') = '' then raise exception 'reason required for Lost'; end if;
  if p_to in ('Postponed','Follow-up') then
    if p_followup is null or coalesce(btrim(p_followup_reason),'') = '' then raise exception 'follow-up date and reason required'; end if;
    insert into follow_ups(lead_id, deal_id, owner_id, due_at, reason, created_by)
      values (d.lead_id, d.id, d.owner_sales_id, p_followup, btrim(p_followup_reason), app.me());
    update leads set next_followup_at = p_followup where id = d.lead_id;
  end if;
  update deals set stage = p_to, lost_reason = case when p_to = 'Lost' then btrim(p_reason) else lost_reason end where id = p_deal;
  insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
    values (p_deal, d.stage, p_to, coalesce(nullif(btrim(p_reason),''), btrim(p_followup_reason)), app.me());
  -- a lost deal takes its unsent contract with it (kept, marked cancelled)
  if p_to = 'Lost' and c.id is not null and c.status in ('draft','returned') then
    perform set_config('app.reason', 'الصفقة خسرناها: ' || btrim(p_reason), true);
    update contracts set status = 'cancelled', cancelled_by = app.me(), cancelled_at = now(), updated_by = app.me() where id = c.id;
  end if;
end $function$;

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
