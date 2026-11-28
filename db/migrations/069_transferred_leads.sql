-- 069: transferred leads.
-- * Moving leads to another employee («إعادة توزيع عمل موظف» or a single transfer) now also un-hides them: the new owner
--   is meant to work them. Before, leads hidden for the old owner (e.g. a hidden month) stayed hidden after the move, so
--   the new owner could only find them by search, and «إظهار» on the period showed nothing (the period belongs to the old
--   owner). Leads whose distribution was undone (archived) stay as they are.
-- * «الداتا المستلمة» splits in two: what reached her by distribution, and «الداتا المنقولة» — what was moved to her from
--   another employee. Each lead is classified by how it last reached her.
begin;
do $$ declare d text; d0 text; begin
  select replace(pg_get_functiondef('app.reassign_employee(uuid,uuid,text)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, '      update leads set current_owner_id = p_to where id = r.id;',
                  '      update leads set current_owner_id = p_to,
             hidden_at = case when archived_at is null then null else hidden_at end, hidden_by = case when archived_at is null then null else hidden_by end,
             hidden_reason = case when archived_at is null then null else hidden_reason end, hidden_period_id = case when archived_at is null then null else hidden_period_id end
       where id = r.id;');
  d := replace(d, '      update leads set assigned_sales_id = p_to, current_owner_id = case when current_owner_id = p_from then p_to else current_owner_id end where id = r.id;',
                  '      update leads set assigned_sales_id = p_to, current_owner_id = case when current_owner_id = p_from then p_to else current_owner_id end,
             hidden_at = case when archived_at is null then null else hidden_at end, hidden_by = case when archived_at is null then null else hidden_by end,
             hidden_reason = case when archived_at is null then null else hidden_reason end, hidden_period_id = case when archived_at is null then null else hidden_period_id end
       where id = r.id;');
  if d = d0 or (length(d) - length(replace(d, 'hidden_period_id = case', ''))) / length('hidden_period_id = case') <> 2 then raise exception 'base changed: reassign_employee'; end if;
  -- the old owner's leads whose distribution was undone are not handed to the new one
  d := replace(d, 'for r in select id from leads where current_owner_id = p_from and handed_off_at is null loop', 'for r in select id from leads where current_owner_id = p_from and handed_off_at is null and archived_at is null loop');
  if position('handed_off_at is null and archived_at is null' in d) = 0 then raise exception 'base changed: reassign_employee (2)'; end if;
  execute d;

  select replace(pg_get_functiondef('app.transfer_lead(uuid,uuid,text,text)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, '    update leads set current_owner_id = p_to where id = p_lead;',
                  '    update leads set current_owner_id = p_to,
           hidden_at = case when archived_at is null then null else hidden_at end, hidden_by = case when archived_at is null then null else hidden_by end,
           hidden_reason = case when archived_at is null then null else hidden_reason end, hidden_period_id = case when archived_at is null then null else hidden_period_id end
     where id = p_lead;');
  if d = d0 then raise exception 'base changed: transfer_lead'; end if;
  execute d;

  select replace(pg_get_functiondef('app.list_leads(text,text,text,date,uuid,uuid,text,text,text,integer,integer,text,text)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, '($16 = ''received'' and l.original_creator_id <> $10', '($16 in (''received'',''transferred'') and l.original_creator_id <> $10');
  d := replace(d, 'and exists (select 1 from lead_assignments a where a.lead_id = l.id and a.kind = ''owner'' and a.to_employee_id = $10 and a.assigned_by <> $10)))',
                  'and (select case when a.from_employee_id is null or a.from_employee_id = $10 then ''received'' else ''transferred'' end from lead_assignments a
                       where a.lead_id = l.id and a.kind = ''owner'' and a.to_employee_id = $10 and a.assigned_by <> $10 order by a.created_at desc limit 1) = $16))');
  if d = d0 or position('''transferred'' end' in d) = 0 or position('in (''received'',''transferred'')' in d) = 0 then raise exception 'base changed: list_leads'; end if;
  execute d;
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
