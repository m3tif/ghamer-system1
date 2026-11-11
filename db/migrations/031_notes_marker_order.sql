-- 031: notes column vs notes history always show the same latest note.
-- When the history was rebuilt (029), the system line «مستورد من ملف …» from the activity log came in as an employee note with the
-- SAME time as the file's real note, so the details could show that line on top while the table column showed the real note.
-- These lines are now labelled «من الملف» (nothing deleted), and ties are broken so the newest note in the details is the one in the column.

alter table lead_notes disable trigger audit_lead_notes;   -- technical re-label of recovered lines, not an employee action
update lead_notes set source = 'import' where source = 'note' and body like 'مستورد من ملف «%';
alter table lead_notes enable trigger audit_lead_notes;

-- leads whose column was wiped before 029 but have a real note in the history: show the newest real note again (audited, "last updated" untouched)
do $$ begin
  perform set_config('app.notes_sync', 'on', true);
  perform set_config('app.reason', 'استرجاع آخر ملاحظة كانت اتمسحت من عمود الملاحظات قبل سجل الملاحظات (031)', true);
end $$;
alter table leads disable trigger leads_touch;
update leads l set call_notes = x.body
  from (select distinct on (n.lead_id) n.lead_id, n.body from lead_notes n where n.deleted_at is null and not (n.source = 'import' and n.body like 'مستورد من ملف «%')
        order by n.lead_id, n.created_at desc, n.id desc) x
 where x.lead_id = l.id and btrim(coalesce(l.call_notes,'')) = '';
alter table leads enable trigger leads_touch;
select set_config('app.notes_sync', 'off', false);

create or replace function app.lead_notes(p_lead uuid)
returns table(id uuid, body text, created_at timestamptz, by_name text, source text, deleted_at timestamptz, deleted_by_name text, delete_reason text)
language sql stable security definer set search_path = public, app as $$
  select n.id, n.body, n.created_at, app.emp_name(n.created_by), n.source, n.deleted_at, app.emp_name(n.deleted_by), n.delete_reason
    from lead_notes n join leads l on l.id = n.lead_id
   where n.lead_id = p_lead and app.lead_visible(p_lead) and (n.deleted_at is null or app.is_super())
   order by n.created_at desc, (n.deleted_at is null and n.body = btrim(coalesce(l.call_notes,''))) desc, (n.source = 'import') asc, n.id
$$;

create or replace function app.add_lead_note(p_lead uuid, p_body text, p_source text default 'note') returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_body text := btrim(coalesce(p_body,'')); v_cur text; v_last uuid; v_last_body text;
begin
  if app.me() is null or not app.has_perm('leads.edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  if v_body = '' then raise exception 'note is empty'; end if;
  if length(v_body) > 4000 then raise exception 'note too long'; end if;
  select btrim(coalesce(call_notes,'')) into v_cur from leads where id = p_lead for update;
  select id, body into v_last, v_last_body from lead_notes where lead_id = p_lead and deleted_at is null order by created_at desc, id desc limit 1;
  if v_last_body = v_body then   -- same text saved twice (double click, old tab) → one note, and the column shows it
    if v_cur is distinct from v_body then
      perform set_config('app.notes_sync', 'on', true);
      update leads set call_notes = v_body, updated_by = app.me() where id = p_lead;
      perform set_config('app.notes_sync', 'off', true);
    end if;
    return v_last;
  end if;
  insert into lead_notes(lead_id, body, created_by, source) values (p_lead, v_body, app.me(), case when p_source in ('note','call') then p_source else 'note' end)
    returning id into v_id;
  perform set_config('app.notes_sync', 'on', true);
  update leads set call_notes = v_body, updated_by = app.me() where id = p_lead;
  perform set_config('app.notes_sync', 'off', true);
  return v_id;
end $$;

create or replace function app.delete_lead_note(p_note uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare n lead_notes;
begin
  if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into n from lead_notes where id = p_note for update;
  if not found then raise exception 'not found'; end if;
  if n.deleted_at is not null then raise exception 'already deleted'; end if;
  perform set_config('app.reason', p_reason, true);
  update lead_notes set deleted_at = now(), deleted_by = app.me(), delete_reason = btrim(p_reason) where id = p_note;
  perform set_config('app.notes_sync', 'on', true);
  update leads set call_notes = (select x.body from lead_notes x where x.lead_id = n.lead_id and x.deleted_at is null and not (x.source = 'import' and x.body like 'مستورد من ملف «%')
                                  order by x.created_at desc, x.id desc limit 1) where id = n.lead_id;
  perform set_config('app.notes_sync', 'off', true);
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
