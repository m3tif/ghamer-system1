-- 040: contract packages (picked with tick boxes) + first payment on or before the start date
-- The service catalogue becomes the agency's 7 packages. Old services stay in the table (inactive) so old contracts keep their names.
begin;
update services set is_active = false where code not in ('store_create','store_edit','full_service','seo','media','social_media','influencer');
insert into services(code, name_ar, sort, is_active) values
  ('store_create','باقة إنشاء المتجر',1,true), ('store_edit','باقة تعديل المتجر',2,true), ('full_service','باقة خدمة كاملة',3,true),
  ('seo','باقة سيو',4,true), ('media','باقة ميديا',5,true), ('social_media','باقة سوشيال',6,true), ('influencer','باقة انفلونسر',7,true)
on conflict (code) do update set name_ar = excluded.name_ar, sort = excluded.sort, is_active = true;

create or replace function app.contract_save(p_deal uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare d deals; c contracts; v_id uuid; v_vat numeric; v_items jsonb := coalesce(p->'items', '[]'::jsonb); v_inst jsonb := coalesce(p->'installments', '[]'::jsonb);
        v_sum numeric := 0; v_disc numeric := coalesce(nullif(p->>'discount','')::numeric, 0); v_total numeric; v_net numeric; it jsonb; i int := 0; v_isum numeric := 0;
        v_start date := nullif(p->>'start_date','')::date; v_end date := nullif(p->>'end_date','')::date; v_months int := nullif(p->>'duration_months','')::int;
        v_pkg text := coalesce(nullif(p->>'package',''), 'monthly');
begin
  select * into d from deals where id = p_deal for update;
  if not found or not app._contract_can_write(d.owner_sales_id) then raise exception 'no access' using errcode = '42501'; end if;
  if d.stage in ('Lost','Financially Approved') then raise exception 'deal is closed'; end if;
  select * into c from contracts where deal_id = p_deal and status <> 'cancelled' for update;
  if found and c.status not in ('draft','returned') then raise exception 'contract is locked: it is with Finance'; end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'contract needs at least one service'; end if;
  if jsonb_array_length(v_items) > 30 or jsonb_array_length(v_inst) > 60 then raise exception 'too many rows'; end if;
  for it in select * from jsonb_array_elements(v_items) loop
    if coalesce(nullif(it->>'amount','')::numeric, 0) <= 0 then raise exception 'service price must be greater than zero'; end if;
    if not exists (select 1 from services s where s.code = it->>'service' and s.is_active) then raise exception 'invalid service'; end if;
    v_sum := v_sum + round((it->>'amount')::numeric, 2);
  end loop;
  -- no discount and no VAT in contracts (decision 16 Nov 2026): the contract value is simply the sum of its services
  v_disc := 0; v_total := v_sum; v_vat := 0; v_net := v_total;
  if v_months is not null and (v_months < 1 or v_months > 120) then raise exception 'invalid duration'; end if;
  if v_end is null and v_start is not null and v_months is not null then v_end := (v_start + make_interval(months => v_months) - interval '1 day')::date; end if;
  if v_start is not null and v_end is not null and v_end < v_start then raise exception 'end date is before start date'; end if;
  for it in select * from jsonb_array_elements(v_inst) loop
    if coalesce(nullif(it->>'amount','')::numeric, 0) <= 0 or nullif(it->>'due_date','') is null then raise exception 'each instalment needs an amount and a date'; end if;
    v_isum := v_isum + round((it->>'amount')::numeric, 2);
  end loop;
  if jsonb_array_length(v_inst) > 0 and v_isum <> v_total then raise exception 'instalments must add up to the contract total'; end if;
  -- the first payment is on the start date or before it (the client may pay before work starts), never after (decision 16 Nov 2026)
  if jsonb_array_length(v_inst) > 0 and v_start is not null and (v_inst->0->>'due_date')::date > v_start then raise exception 'first payment must be on or before the start date'; end if;

  if c.id is null then
    insert into contracts(contract_no, deal_id, client_id, lead_id, sales_owner_id, tele_sales_id, package, duration_months, start_date, end_date, agreed_at,
                          vat_rate, discount_amount, total_amount, net_amount, vat_amount, payment_method, payment_terms, notes, created_by, updated_by)
    values (app._contract_no(), d.id, d.client_id, d.lead_id, d.owner_sales_id, app._tele_for_lead(d.lead_id), v_pkg, v_months, v_start, v_end, nullif(p->>'agreed_at','')::date,
            v_vat, round(v_disc, 2), v_total, v_net, v_total - v_net, nullif(p->>'payment_method',''), nullif(btrim(p->>'payment_terms'),''), nullif(btrim(p->>'notes'),''), app.me(), app.me())
    returning id into v_id;
  else
    v_id := c.id;
    update contracts set package = v_pkg, duration_months = v_months, start_date = v_start, end_date = v_end, agreed_at = nullif(p->>'agreed_at','')::date,
           vat_rate = v_vat, discount_amount = round(v_disc, 2), total_amount = v_total, net_amount = v_net, vat_amount = v_total - v_net,
           payment_method = nullif(p->>'payment_method',''), payment_terms = nullif(btrim(p->>'payment_terms'),''), notes = nullif(btrim(p->>'notes'),''),
           sales_owner_id = d.owner_sales_id, updated_by = app.me() where id = v_id;
    delete from contract_services where contract_id = v_id;
    delete from payment_installments where contract_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(v_items) loop
    i := i + 1;
    insert into contract_services(contract_id, service_code, description, amount, sort) values (v_id, it->>'service', nullif(btrim(it->>'description'),''), round((it->>'amount')::numeric, 2), i);
  end loop;
  i := 0;
  for it in select * from jsonb_array_elements(v_inst) loop
    i := i + 1;
    insert into payment_installments(contract_id, seq, kind, due_date, amount, note)
    values (v_id, i, coalesce(nullif(it->>'kind',''), 'installment'), (it->>'due_date')::date, round((it->>'amount')::numeric, 2), nullif(btrim(it->>'note'),''));
  end loop;
  -- a contract being written = the deal is at «العقد قيد التوقيع»
  if d.stage not in ('Contract Pending','Signed / Finance Pending') then
    update deals set stage = 'Contract Pending' where id = d.id;
    insert into deal_stage_history(deal_id, from_stage, to_stage, reason, by_employee) values (d.id, d.stage, 'Contract Pending', 'إنشاء عقد', app.me());
  end if;
  return v_id;
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
