-- 027: «التراجع» also from the list of the previous-data imports, with a preview, exactly like the bulk-distribution undo.
-- Safe version: refused when anything was done to the imported leads afterwards (the batch page still has the partial rollback that keeps those).
create or replace function app._import_touched(p_row bigint) returns boolean language sql stable security definer set search_path = public, app as $$
  select not (l.updated_at = r.lead_updated_at
      and (select count(*) from lead_activities a where a.lead_id = r.lead_id) = 1
      and not exists (select 1 from lead_handoffs h where h.lead_id = r.lead_id)
      and not exists (select 1 from meetings m where m.lead_id = r.lead_id)
      and not exists (select 1 from follow_ups f where f.lead_id = r.lead_id)
      and not exists (select 1 from deal_stage_history dh join deals d on d.id = dh.deal_id where d.lead_id = r.lead_id and dh.to_stage <> 'New Lead')
      and not exists (select 1 from client_contacts cc where cc.client_id = r.client_id and cc.created_at > l.updated_at))
  from import_rows r join leads l on l.id = r.lead_id where r.id = p_row
$$;

create or replace function app.import_undo_preview(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare b import_batches; v_total int; v_touched int; v_per jsonb; v_block jsonb;
begin
  if not app._import_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  select * into b from import_batches where id = p_batch;
  select count(*)::int into v_total from import_rows r where r.batch_id = p_batch and r.status = 'imported' and r.lead_id is not null;
  select count(*)::int into v_touched from import_rows r where r.batch_id = p_batch and r.status = 'imported' and r.lead_id is not null and app._import_touched(r.id);
  select coalesce(jsonb_agg(jsonb_build_object('employee', e.name, 'count', e.n) order by e.name), '[]'::jsonb) into v_per
    from (select coalesce(app.emp_name(l.current_owner_id), '—') as name, count(*)::int n from import_rows r join leads l on l.id = r.lead_id where r.batch_id = p_batch and r.status = 'imported' group by 1) e;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_block from (
    select jsonb_build_object('lead_id', r.lead_id, 'name', c.name, 'employee', coalesce(app.emp_name(l.current_owner_id), '—'), 'reason', 'اتعمل عليه شغل بعد الاستيراد (تعديل / نشاط / تحويل / متابعة)') x
      from import_rows r join leads l on l.id = r.lead_id join clients c on c.id = l.client_id
     where r.batch_id = p_batch and r.status = 'imported' and r.lead_id is not null and app._import_touched(r.id) order by r.row_no limit 30) t;
  return jsonb_build_object('batch', p_batch, 'file_name', b.file_name, 'status', b.status, 'total', v_total, 'touched', v_touched, 'per_employee', v_per, 'blocking', v_block,
                            'can_undo', (b.status = 'completed' and v_total > 0 and v_touched = 0));
end $$;

create or replace function app.import_undo(p_batch uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare b import_batches; v_prev jsonb;
begin
  if not app._import_can(p_batch) then raise exception 'not found or no access' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into b from import_batches where id = p_batch for update;
  if b.status = 'rolled_back' then raise exception 'already undone'; end if;
  if b.status <> 'completed' then raise exception 'batch is not undoable'; end if;
  v_prev := app.import_undo_preview(p_batch);
  if (v_prev->>'touched')::int > 0 then raise exception 'worked on: % leads were already worked on, undo refused', v_prev->>'touched'; end if;
  return app.import_rollback(p_batch, p_reason) || jsonb_build_object('preview', v_prev);
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
