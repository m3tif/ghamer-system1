-- 016_delete_employee.sql — permanent deletion of an employee account (Super Admin only).
-- An employee that already has records (clients they added, activities, meetings, deals, imports...) cannot be deleted,
-- because the original creator is immutable history. They must be stopped instead. Accounts with no records
-- (e.g. created by mistake / never used) are removed completely.

create or replace function app.employee_history_counts(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_catalog as $$
declare f record; n bigint; r jsonb := '{}'::jsonb;
begin
  if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  for f in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid in ('public.employees'::regclass, 'public.users'::regclass)
       and c.conrelid::regclass::text not in ('team_memberships', 'sessions', 'employees')
  loop
    execute format('select count(*) from %s where %I = $1', f.tbl, f.col) into n using p_user;
    if n > 0 then r := jsonb_set(r, array[f.tbl], to_jsonb(coalesce((r ->> f.tbl)::bigint, 0) + n)); end if;
  end loop;
  return r;
end $$;

create or replace function app.delete_employee(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_catalog as $$
declare v_hist jsonb; v_name text; v_email text; v_role text; v_supers int;
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_user = app.me() then raise exception 'cannot delete self'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select e.full_name, u.email::text, ro.code into v_name, v_email, v_role
    from users u join employees e on e.id = u.id join roles ro on ro.id = u.role_id where u.id = p_user;
  if v_name is null then raise exception 'employee not found'; end if;
  if v_role = 'super_admin' then
    select count(*) into v_supers from users u join roles ro on ro.id = u.role_id where ro.code = 'super_admin' and u.is_active and u.id <> p_user;
    if v_supers = 0 then raise exception 'last super admin'; end if;
  end if;
  v_hist := app.employee_history_counts(p_user);
  if v_hist <> '{}'::jsonb then raise exception 'has history: %', v_hist::text; end if;

  delete from sessions where user_id = p_user;
  delete from team_memberships where manager_id = p_user or member_id = p_user;
  delete from employees where id = p_user;
  delete from users where id = p_user;
  insert into audit_logs(actor_id, action, entity_type, entity_id, old_value, reason)
    values (app.me(), 'DELETE', 'employees', p_user::text, jsonb_build_object('name', v_name, 'email', v_email, 'role', v_role), p_reason);
  return jsonb_build_object('name', v_name);
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
