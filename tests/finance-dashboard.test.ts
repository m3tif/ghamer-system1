import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin, leadPayload, sendAccepted, register, contractPayload, signContract } from "./helpers";

const dash = async (who: string, from: string | null = null, to: string | null = null) => (await run(who, "select app.finance_dashboard($1,$2) j", [from, to])).rows[0].j;
const one = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);

describe("Finance Manager dashboard — real numbers, finance-only access", () => {
  let c1: string;
  beforeAll(async () => {
    await setupDb("ghamer_test_findash");
    for (let i = 0; i < 4; i++) await register("tele1", leadPayload({ name: "ت1-" + i, phone: "057500000" + i }));
    await register("tele2", leadPayload({ name: "ت2", phone: "0575000010" }));
    const a = await sendAccepted("tele1", "sales1", leadPayload({ name: "مقبول", phone: "0575000020", status: "Interested" }));
    await sendAccepted("tele2", "sales2", leadPayload({ name: "مقبول2", phone: "0575000021", status: "Interested" }));
    const deal = (await admin.query("select id from deals where lead_id=$1", [a])).rows[0].id;
    c1 = await signContract("sales1", deal, { ...contractPayload({ start: "2027-01-01" }), total: 12000, items: [{ service: "seo" }] });
    await run("fin", "select app.contract_approve($1,null)", [c1]);
  });
  afterAll(teardown);

  it("only the Finance Manager and admins can read it", async () => {
    for (const w of ["fin", "super", "gm"]) expect((await dash(w)).kpi.total_clients).toBeGreaterThan(0);
    for (const w of ["sales1", "tele1", "salesmgr", "telemgr", "techmgr", "am1", "designer"]) await expect(dash(w)).rejects.toThrow(/no access/);
    for (const w of ["sales1", "tele1", "techmgr"]) expect((await run(w, "select * from app.finance_contracts(null,null,null,null,null,50,0)")).rows.length).toBe(0);
    expect((await run("fin", "select * from app.finance_contracts(null,null,null,null,null,50,0)")).rows.length).toBe(1);
    // nothing new was opened to Finance: still no client lists, no employee list
    expect((await run("fin", "select count(*)::int n from leads")).rows[0].n).toBe(0);
    expect((await run("fin", "select app.has_perm('leads.view') l, app.has_perm('employees.view') e")).rows[0]).toEqual({ l: false, e: false });
  });
  it("every number matches a direct count", async () => {
    const d = await dash("fin"), k = d.kpi, tz = "(select app.company_tz())";
    const s = `(date_trunc('month', now() at time zone ${tz}))::timestamp at time zone ${tz}`;
    expect(k.total_clients).toBe(await one("select count(*) n from leads"));
    expect(k.added).toBe(await one(`select count(*) n from leads where created_at >= ${s}`));
    expect(k.added).toBe(7);
    expect(k.added_today).toBe(await one(`select count(*) n from leads where created_at >= (now() at time zone ${tz})::date::timestamp at time zone ${tz}`));
    expect(k.handed).toBe(await one(`select count(distinct lead_id) n from lead_handoffs where handed_at >= ${s}`));
    expect(k.handed).toBe(2); expect(k.accepted).toBe(2); expect(k.rejected).toBe(0);
    expect(k.contracts_new).toBe(1); expect(k.contracts_approved).toBe(1); expect(Number(k.approved_value)).toBe(12000);
    expect(d.contracts.total).toBe(1); expect(d.contracts.approved).toBe(1); expect(d.contracts.submitted).toBe(0);
    const daySum = (key: string) => (d.daily as any[]).reduce((a, r) => a + r[key], 0);
    expect(daySum("added")).toBe(k.added); expect(daySum("contracts")).toBe(k.contracts_new);
    const stageSum = (d.stages as any[]).reduce((a, r) => a + r.n, 0);
    expect(stageSum).toBe(k.total_clients);
  });
  it("employee ranking: added vs received never double-counted; contracts credited to Sales and the Tele who brought the client", async () => {
    const e = (await dash("fin")).employees as any[];
    const t1 = e.find((x) => x.id === ids.tele1), t2 = e.find((x) => x.id === ids.tele2), s1 = e.find((x) => x.id === ids.sales1);
    expect(t1.added).toBe(5); expect(t1.received).toBe(0); expect(t1.handed).toBe(1); expect(t1.contracts).toBe(1); expect(t1.contracts_approved).toBe(1);
    expect(t2.added).toBe(2); expect(t2.contracts).toBe(0);
    expect(s1.added).toBe(0); expect(s1.contracts).toBe(1);
    expect(e[0].score).toBeGreaterThanOrEqual(e[e.length - 1].score);
  });
  it("search, status, employee and date filters on the contracts table", async () => {
    const f = async (q: string | null, st: string | null, emp: string | null, from: string | null = null, to: string | null = null) =>
      (await run("fin", "select * from app.finance_contracts($1,$2,$3,$4,$5,50,0)", [q, st, emp, from, to])).rows.length;
    expect(await f("مقبول", null, null)).toBe(1); expect(await f("0575000020", null, null)).toBe(1); expect(await f("GH-", null, null)).toBe(1);
    expect(await f("لا يوجد", null, null)).toBe(0);
    expect(await f(null, "approved", null)).toBe(1); expect(await f(null, "submitted", null)).toBe(0);
    expect(await f(null, null, ids.sales1)).toBe(1); expect(await f(null, null, ids.sales2)).toBe(0); expect(await f(null, null, ids.tele1)).toBe(1);
    expect(await f(null, null, null, "2000-01-01", "2000-01-02")).toBe(0);
  });
  it("a custom period and the previous period line up; too long is refused", async () => {
    const d = await dash("fin", "2020-01-01", "2020-01-10");
    expect(d.days).toBe(10); expect(d.prev_to).toBe("2019-12-31"); expect(d.prev_from).toBe("2019-12-22"); expect(d.kpi.added).toBe(0); expect(d.daily.length).toBe(10);
    await expect(dash("fin", "2020-01-01", "2022-01-01")).rejects.toThrow(/period too long/);
  });
  it("clients ranked by money with their payment schedule and time left; finance only", async () => {
    const r = (await run("fin", "select * from app.finance_clients()")).rows;
    expect(r.length).toBe(1);
    expect(Number(r[0].total_amount)).toBe(12000); expect(r[0].inst_count).toBe(1);
    expect(Number(r[0].due_so_far)).toBe(0); expect(Number(r[0].remaining)).toBe(12000);
    expect(String(r[0].next_due)).toMatch(/2027|Jan 01 2027/); expect(r[0].schedule.length).toBe(1);
    expect(r[0].days_total).toBeGreaterThan(0); expect(r[0].days_left).toBeGreaterThan(0);
    for (const w of ["sales1", "tele1", "techmgr", "am1"]) expect((await run(w, "select * from app.finance_clients()")).rows.length).toBe(0);
  });
  it("payments: Finance records what arrived, the Finance Manager confirms; only confirmed money counts; never more than the contract", async () => {
    const rec = (who: string, p: any) => run(who, "select app.payment_record($1,$2::jsonb) id", [c1, JSON.stringify(p)]).then((r) => r.rows[0].id as string);
    const base = { amount: 5000, paid_at: "2026-01-10", method: "bank_transfer", reference: "TRX-1" };
    for (const w of ["sales1", "tele1", "techmgr", "am1"]) await expect(rec(w, base)).rejects.toThrow(/not allowed/);
    await expect(rec("finemp", { ...base, amount: 0 })).rejects.toThrow(/amount must be greater/);
    await expect(rec("finemp", { ...base, paid_at: "2999-01-01" })).rejects.toThrow(/invalid payment date/);
    await expect(rec("finemp", { ...base, method: "cash" })).rejects.toThrow(/invalid payment method/);
    await expect(rec("finemp", { ...base, amount: 12001 })).rejects.toThrow(/exceed the contract value/);
    const req = "11111111-2222-3333-4444-555555555555";
    const p1 = await rec("finemp", { ...base, request_id: req });
    expect(await rec("finemp", { ...base, request_id: req })).toBe(p1);                              // pressed twice = one payment
    expect((await admin.query("select count(*)::int n from payments")).rows[0].n).toBe(1);
    let cl = (await run("fin", "select * from app.finance_clients()")).rows[0];
    expect(Number(cl.paid)).toBe(0); expect(cl.pending_payments).toBe(1); expect(Number(cl.remaining)).toBe(12000);
    expect((await admin.query("select count(*)::int n from notifications where kind='payment_recorded' and user_id=$1", [ids.fin])).rows[0].n).toBe(1);
    await expect(run("finemp", "select app.payment_decide($1,true,null)", [p1])).rejects.toThrow(/not allowed/);
    await run("fin", "select app.payment_decide($1,true,null)", [p1]);
    await run("fin", "select app.payment_decide($1,true,null)", [p1]);
    await expect(run("fin", "select app.payment_decide($1,false,'x')", [p1])).rejects.toThrow(/already decided/);
    cl = (await run("fin", "select * from app.finance_clients()")).rows[0];
    expect(Number(cl.paid)).toBe(5000); expect(Number(cl.remaining)).toBe(7000); expect(cl.pending_payments).toBe(0);
    // rejected payments do not count; the Finance Manager can record and confirm in one step
    const p2 = await rec("finemp", { ...base, amount: 3000, reference: "TRX-2" });
    await expect(run("fin", "select app.payment_decide($1,false,'')", [p2])).rejects.toThrow(/reason required/);
    await run("fin", "select app.payment_decide($1,false,'التحويل مش موجود في البنك')", [p2]);
    await rec("fin", { ...base, amount: 7000, reference: "TRX-3", verify: true });
    await expect(rec("fin", { ...base, amount: 1, verify: true })).rejects.toThrow(/exceed the contract value/);
    cl = (await run("fin", "select * from app.finance_clients()")).rows[0];
    expect(Number(cl.paid)).toBe(12000); expect(Number(cl.remaining)).toBe(0);
    const d = await dash("fin", "2026-01-01", "2026-01-31");
    expect(Number(d.kpi.collected)).toBe(12000); expect(Number(d.contracts.collected_all)).toBe(12000);
    // who sees the list: Finance and the Sales owner; not others. Nobody writes the table directly.
    expect((await run("sales1", "select * from app.payment_list($1)", [c1])).rows.length).toBe(3);
    expect((await run("sales2", "select * from app.payment_list($1)", [c1])).rows.length).toBe(0);
    await expect(run("fin", "update payments set amount = 1")).rejects.toThrow(/permission denied/);
    await expect(run("super", "delete from payments")).rejects.toThrow(/permission denied/);
    expect((await admin.query("select count(*)::int n from audit_logs where entity_type='payments'")).rows[0].n).toBeGreaterThanOrEqual(5);
  });
  it("admin attention: admins only, and its numbers match direct counts", async () => {
    for (const w of ["fin", "sales1", "tele1", "techmgr", "am1", "telemgr", "salesmgr"]) await expect(run(w, "select app.admin_attention()")).rejects.toThrow(/no access/);
    const a = (await run("super", "select app.admin_attention() j")).rows[0].j;
    expect((await run("gm", "select app.admin_attention() j")).rows[0].j.employees_active).toBe(a.employees_active);
    expect(a.contracts_waiting).toBe(Number((await admin.query("select count(*) n from contracts where status='submitted'")).rows[0].n));
    expect(a.followups_overdue).toBe(Number((await admin.query("select count(*) n from follow_ups where status='open' and due_at < now()")).rows[0].n));
    expect(a.ops_new).toBe(Number((await admin.query("select count(*) n from client_operations where status='new'")).rows[0].n));
    expect((a.sources as any[]).reduce((x, r) => x + r.n, 0)).toBe(Number((await admin.query("select count(*) n from leads")).rows[0].n));
    expect(Number(a.overdue_money)).toBe(0);
  });
});
