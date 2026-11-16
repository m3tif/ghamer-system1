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
});
