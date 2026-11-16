-- 048: the delivery link is optional when a task is handed in (a link, if given, must start with http:// or https://)
begin;
create or replace function app.task_submit(p_task uuid, p_link text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare t tasks; o client_operations; v_link text := btrim(coalesce(p_link,'')); u uuid;
begin
  select * into t from tasks where id = p_task for update;
  if not found or t.assignee_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'submitted' then return; end if;                      -- pressed twice
  if t.status = 'approved' then raise exception 'task is closed'; end if;
  if t.status = 'client_review' then raise exception 'task cannot be started now'; end if;
  if v_link <> '' and v_link !~* '^https?://[^\s]+$' then raise exception 'invalid delivery link'; end if;   -- the link is optional (decision 16 Nov 2026)
  update task_time_logs set ended_at = now() where task_id = t.id and ended_at is null;
  update tasks set status = 'submitted', delivery_link = coalesce(nullif(v_link,''), case when t.status = 'changes_requested' then null else t.delivery_link end), delivery_note = nullif(btrim(p_note),''), submitted_at = now(), updated_at = now() where id = t.id;
  select * into o from client_operations where id = t.ops_id;
  for u in select distinct x from unnest(array[o.account_manager_id, t.created_by]) x where x is not null and x <> app.me() loop
    perform app._notify(u, 'task_submitted', 'تاسك اتسلّم ومحتاج مراجعة', t.title || ' — ' || app.emp_name(t.assignee_id), '/tasks/' || t.id, 'tasksub:' || t.id || ':' || t.revisions);
  end loop;
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

commit;
