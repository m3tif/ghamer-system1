-- 001_core.sql — Users, roles, permissions, teams, sessions, audit log
-- Source of truth for security: Row Level Security + column privileges + triggers.
create extension if not exists pgcrypto;
create extension if not exists citext;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ghamer_app') then
    create role ghamer_app login nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

create schema if not exists app;
grant usage on schema app to ghamer_app;
grant usage on schema public to ghamer_app;

-- ───────── session context helpers ─────────
create or replace function app.me() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create table departments (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_ar text not null,
  name_en text not null
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_ar text not null,
  name_en text not null,
  department_id uuid references departments(id),
  is_manager boolean not null default false,
  mfa_required boolean not null default false
);

create table permissions (
  key text primary key,
  description text not null
);

create table role_permissions (
  role_id uuid not null references roles(id),
  permission_key text not null references permissions(key),
  scope text not null default 'own' check (scope in ('own','team','all')),
  primary key (role_id, permission_key)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  password_hash text not null,
  role_id uuid not null references roles(id),
  is_active boolean not null default true,
  mfa_secret_enc text,
  mfa_enabled boolean not null default false,
  must_change_password boolean not null default false,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table employees (
  id uuid primary key references users(id),
  full_name text not null,
  phone text,
  job_title text,
  department_id uuid references departments(id),
  hired_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_memberships (
  manager_id uuid not null references employees(id),
  member_id uuid not null references employees(id),
  created_at timestamptz not null default now(),
  primary key (manager_id, member_id),
  check (manager_id <> member_id)
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash text unique not null,
  mfa_verified boolean not null default false,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index on sessions(user_id);

-- ───────── Audit log (append-only) ─────────
create table audit_logs (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text
);
create index on audit_logs(entity_type, entity_id);
create index on audit_logs(actor_id, at desc);
create index on audit_logs(at desc);

create or replace function app.audit_block_changes() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function app.audit_block_changes();
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function app.audit_block_changes();

-- Generic row-level audit trigger. TG_ARGV = columns to strip (secrets).
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_old jsonb; v_new jsonb; v_id text; o jsonb; n jsonb; k text;
begin
  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  else
    v_old := to_jsonb(OLD);
  end if;
  for i in 0 .. coalesce(TG_NARGS,0) - 1 loop
    k := TG_ARGV[i];
    v_new := v_new - k;
    if v_old is not null then v_old := v_old - k; end if;
  end loop;
  v_id := coalesce(coalesce(v_new, v_old)->>'id',
          concat_ws(':', coalesce(v_new, v_old)->>'manager_id', coalesce(v_new, v_old)->>'member_id',
                         coalesce(v_new, v_old)->>'role_id', coalesce(v_new, v_old)->>'permission_key'));
  if TG_OP = 'UPDATE' then
    select jsonb_object_agg(e.key, v_old->e.key), jsonb_object_agg(e.key, e.value)
      into o, n from jsonb_each(v_new) e where (v_old->e.key) is distinct from e.value;
    if n is null then return NEW; end if;
    v_old := o; v_new := n;
  end if;
  insert into audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (app.me(), TG_OP, TG_TABLE_NAME, v_id, v_old, v_new, nullif(current_setting('app.reason', true), ''));
  return coalesce(NEW, OLD);
end $$;

create trigger audit_users after insert or update on users
  for each row execute function app.audit_row('password_hash','mfa_secret_enc');
create trigger audit_employees after insert or update on employees
  for each row execute function app.audit_row();
create trigger audit_team after insert or delete on team_memberships
  for each row execute function app.audit_row();
create trigger audit_role_permissions after insert or update on role_permissions
  for each row execute function app.audit_row();
create trigger audit_settings after insert or update on settings
  for each row execute function app.audit_row();
