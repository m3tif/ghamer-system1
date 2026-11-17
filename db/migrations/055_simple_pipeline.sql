-- 055: simple sales pipeline (new → following → contract → closed). Re-scheduling a follow-up on a deal that is
-- already being followed now works (the old open follow-up is closed), and «خسرناه» closes its open follow-ups.
begin;
CREATE OR REPLACE FUNCTION app.move_deal_stage(p_deal uuid, p_to text, p_reason text, p_followup timestamp with time zone, p_followup_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'app'
AS $function$
declare d deals; c contracts;
begin
  if not app.has_perm('deals.edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from deals where id = p_deal for update;
  if not found or not app.deal_visible(d.owner_sales_id) then raise exception 'no access' using errcode = '42501'; end if;
  if d.stage in ('Lost','Financially Approved') then raise exception 'deal is closed'; end if;
  -- already being followed: a new follow-up date replaces the old open one (the old one is kept as done)
  if d.stage = p_to then
    if p_to in ('Postponed','Follow-up') and p_followup is not null and coalesce(btrim(p_followup_reason),'') <> '' then
      update follow_ups set status = 'done', completed_at = now() where deal_id = d.id and status = 'open';
      insert into follow_ups(lead_id, deal_id, owner_id, due_at, reason, created_by) values (d.lead_id, d.id, d.owner_sales_id, p_followup, btrim(p_followup_reason), app.me());
      update leads set next_followup_at = p_followup where id = d.lead_id;
      insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (d.id, d.stage, p_to, btrim(p_followup_reason), app.me());
    end if;
    return;
  end if;
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
    update follow_ups set status = 'done', completed_at = now() where deal_id = d.id and status = 'open';
    insert into follow_ups(lead_id, deal_id, owner_id, due_at, reason, created_by)
      values (d.lead_id, d.id, d.owner_sales_id, p_followup, btrim(p_followup_reason), app.me());
    update leads set next_followup_at = p_followup where id = d.lead_id;
  end if;
  update deals set stage = p_to, lost_reason = case when p_to = 'Lost' then btrim(p_reason) else lost_reason end where id = p_deal;
  insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee)
    values (p_deal, d.stage, p_to, coalesce(nullif(btrim(p_reason),''), btrim(p_followup_reason)), app.me());
  -- a lost deal takes its unsent contract with it (kept, marked cancelled)
  if p_to = 'Lost' then update follow_ups set status = 'cancelled', completed_at = now() where deal_id = d.id and status = 'open'; end if;
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
grant execute on function app._tech_ops_role(text) to ghamer_app;

commit;
