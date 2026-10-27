-- 004_security_functions.sql — session helpers, RLS policies, business functions
-- All sensitive writes go through SECURITY DEFINER functions that re-check permissions.

-- ───────── identity helpers (definer: they read users/roles regardless of RLS) ─────────
create or replace function app.role_code() returns text language sql stable security definer set search_path = public as $$
  select r.code from users u join roles r on r.id = u.role_id where u.id = app.me() and u.is_active
$$;
create or replace function app.is_super() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(app.role_code() = 'super_admin', false) $$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(app.role_code() in ('super_admin','general_manager'), false) $$;
create or replace function app.has_perm(p text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u join role_permissions rp on rp.role_id = u.role_id
                 where u.id = app.me() and u.is_active and rp.permission_key = p)
$$;
create or replace function app.is_report(emp uuid) returns boolean language sql stable security definer set search_path = public as $$
  select emp is not null and exists (select 1 from team_memberships t where t.manager_id = app.me() and t.member_id = emp)
$$;
-- A row is visible to: admins, any of the 3 involved employees, or the manager of any of them.
create or replace function app.row_visible(a uuid, b uuid, c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when app.me() is null or app.role_code() is null then false
    when app.is_admin() then true
    when app.me() in (a, b, c) then true
    when app.role_code() in ('tele_sales_manager','sales_manager') then app.is_report(a) or app.is_report(b) or app.is_report(c)
    else false end
$$;
create or replace function app.lead_visible(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select app.row_visible(l.original_creator_id, l.current_owner_id, l.assigned_sales_id) from leads l where l.id = p_lead), false)
$$;
create or replace function app.deal_visible(p_owner uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.me() is not null and (app.is_admin() or p_owner = app.me() or (app.role_code() = 'sales_manager' and app.is_report(p_owner)))
$$;
create or replace function app.emp_name(p_id uuid) returns text language sql stable security definer set search_path = public as
$$ select full_name from employees where id = p_id $$;

-- ───────── enable RLS ─────────
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- reference tables: readable by all signed-in app users
create policy ref_read on departments for select to ghamer_app using (app.me() is not null);
create policy ref_read on roles for select to ghamer_app using (app.me() is not null);
create policy ref_read on permissions for select to ghamer_app using (app.me() is not null);
create policy ref_read on role_permissions for select to ghamer_app using (app.me() is not null);
create policy rp_write on role_permissions for insert to ghamer_app with check (app.is_super() and app.has_perm('roles.manage'));
create policy rp_update on role_permissions for update to ghamer_app using (app.is_super() and app.has_perm('roles.manage')) with check (app.is_super());
create policy settings_read on settings for select to ghamer_app using (app.me() is not null);
create policy settings_write on settings for insert to ghamer_app with check (app.is_super());
create policy settings_update on settings for update to ghamer_app using (app.is_super()) with check (app.is_super());

-- employees / teams
create policy emp_read on employees for select to ghamer_app
  using (id = app.me() or app.is_admin() or app.is_report(id));
create policy team_read on team_memberships for select to ghamer_app
  using (manager_id = app.me() or member_id = app.me() or app.is_admin());

-- clients & children (visible when any lead of the client is visible)
create policy clients_read on clients for select to ghamer_app
  using (app.me() is not null and (app.is_admin() or original_creator_id = app.me()
         or exists (select 1 from leads l where l.client_id = clients.id)));
create policy clients_update on clients for update to ghamer_app
  using (app.has_perm('leads.edit') and exists (select 1 from leads l where l.client_id = clients.id))
  with check (app.has_perm('leads.edit'));
create policy contacts_read on client_contacts for select to ghamer_app
  using (exists (select 1 from clients c where c.id = client_contacts.client_id));
create policy stores_read on client_stores for select to ghamer_app
  using (exists (select 1 from clients c where c.id = client_stores.client_id));
-- client_identifiers: NO policy for app role (deny all). Only DEFINER functions touch it.

-- leads
create policy leads_read on leads for select to ghamer_app
  using (app.row_visible(original_creator_id, current_owner_id, assigned_sales_id));
create policy leads_update on leads for update to ghamer_app
  using (app.has_perm('leads.edit') and app.row_visible(original_creator_id, current_owner_id, assigned_sales_id))
  with check (app.has_perm('leads.edit') and app.row_visible(original_creator_id, current_owner_id, assigned_sales_id));
create policy acts_read on lead_activities for select to ghamer_app
  using (exists (select 1 from leads l where l.id = lead_activities.lead_id));
create policy acts_insert on lead_activities for insert to ghamer_app
  with check (created_by = app.me() and app.has_perm('leads.edit')
              and exists (select 1 from leads l where l.id = lead_activities.lead_id));
create policy assign_read on lead_assignments for select to ghamer_app
  using (exists (select 1 from leads l where l.id = lead_assignments.lead_id));

-- duplicate reviews
create policy dup_read on duplicate_reviews for select to ghamer_app
  using (requested_by = app.me() or app.is_admin() or (app.has_perm('duplicates.review') and app.is_report(requested_by)));

-- follow-ups
create policy fu_read on follow_ups for select to ghamer_app
  using (owner_id = app.me() or app.is_admin() or app.is_report(owner_id));
create policy fu_insert on follow_ups for insert to ghamer_app
  with check (created_by = app.me() and app.has_perm('followups.manage')
              and (owner_id = app.me() or app.is_report(owner_id))
              and exists (select 1 from leads l where l.id = follow_ups.lead_id));
create policy fu_update on follow_ups for update to ghamer_app
  using (app.has_perm('followups.manage') and (owner_id = app.me() or app.is_report(owner_id)))
  with check (owner_id = app.me() or app.is_report(owner_id));

-- meetings (written only via functions)
create policy mt_read on meetings for select to ghamer_app using (app.row_visible(tele_sales_id, sales_rep_id, null));
create policy mte_read on meeting_events for select to ghamer_app
  using (exists (select 1 from meetings m where m.id = meeting_events.meeting_id));
create policy mtp_read on meeting_participants for select to ghamer_app
  using (exists (select 1 from meetings m where m.id = meeting_participants.meeting_id));

-- deals: Tele Sales has NO access (gets only outcomes through app.my_lead_outcomes())
create policy deals_read on deals for select to ghamer_app using (app.deal_visible(owner_sales_id));
create policy deals_update on deals for update to ghamer_app
  using (app.has_perm('deals.edit') and app.deal_visible(owner_sales_id))
  with check (app.has_perm('deals.edit') and app.deal_visible(owner_sales_id));
create policy brief_read on deal_briefs for select to ghamer_app
  using (exists (select 1 from deals d where d.id = deal_briefs.deal_id));
create policy brief_update on deal_briefs for update to ghamer_app
  using (app.has_perm('deals.edit') and exists (select 1 from deals d where d.id = deal_briefs.deal_id))
  with check (app.has_perm('deals.edit'));
create policy dsh_read on deal_stage_history for select to ghamer_app
  using (exists (select 1 from deals d where d.id = deal_stage_history.deal_id));

-- targets
create policy tg_read on targets for select to ghamer_app
  using (employee_id = app.me() or app.is_admin() or app.is_report(employee_id));
create policy tg_insert on targets for insert to ghamer_app
  with check (app.has_perm('targets.edit') and set_by = app.me() and (app.is_super() or app.is_report(employee_id)));
create policy tg_update on targets for update to ghamer_app
  using (app.has_perm('targets.edit') and (app.is_super() or app.is_report(employee_id)))
  with check (app.has_perm('targets.edit') and (app.is_super() or app.is_report(employee_id)));

-- notifications
create policy nt_read on notifications for select to ghamer_app using (user_id = app.me());
create policy nt_update on notifications for update to ghamer_app using (user_id = app.me()) with check (user_id = app.me());

-- audit logs: admins see all; finance manager sees financial entities only
create policy audit_read on audit_logs for select to ghamer_app
  using (app.is_admin() or (app.has_perm('audit.view') and entity_type in
        ('payments','payment_adjustments','financial_approvals','commissions','commission_rules','contracts','employee_cost_rates')));

-- ───────── table privileges (no DELETE anywhere) ─────────
grant select on departments, roles, permissions, role_permissions, settings, employees, team_memberships,
  clients, client_contacts, client_stores, leads, lead_activities, lead_assignments, duplicate_reviews,
  follow_ups, meetings, meeting_events, meeting_participants, deals, deal_briefs, deal_stage_history,
  targets, notifications, audit_logs to ghamer_app;
grant insert, update on role_permissions, settings to ghamer_app;
grant update (name, business_name, industry, country, city, contact_person, status) on clients to ghamer_app;
grant update (lead_status, required_services, call_notes, next_followup_at, last_contact_at, updated_by) on leads to ghamer_app;
grant insert on lead_activities to ghamer_app;
grant insert on follow_ups to ghamer_app;
grant update (due_at, reason, status, completed_at) on follow_ups to ghamer_app;
grant update (win_probability, expected_value) on deals to ghamer_app;
grant update (business_type, store_url, marketing_goals, current_problems, competitors, expected_budget,
  required_services, proposed_packages, meeting_notes, expected_decision, updated_by, updated_at) on deal_briefs to ghamer_app;
grant insert on targets to ghamer_app;
grant update (target_value) on targets to ghamer_app;
grant update (read_at) on notifications to ghamer_app;
-- users, sessions, client_identifiers, job_runs, attachments: no direct access.

-- audit triggers for contact data
create trigger audit_contacts after insert or update or delete on client_contacts for each row execute function app.audit_row();
create trigger audit_stores after insert or update or delete on client_stores for each row execute function app.audit_row();
create trigger audit_identifiers after insert or delete on client_identifiers for each row execute function app.audit_row();
