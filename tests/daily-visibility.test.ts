import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, ids, admin } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_daily_test"); });
afterAll(async () => { await teardown(); });

const backdate = async (lead: string, iso: string) => {
  await admin.query("set session_replication_role = replica");
  await admin.query("update leads set created_at = $2::timestamptz, created_month = date_trunc('month', $2::timestamptz at time zone 'Asia/Riyadh')::date where id = $1", [lead, iso]);
  await admin.query("set session_replication_role = origin");
};
const mine = (who: string) => run(who, "select count(*)::int n from leads").then((r) => r.rows[0].n);
let l1: string, l2: string, l3: string, l4: string;

describe("daily results", () => {
  it("setup: leads on three different days, two employees", async () => {
    l1 = (await register("tele1", leadPayload({ name: "أ", phone: "0561000001" }))).lead_id;
    l2 = (await register("tele1", leadPayload({ name: "ب", phone: "0561000002" }))).lead_id;
    l3 = (await register("tele2", leadPayload({ name: "ج", phone: "0561000003" }))).lead_id;
    l4 = (await register("tele1", leadPayload({ name: "د", phone: "0561000004", status: "Interested" }))).lead_id;
    await backdate(l2, "2026-03-10T09:00:00Z");           // 10 March
    await backdate(l3, "2026-03-10T21:30:00Z");           // 11 March 00:30 in Riyadh (+03)  → proves the company time zone is used
  });
  it("counts per employee for a past day, using real dates in the company time zone", async () => {
    const d10 = (await run("super", "select * from app.daily_report('2026-03-10')")).rows;
    expect(d10.find((r: any) => r.emp_id === ids.tele1).added).toBe(1);
    expect(d10.find((r: any) => r.emp_id === ids.tele2).added).toBe(0);
    const d11 = (await run("super", "select * from app.daily_report('2026-03-11')")).rows;
    expect(d11.find((r: any) => r.emp_id === ids.tele2).added).toBe(1);
  });
  it("today: separates tele and sales, counts hand-off / accept / reject by event time", async () => {
    await run("tele1", "select app.handoff_lead($1,$2,'x')", [l4, ids.sales1]);
    const mid = (await run("super", "select * from app.daily_report(null)")).rows;
    expect(mid.find((r: any) => r.emp_id === ids.tele1)).toMatchObject({ family: "tele", added: 2, handed: 1 });
    expect(mid.find((r: any) => r.emp_id === ids.sales1)).toMatchObject({ family: "sales", received: 1, accepted: 0 });
    await run("sales1", "select app.accept_handoff($1)", [l4]);
    const end = (await run("super", "select * from app.daily_report(null)")).rows;
    expect(end.find((r: any) => r.emp_id === ids.tele1).accepted).toBe(1);
    expect(end.find((r: any) => r.emp_id === ids.sales1).accepted).toBe(1);
    // the same accept does not appear on yesterday
    const y = (await run("super", "select * from app.daily_report((now() - interval '2 day')::date)")).rows;
    expect(y.reduce((a: number, r: any) => a + r.accepted, 0)).toBe(0);
  });
  it("employees cannot read the daily report", async () => {
    expect((await run("tele1", "select * from app.daily_report(null)")).rows.length).toBe(0);
  });
});

describe("hide / restore a whole day or month", () => {
  it("employees cannot hide or read the log", async () => {
    await expect(run("tele1", "select app.hide_period('day','2026-03-10',null,true,'x')")).rejects.toThrow(/not allowed/);
    await expect(run("telemgr", "select app.hide_period('day','2026-03-10',null,true,'x')")).rejects.toThrow(/not allowed/);
    expect((await run("tele1", "select * from app.hide_log()")).rows.length).toBe(0);
  });
  it("hiding a day hides only that day, admin still sees it, ownership is untouched", async () => {
    const before = await mine("tele1");
    const r = await run("super", "select app.hide_period('day','2026-03-10',null,true,'تصفية') r");
    expect(r.rows[0].r.affected).toBe(1);
    expect(await mine("tele1")).toBe(before - 1);
    expect(await mine("tele2")).toBe(1);                      // other day untouched
    const adminSees = await run("super", "select count(*)::int n from leads where id = $1", [l2]);
    expect(adminSees.rows[0].n).toBe(1);
    const own = await admin.query("select original_creator_id, current_owner_id from leads where id = $1", [l2]);
    expect(own.rows[0].original_creator_id).toBe(ids.tele1);
  });
  it("it is idempotent and logged with who/when", async () => {
    const again = await run("super", "select app.hide_period('day','2026-03-10',null,true,'تصفية') r");
    expect(again.rows[0].r.affected).toBe(0);
    const log = (await run("gm", "select * from app.hide_log()")).rows;
    expect(log.length).toBe(1);
    expect(log[0]).toMatchObject({ scope: "day", created_by_name: "المدير النظام", restored_at: null, affected: 1 });
  });
  it("a lead created later inside a hidden period is hidden from the start", async () => {
    await run("super", "select app.hide_period('day', (now() at time zone 'Asia/Riyadh')::date, $1, true, 'اختبار')", [ids.tele2]);
    const n = (await register("tele2", leadPayload({ name: "جديد اليوم", phone: "0561000005" }))).lead_id;
    expect(await run("tele2", "select count(*)::int n from leads where id = $1", [n]).then((r) => r.rows[0].n)).toBe(0);
    expect((await run("super", "select count(*)::int n from leads where id = $1", [n])).rows[0].n).toBe(1);
    await run("super", "select app.hide_period('day', (now() at time zone 'Asia/Riyadh')::date, $1, false, null)", [ids.tele2]);
    expect(await run("tele2", "select count(*)::int n from leads where id = $1", [n]).then((r) => r.rows[0].n)).toBe(1);
  });
  it("restore brings back exactly what the period hid; a lead hidden by hand stays hidden", async () => {
    await run("super", "select app.set_lead_hidden($1,true,'يدوي')", [l1]);
    await run("super", "select app.hide_period('month','2026-03-01',null,true,'شهر')");
    expect(await mine("tele2")).toBe(1);                      // the 11 March lead is hidden by the month action; today's one remains
    const r = await run("super", "select app.hide_period('month','2026-03-01',null,false,null) r");
    expect(r.rows[0].r.affected).toBe(1);
    expect(await mine("tele2")).toBe(2);
    const d = await run("super", "select app.hide_period('day','2026-03-10',null,false,null) r");
    expect(d.rows[0].r.affected).toBe(1);
    const l1h = await admin.query("select hidden_at is not null h from leads where id = $1", [l1]);
    expect(l1h.rows[0].h).toBe(true);
    const log = (await run("super", "select * from app.hide_log()")).rows;
    expect(log.every((x: any) => x.restored_at)).toBe(true);
  });
  it("overview shows hidden vs total", async () => {
    await run("super", "select app.hide_period('day','2026-03-10',null,true,'x')");
    const ov = (await run("super", "select * from app.hide_overview('day',2026,3)")).rows;
    const row = ov.find((r: any) => String(r.period.toISOString?.() ?? r.period).startsWith("2026-03-10"));
    expect(row).toMatchObject({ total: 1, hidden: 1, rule_active: true });
  });
});

describe("live refresh fingerprint", () => {
  it("changes when visible data changes and is limited to what the user can see", async () => {
    const a = (await run("tele1", "select app.pulse() p")).rows[0].p;
    const c0 = (await run("tele2", "select app.pulse() p")).rows[0].p;
    await register("tele1", leadPayload({ name: "نبض", phone: "0561000099" }));
    const b = (await run("tele1", "select app.pulse() p")).rows[0].p;
    expect(b.leads).toBe(a.leads + 1);
    const c = (await run("tele2", "select app.pulse() p")).rows[0].p;
    expect(c.leads).toBe(c0.leads);
  });
});
