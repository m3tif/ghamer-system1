-- 005_functions_auth.sql — authentication, sessions, employee administration

create or replace function app.auth_lookup(p_email citext)
returns table(id uuid, password_hash text, is_active boolean, locked_until timestamptz,
              mfa_enabled boolean, mfa_secret_enc text, mfa_required boolean, role_code text, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.password_hash, u.is_active, u.locked_until, u.mfa_enabled, u.mfa_secret_enc,
         r.mfa_required, r.code, e.full_name
  from users u join roles r on r.id = u.role_id join employees e on e.id = u.id
  where u.email = p_email
$$;

create or replace function app.auth_fail(p_id uuid) returns void language sql security definer set search_path = public as $$
  update users set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
                   locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
  where id = p_id
$$;
create or replace function app.auth_ok(p_id uuid) returns void language sql security definer set search_path = public as
$$ update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = p_id $$;

create or replace function app.session_create(p_user uuid, p_hash text, p_mfa boolean, p_ttl_hours int, p_ip text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from sessions where user_id = p_user and expires_at < now();
  insert into sessions(user_id, token_hash, mfa_verified, ip, user_agent, expires_at)
  values (p_user, p_hash, p_mfa, p_ip, left(p_ua, 300), now() + make_interval(hours => p_ttl_hours));
end $$;

create or replace function app.session_get(p_hash text)
returns table(user_id uuid, full_name text, email citext, role_code text, role_name_ar text,
              mfa_verified boolean, mfa_required boolean, mfa_enabled boolean, must_change_password boolean, perms text[])
language plpgsql security definer set search_path = public as $$
begin
  update sessions set last_seen_at = now() where token_hash = p_hash and last_seen_at < now() - interval '1 minute';
  return query
    select u.id, e.full_name, u.email, r.code, r.name_ar, s.mfa_verified, r.mfa_required, u.mfa_enabled, u.must_change_password,
           coalesce((select array_agg(rp.permission_key) from role_permissions rp where rp.role_id = r.id), '{}')
    from sessions s join users u on u.id = s.user_id join employees e on e.id = u.id join roles r on r.id = u.role_id
    where s.token_hash = p_hash and s.expires_at > now() and u.is_active;
end $$;

create or replace function app.session_mfa_ok(p_hash text) returns void language sql security definer set search_path = public as
$$ update sessions set mfa_verified = true where token_hash = p_hash $$;
create or replace function app.session_delete(p_hash text) returns void language sql security definer set search_path = public as
$$ delete from sessions where token_hash = p_hash $$;

create or replace function app.mfa_begin(p_user uuid, p_secret_enc text) returns void language sql security definer set search_path = public as
$$ update users set mfa_secret_enc = p_secret_enc where id = p_user and not mfa_enabled $$;
create or replace function app.mfa_enable(p_user uuid) returns void language sql security definer set search_path = public as
$$ update users set mfa_enabled = true where id = p_user and mfa_secret_enc is not null $$;
create or replace function app.mfa_secret(p_user uuid) returns text language sql stable security definer set search_path = public as
$$ select mfa_secret_enc from users where id = p_user $$;

-- ───────── employee administration (Super Admin only) ─────────
create or replace function app.create_employee(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_role uuid; v_dept uuid;
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select id, department_id into v_role, v_dept from roles where code = p->>'role_code';
  if v_role is null then raise exception 'unknown role'; end if;
  insert into users(email, password_hash, role_id, must_change_password) values (lower(p->>'email'), p->>'password_hash', v_role, true) returning id into v_id;
  insert into employees(id, full_name, phone, job_title, department_id, hired_at)
  values (v_id, p->>'full_name', p->>'phone', p->>'job_title', v_dept, nullif(p->>'hired_at','')::date);
  if nullif(p->>'manager_id','') is not null then
    insert into team_memberships(manager_id, member_id) values ((p->>'manager_id')::uuid, v_id);
  end if;
  return v_id;
end $$;

create or replace function app.set_employee_active(p_user uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_user = app.me() then raise exception 'cannot change own status'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason required'; end if;
  perform set_config('app.reason', p_reason, true);
  update users set is_active = p_active where id = p_user;
  if not p_active then delete from sessions where user_id = p_user; end if;
end $$;

create or replace function app.admin_set_password(p_user uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.reason', 'password reset', true);
  update users set password_hash = p_hash, failed_attempts = 0, locked_until = null, must_change_password = true where id = p_user;
  delete from sessions where user_id = p_user;
end $$;

create or replace function app.set_manager(p_member uuid, p_manager uuid) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from team_memberships where member_id = p_member;
  if p_manager is not null then insert into team_memberships(manager_id, member_id) values (p_manager, p_member); end if;
end $$;

create or replace function app.employee_list()
returns table(id uuid, full_name text, email citext, role_code text, role_name_ar text, is_active boolean,
              mfa_enabled boolean, job_title text, phone text, manager_id uuid, manager_name text)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, u.email, r.code, r.name_ar, u.is_active, u.mfa_enabled, e.job_title, e.phone,
         t.manager_id, m.full_name
  from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
  left join team_memberships t on t.member_id = e.id left join employees m on m.id = t.manager_id
  where app.me() is not null and (app.is_admin() or e.id = app.me() or app.is_report(e.id))
  order by r.code, e.full_name
$$;

-- minimal directory for dropdowns: active sales reps (names only)
create or replace function app.sales_reps() returns table(id uuid, full_name text)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
  where app.me() is not null and u.is_active and r.code in ('sales_rep','sales_manager')
  order by e.full_name
$$;
create or replace function app.assignable_employees() returns table(id uuid, full_name text, role_code text)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.full_name, r.code from employees e join users u on u.id = e.id join roles r on r.id = u.role_id
  where u.is_active and r.code in ('tele_sales','tele_sales_manager','sales_rep','sales_manager')
    and app.me() is not null and (app.is_admin() or app.is_report(e.id) or e.id = app.me())
  order by r.code, e.full_name
$$;

-- a signed-in user changes their own password (the app verifies the old one first); other sessions are closed
create or replace function app.set_own_password(p_hash text, p_keep_token text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if app.me() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  update users set password_hash = p_hash, must_change_password = false where id = app.me();
  delete from sessions where user_id = app.me() and token_hash <> p_keep_token;
end $$;
create or replace function app.own_password_hash() returns text language sql stable security definer set search_path = public, app as
$$ select password_hash from users where id = app.me() $$;
