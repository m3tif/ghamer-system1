-- 002_crm.sql — Clients, leads, meetings, follow-ups, deals, targets, notifications
-- Phase 1 tables. Identity (clients) is separate from sales (deals) and contracts (Phase 2).

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_name text,
  industry text,
  country text not null default 'SA',
  city text,
  contact_person text,
  original_source text not null,          -- IMMUTABLE (see trigger)
  original_creator_id uuid not null references employees(id),  -- IMMUTABLE
  status text not null default 'lead' check (status in ('lead','active','churned','archived')),
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  label text not null default 'mobile' check (label in ('mobile','alt_mobile','whatsapp','email','other')),
  phone text,
  email text,
  contact_name text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index on client_contacts(client_id);

create table client_stores (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  url_raw text not null,
  url_key text not null,
  created_at timestamptz not null default now()
);
create index on client_stores(client_id);

-- One row per normalized identifier. UNIQUE(kind, value) is the DB-level duplicate guard.
create table client_identifiers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  kind text not null check (kind in ('phone','store','commercial_id')),
  value text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (kind, value)
);
create index on client_identifiers(client_id);

create table leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  original_creator_id uuid not null references employees(id),   -- IMMUTABLE
  current_owner_id uuid not null references employees(id),
  assigned_sales_id uuid references employees(id),
  lead_status text not null default 'New' check (lead_status in
    ('New','Not Answered','Call Back','Interested','Not Interested','Follow-up Later',
     'Meeting Scheduled','Meeting Completed','Invalid Contact')),
  required_services text[] not null default '{}',
  call_notes text,
  next_followup_at timestamptz,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id),
  archived_at timestamptz
);
create index on leads(client_id);
create index on leads(original_creator_id, created_at desc);
create index on leads(current_owner_id);
create index on leads(assigned_sales_id);
create index on leads(lead_status);

create table lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  kind text not null check (kind in ('call','note','status_change','meeting','assignment','duplicate_attempt')),
  status_from text,
  status_to text,
  note text,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);
create index on lead_activities(lead_id, created_at desc);

create table lead_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  kind text not null check (kind in ('owner','sales')),
  from_employee_id uuid references employees(id),
  to_employee_id uuid not null references employees(id),
  assigned_by uuid not null references employees(id),
  reason text,
  created_at timestamptz not null default now()
);
create index on lead_assignments(lead_id, created_at desc);

create table duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  existing_client_id uuid not null references clients(id),
  requested_by uuid not null references employees(id),
  attempted jsonb not null,
  matched_kinds text[] not null default '{}',
  reason text not null,
  status text not null default 'open' check (status in ('open','transferred','rejected')),
  resolved_by uuid references employees(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  deal_id uuid,
  owner_id uuid not null references employees(id),
  due_at timestamptz not null,
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on follow_ups(owner_id, status, due_at);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  tele_sales_id uuid references employees(id),     -- who brought the client. IMMUTABLE
  sales_rep_id uuid not null references employees(id),
  scheduled_at timestamptz not null,
  meeting_url text,
  booking_notes text,
  status text not null default 'Scheduled' check (status in
    ('Scheduled','Confirmed','Completed','Cancelled','Rescheduled','No Show')),
  reschedule_count int not null default 0,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on meetings(tele_sales_id, scheduled_at);
create index on meetings(sales_rep_id, scheduled_at);
-- Only one live meeting per lead at a time (re-scheduling edits the same row).
create unique index meetings_one_active_per_lead on meetings(lead_id)
  where status in ('Scheduled','Confirmed','Rescheduled');

create table meeting_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  event text not null check (event in ('created','confirmed','rescheduled','completed','cancelled','no_show','reassigned')),
  old_value jsonb,
  new_value jsonb,
  reason text,
  by_employee uuid not null references employees(id),
  at timestamptz not null default now()
);
create index on meeting_events(meeting_id, at);

create table meeting_participants (
  meeting_id uuid not null references meetings(id),
  employee_id uuid not null references employees(id),
  primary key (meeting_id, employee_id)
);

create table deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  lead_id uuid not null references leads(id),
  owner_sales_id uuid not null references employees(id),
  closing_sales_id uuid references employees(id),
  stage text not null default 'New Lead' check (stage in
    ('New Lead','Contacted','Qualified','Meeting Scheduled','Meeting Completed','Proposal Preparation',
     'Proposal Sent','Negotiation','Follow-up','Postponed','Contract Pending','Signed / Finance Pending',
     'Financially Approved','Lost')),
  win_probability int check (win_probability between 0 and 100),
  expected_value numeric(14,2),
  lost_reason text,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index on deals(owner_sales_id, stage);
create index on deals(lead_id);
alter table follow_ups add constraint follow_ups_deal_fk foreign key (deal_id) references deals(id);

create table deal_briefs (
  deal_id uuid primary key references deals(id),
  business_type text,
  store_url text,
  marketing_goals text,
  current_problems text,
  competitors text,
  expected_budget numeric(14,2),
  required_services text[] not null default '{}',
  proposed_packages text,
  meeting_notes text,
  expected_decision text,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);

create table deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  from_stage text,
  to_stage text not null,
  reason text,
  by_employee uuid not null references employees(id),
  at timestamptz not null default now()
);
create index on deal_stage_history(deal_id, at);

create table targets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  period_month date not null check (extract(day from period_month) = 1),
  metric text not null check (metric in ('completed_meetings','deals_won','contracted_revenue')),
  target_value numeric(14,2) not null check (target_value >= 0),
  set_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, period_month, metric)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references employees(id),
  kind text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index on notifications(user_id, read_at, created_at desc);

create table job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  run_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  details jsonb,
  unique (job_name, run_key)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  storage_path text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references employees(id),
  created_at timestamptz not null default now()
);

-- ───────── Immutability guards ─────────
create or replace function app.protect_clients() returns trigger language plpgsql as $$
begin
  if current_setting('app.allow_attribution_fix', true) = 'on' then return NEW; end if;
  if NEW.original_creator_id is distinct from OLD.original_creator_id
     or NEW.original_source is distinct from OLD.original_source then
    raise exception 'original_creator/original_source are immutable' using errcode = '42501';
  end if;
  return NEW;
end $$;
create or replace function app.protect_leads() returns trigger language plpgsql as $$
begin
  if current_setting('app.allow_attribution_fix', true) = 'on' then return NEW; end if;
  if NEW.original_creator_id is distinct from OLD.original_creator_id then
    raise exception 'original_creator is immutable' using errcode = '42501';
  end if;
  return NEW;
end $$;
create or replace function app.protect_meetings() returns trigger language plpgsql as $$
begin
  if NEW.tele_sales_id is distinct from OLD.tele_sales_id then
    raise exception 'tele_sales_id is immutable' using errcode = '42501';
  end if;
  return NEW;
end $$;
create trigger clients_protect before update on clients for each row execute function app.protect_clients();
create trigger leads_protect before update on leads for each row execute function app.protect_leads();
create trigger meetings_protect before update on meetings for each row execute function app.protect_meetings();

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin NEW.updated_at := now(); return NEW; end $$;
create trigger clients_touch before update on clients for each row execute function app.touch_updated_at();
create trigger leads_touch before update on leads for each row execute function app.touch_updated_at();
create trigger meetings_touch before update on meetings for each row execute function app.touch_updated_at();
create trigger deals_touch before update on deals for each row execute function app.touch_updated_at();
create trigger employees_touch before update on employees for each row execute function app.touch_updated_at();
create trigger targets_touch before update on targets for each row execute function app.touch_updated_at();

-- ───────── Audit triggers ─────────
create trigger audit_clients after insert or update on clients for each row execute function app.audit_row();
create trigger audit_leads after insert or update on leads for each row execute function app.audit_row();
create trigger audit_lead_assignments after insert on lead_assignments for each row execute function app.audit_row();
create trigger audit_meetings after insert or update on meetings for each row execute function app.audit_row();
create trigger audit_deals after insert or update on deals for each row execute function app.audit_row();
create trigger audit_targets after insert or update on targets for each row execute function app.audit_row();
create trigger audit_duplicate_reviews after insert or update on duplicate_reviews for each row execute function app.audit_row();
create trigger audit_follow_ups after insert or update on follow_ups for each row execute function app.audit_row();
