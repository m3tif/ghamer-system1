-- 017_force_delete_employee.sql — delete an employee even if they have records (Super Admin only).
-- 1) every client the employee originally added is deleted completely (same as app.delete_client);
-- 2) any other reference to the employee on other people's records (activities, meetings, deals, follow-ups...) is
--    detached: nullable columns become empty, required ones point to the Super Admin who performed the deletion;
-- 3) the account itself is removed. Everything is written to the audit log with a summary.
drop function if exists app.delete_employee(uuid, text);

create or replace function app.delete_employee(p_user uuid, p_reason text, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public, app, pg_catalog as $$
declare v_hist jsonb; v_name text; v_email text; v_role text; v_supers int; c record; f record; v_clients int := 0; v_detached int := 0; n bigint;
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
  if v_hist <> '{}'::jsonb and not p_force then raise exception 'has history: %', v_hist::text; end if;

  if p_force then
    perform set_config('app.reason', 'حذف موظف: ' || p_reason, true);
    for c in select distinct client_id as id from leads where original_creator_id = p_user
             union select id from clients where original_creator_id = p_user loop
      perform app.delete_client(c.id, 'حذف الموظف ' || v_name || ': ' || p_reason);
      v_clients := v_clients + 1;
    end loop;
    for f in
      select c2.conrelid::regclass::text as tbl, a.attname as col, a.attnotnull as nn
        from pg_constraint c2
        join pg_attribute a on a.attrelid = c2.conrelid and a.attnum = any(c2.conkey)
       where c2.contype = 'f' and c2.confrelid in ('public.employees'::regclass, 'public.users'::regclass)
         and c2.conrelid::regclass::text not in ('team_memberships', 'sessions', 'employees')
    loop
      if f.nn then
        execute format('update %s set %I = $2 where %I = $1', f.tbl, f.col, f.col) using p_user, app.me();
      else
        execute format('update %s set %I = null where %I = $1', f.tbl, f.col, f.col) using p_user;
      end if;
      get diagnostics n = row_count; v_detached := v_detached + n;
    end loop;
  end if;

  delete from sessions where user_id = p_user;
  delete from team_memberships where manager_id = p_user or member_id = p_user;
  delete from employees where id = p_user;
  delete from users where id = p_user;
  insert into audit_logs(actor_id, action, entity_type, entity_id, old_value, reason)
    values (app.me(), 'DELETE', 'employees', p_user::text,
            jsonb_build_object('name', v_name, 'email', v_email, 'role', v_role, 'had_history', v_hist, 'clients_deleted', v_clients, 'references_detached', v_detached), p_reason);
  return jsonb_build_object('name', v_name, 'clients_deleted', v_clients, 'references_detached', v_detached);
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
