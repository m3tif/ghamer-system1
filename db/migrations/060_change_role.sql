-- 060: the super admin can change an employee's role (e.g. tele sales → sales) from the employees page.
-- The new role's permissions apply on the employee's next page load; the department follows the role; the team
-- (direct manager) is set in the same step; the reason is kept in the audit log; the employee is notified.
-- Nothing he owns moves: his clients, follow-ups and history stay with him («نقل العمل المفتوح» moves them if wanted).
begin;
create or replace function app.set_employee_role(p_user uuid, p_role text, p_manager uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_role roles; v_old text;
begin
  if not (app.is_super() and app.has_perm('employees.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_user = app.me() then raise exception 'cannot change own role'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select r.code into v_old from users u join roles r on r.id = u.role_id where u.id = p_user;
  if v_old is null then raise exception 'unknown employee'; end if;
  if v_old = 'super_admin' then raise exception 'cannot change the system admin role'; end if;
  select * into v_role from roles where code = p_role;
  if v_role.id is null or p_role = 'super_admin' then raise exception 'unknown role'; end if;
  if p_manager is not null and (p_manager = p_user or not exists (select 1 from users where id = p_manager and is_active)) then raise exception 'bad manager'; end if;
  perform set_config('app.reason', btrim(p_reason), true);
  update users set role_id = v_role.id where id = p_user;
  update employees set department_id = v_role.department_id where id = p_user;
  delete from team_memberships where member_id = p_user;
  if p_manager is not null then insert into team_memberships(manager_id, member_id) values (p_manager, p_user); end if;
  perform app._notify(p_user, 'role_changed', 'اتغيّر دورك في السيستم', 'دورك بقى: ' || v_role.name_ar, '/', 'role:' || p_user || ':' || extract(epoch from now())::bigint);
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
grant execute on function app._tech_ops_role(text) to ghamer_app;
commit;
