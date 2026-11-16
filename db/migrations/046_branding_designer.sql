-- 046: Branding Designer role; the «الهوية البصرية» step of the full package goes to it
begin;
insert into roles(code, name_ar, name_en, department_id, is_manager, mfa_required)
select 'branding_designer', 'براندينج ديزاينر', 'Branding Designer', (select id from departments where code = 'technical'), false, false
on conflict (code) do update set name_ar = excluded.name_ar;
insert into role_permissions(role_id, permission_key, scope)
select r.id, p.k, 'own' from roles r cross join (values ('tasks.view_own'), ('time.log')) p(k) where r.code = 'branding_designer' on conflict do nothing;

create or replace function app._tech_role(p_emp uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from users u join roles r on r.id = u.role_id where u.id = p_emp and u.is_active
     and r.code in ('seo_specialist','ui_designer','developer','designer','branding_designer','content_creator','media_buyer','social_media_manager','technical_employee','technical_team_leader'))
$$;

update task_templates set role_code = 'branding_designer', description = 'البراندينج ديزاينر يجهّز الهوية، وبتوصل للكونتنت كريتور من خلال الأكاونت مانجر.'
 where service_code = 'full_service' and title = 'الهوية البصرية (البراندينج)' and role_code = 'designer';

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
