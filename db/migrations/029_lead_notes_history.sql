-- 029: notes are kept forever.
-- Before: a lead had ONE notes field; every save wrote over it (8xx notes were replaced, some wiped). Now every note is its own row
-- in lead_notes (lead, employee, time). leads.call_notes only shows the latest one. A guard on leads makes sure no update anywhere
-- (status change, hand-off, distribution, an old browser tab) can wipe or overwrite a note without it being kept in the history.
-- Old notes are recovered from the activity log and the audit log. Deleting a note: Super Admin only, with a reason, soft + audited.

create table if not exists lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  body text not null check (length(btrim(body)) between 1 and 20000),
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  source text not null default 'note' check (source in ('note','call','register','import','distribution','history','current')),
  deleted_at timestamptz, deleted_by uuid references employees(id), delete_reason text
);
create index if not exists lead_notes_lead on lead_notes(lead_id, created_at desc);
alter table lead_notes enable row level security;
drop policy if exists notes_read on lead_notes;
create policy notes_read on lead_notes for select to ghamer_app using (app.lead_visible(lead_id) and (deleted_at is null or app.is_super()));
revoke all on lead_notes from ghamer_app;
grant select on lead_notes to ghamer_app;           -- writes only through the functions below

-- recover the history (earliest copy of each text per lead wins; exact sources beat the "value before" guesses)
do $$ begin
  if not exists (select 1 from lead_notes) then
    insert into lead_notes(lead_id, body, created_by, created_at, source)
    select distinct on (x.lead_id, x.body) x.lead_id, x.body, (select e.id from employees e where e.id = x.by), x.at, x.src
    from (
      select a.lead_id, btrim(a.note) body, a.created_by by, a.created_at at, case a.kind when 'call' then 'call' else 'note' end src, 0 guess
        from lead_activities a where a.kind in ('note','call') and btrim(coalesce(a.note,'')) <> '' and btrim(a.note) <> 'تم تسجيل العميل'
      union all
      select au.entity_id::uuid, btrim(au.new_value->>'call_notes'), au.actor_id, au.at, case when au.action = 'INSERT' then 'register' else 'history' end, 0
        from audit_logs au where au.entity_type = 'leads' and au.action in ('INSERT','UPDATE') and btrim(coalesce(au.new_value->>'call_notes','')) <> ''
      union all
      select au.entity_id::uuid, btrim(au.old_value->>'call_notes'), l.original_creator_id, l.created_at, 'history', 1
        from audit_logs au join leads l on l.id::text = au.entity_id
       where au.entity_type = 'leads' and au.action = 'UPDATE' and btrim(coalesce(au.old_value->>'call_notes','')) <> ''
      union all
      select l.id, btrim(l.call_notes), coalesce(l.updated_by, l.original_creator_id), l.updated_at, 'current', 1 from leads l where btrim(coalesce(l.call_notes,'')) <> ''
    ) x
    where exists (select 1 from leads l where l.id = x.lead_id)
    order by x.lead_id, x.body, x.guess, x.at;
  end if;
end $$;

-- audit every note from now on (the recovered history above is not re-logged: it already comes from the logs)
drop trigger if exists audit_lead_notes on lead_notes;
create trigger audit_lead_notes after insert or update or delete on lead_notes for each row execute function app.audit_row();

-- the one way to add a note
create or replace function app.add_lead_note(p_lead uuid, p_body text, p_source text default 'note') returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_body text := btrim(coalesce(p_body,'')); v_last text;
begin
  if app.me() is null or not app.has_perm('leads.edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.lead_visible(p_lead) then raise exception 'no access' using errcode = '42501'; end if;
  if v_body = '' then raise exception 'note is empty'; end if;
  if length(v_body) > 4000 then raise exception 'note too long'; end if;
  perform 1 from leads where id = p_lead for update;
  select body into v_last from lead_notes where lead_id = p_lead and deleted_at is null order by created_at desc limit 1;
  if v_last = v_body then   -- same text saved twice (double click, old tab) → one note
    return (select id from lead_notes where lead_id = p_lead and deleted_at is null order by created_at desc limit 1);
  end if;
  insert into lead_notes(lead_id, body, created_by, source) values (p_lead, v_body, app.me(), case when p_source in ('note','call') then p_source else 'note' end)
    returning id into v_id;
  perform set_config('app.notes_sync', 'on', true);
  update leads set call_notes = v_body, updated_by = app.me() where id = p_lead;
  perform set_config('app.notes_sync', 'off', true);
  return v_id;
end $$;

-- full history for one lead (deleted ones only for Super Admin)
create or replace function app.lead_notes(p_lead uuid)
returns table(id uuid, body text, created_at timestamptz, by_name text, source text, deleted_at timestamptz, deleted_by_name text, delete_reason text)
language sql stable security definer set search_path = public, app as $$
  select n.id, n.body, n.created_at, app.emp_name(n.created_by), n.source, n.deleted_at, app.emp_name(n.deleted_by), n.delete_reason
    from lead_notes n
   where n.lead_id = p_lead and app.lead_visible(p_lead) and (n.deleted_at is null or app.is_super())
   order by n.created_at desc, n.id
$$;

-- deleting: Super Admin only, with a reason; the row stays (soft) and the audit log records it
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
  update leads set call_notes = (select x.body from lead_notes x where x.lead_id = n.lead_id and x.deleted_at is null order by x.created_at desc limit 1) where id = n.lead_id;
  perform set_config('app.notes_sync', 'off', true);
end $$;

-- guard: any other change of leads.call_notes is kept as a history note; an empty value never wipes the last note
create or replace function app._notes_guard() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if current_setting('app.notes_sync', true) = 'on' then return NEW; end if;
  if NEW.call_notes is not distinct from OLD.call_notes then return NEW; end if;
  if btrim(coalesce(NEW.call_notes,'')) = '' then NEW.call_notes := OLD.call_notes; return NEW; end if;
  NEW.call_notes := btrim(NEW.call_notes);
  if not exists (select 1 from lead_notes x where x.lead_id = NEW.id and x.body = NEW.call_notes and x.deleted_at is null) then
    insert into lead_notes(lead_id, body, created_by, source) values (NEW.id, NEW.call_notes, (select e.id from employees e where e.id = app.me()), 'note');
  end if;
  return NEW;
end $$;
drop trigger if exists leads_notes_guard on leads;
create trigger leads_notes_guard before update of call_notes on leads for each row execute function app._notes_guard();

-- a note that comes with a new lead (register, import, distribution) is the first entry of its history
create or replace function app._notes_first() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if btrim(coalesce(NEW.call_notes,'')) <> '' then
    insert into lead_notes(lead_id, body, created_by, created_at, source)
    values (NEW.id, btrim(NEW.call_notes), (select e.id from employees e where e.id = coalesce(app.me(), NEW.original_creator_id)), NEW.created_at,
            case when NEW.import_batch_id is not null then 'import' else 'register' end);
  end if;
  return NEW;
end $$;
drop trigger if exists leads_notes_first on leads;
create trigger leads_notes_first after insert on leads for each row execute function app._notes_first();

CREATE OR REPLACE FUNCTION app.delete_client(p_client uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare v_name text; v_phones jsonb; v_leads uuid[]; v_deals uuid[]; v_meetings uuid[]; v_n int;
begin
  if not app.is_super() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select name into v_name from clients where id = p_client for update;
  if not found then raise exception 'not found or no access' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(value), '[]') into v_phones from client_identifiers where client_id = p_client and kind = 'phone';
  select array_agg(id) into v_leads from leads where client_id = p_client;
  v_leads := coalesce(v_leads, '{}');
  select array_agg(id) into v_deals from deals where client_id = p_client or lead_id = any(v_leads);
  v_deals := coalesce(v_deals, '{}');
  select array_agg(id) into v_meetings from meetings where lead_id = any(v_leads);
  v_meetings := coalesce(v_meetings, '{}');
  delete from meeting_events where meeting_id = any(v_meetings);
  delete from meeting_participants where meeting_id = any(v_meetings);
  delete from meetings where id = any(v_meetings);
  delete from deal_briefs where deal_id = any(v_deals);
  delete from deal_stage_history where deal_id = any(v_deals);
  delete from follow_ups where deal_id = any(v_deals) or lead_id = any(v_leads);
  delete from deals where id = any(v_deals);
  delete from lead_activities where lead_id = any(v_leads);
  delete from lead_notes where lead_id = any(v_leads);
  delete from lead_assignments where lead_id = any(v_leads);
  delete from lead_handoffs where lead_id = any(v_leads);
  update import_rows set client_id = null, lead_id = null, status = case when status = 'imported' then 'rolled_back' else status end,
         reason = case when status = 'imported' then 'تم حذف العميل' else reason end where client_id = p_client or lead_id = any(v_leads) or existing_client_id = p_client;
  update import_rows set existing_client_id = null where existing_client_id = p_client;
  delete from duplicate_reviews where existing_client_id = p_client;
  delete from client_identifiers where client_id = p_client;
  delete from client_contacts where client_id = p_client;
  delete from client_stores where client_id = p_client;
  delete from leads where client_id = p_client;
  delete from clients where id = p_client;
  insert into audit_logs(actor_id, action, entity_type, entity_id, old_value, reason)
  values (app.me(), 'DELETE', 'clients', p_client::text,
          jsonb_build_object('name', v_name, 'phones', v_phones, 'leads', cardinality(v_leads), 'deals', cardinality(v_deals), 'meetings', cardinality(v_meetings)), btrim(p_reason));
  return jsonb_build_object('deleted', 1, 'leads', cardinality(v_leads));
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
