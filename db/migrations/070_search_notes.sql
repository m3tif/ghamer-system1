-- 070: (also: a Sales rejection returning a lead is not a «transfer» — see below)
-- the clients search also finds what employees wrote: the «الملاحظات» column (call notes) and the notes / calls
-- written in a client's activity log (not the system's automatic lines). Arabic letter variants match like the name search.
begin;
do $$ declare d text; d0 text; begin
  select replace(pg_get_functiondef('app.list_leads(text,text,text,date,uuid,uuid,text,text,text,integer,integer,text,text)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, $x$or c.id in (select s.client_id from client_stores s where s.url_raw ilike $2 or s.url_key ilike $2))$x$,
    $x$or c.id in (select s.client_id from client_stores s where s.url_raw ilike $2 or s.url_key ilike $2)
             or l.call_notes ilike $2 or app.ar_norm(coalesce(l.call_notes, '')) like (select app.ar_norm($2))
             or exists (select 1 from lead_activities la where la.lead_id = l.id and la.kind in ('note','call') and la.note not like 'تم التراجع عن عملية التوزيع%%'
                          and (la.note ilike $2 or app.ar_norm(la.note) like (select app.ar_norm($2)))))$x$);
  if d = d0 then raise exception 'base changed: list_leads'; end if;
  -- (069 fix) a lead coming back to her from a Sales rejection is a return, not a transfer: only someone else moving it
  -- from one employee to another counts as «المنقولة»
  d0 := d;
  d := replace(d, $x$where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10 order by a.created_at desc limit 1) = $16))$x$,
                  $x$where a.lead_id = l.id and a.kind = 'owner' and a.to_employee_id = $10 and a.assigned_by <> $10
                         and not (a.from_employee_id is not null and a.assigned_by = a.from_employee_id) order by a.created_at desc limit 1) = $16))$x$);
  if d = d0 then raise exception 'base changed: list_leads (069 fix)'; end if;
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
