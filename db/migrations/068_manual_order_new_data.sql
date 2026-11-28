-- 068: «ترتيبي» (manual order) hid newly received data.
-- The order used to be: leads without a saved place first, then the arranged ones. A drag saves a place only for the rows
-- loaded on screen, so (a) the ~1,500 older leads never loaded jumped above the employee's own order, and (b) new data
-- that happened to be on screen during a drag got a place and sank below all of those (a tele sales lost 186 fresh leads
-- that way). Now: data that arrived after the newest arranged lead comes first, then the arranged leads in her order,
-- then everything else newest first.
begin;
do $$ declare d text; d0 text; begin
  select replace(pg_get_functiondef('app.list_leads(text,text,text,date,uuid,uuid,text,text,text,integer,integer,text,text)'::regprocedure), E'\r\n', E'\n') into d; d0 := d;
  d := replace(d, $x$when 'manual' then 'm.pos asc nulls first, l.created_at desc, l.seq asc'$x$,
    $x$when 'manual' then 'case when m.pos is null and l.created_at > ' || quote_literal(coalesce((select max(ll.created_at) from lead_marks mm join leads ll on ll.id = mm.lead_id where mm.user_id = v_me and mm.pos is not null), '-infinity'::timestamptz)) || '::timestamptz then 0 when m.pos is not null then 1 else 2 end, m.pos asc nulls last, l.created_at desc, l.seq asc'$x$);
  if d = d0 then raise exception 'base changed: list_leads'; end if;
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
