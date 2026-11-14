import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_audit_numbers_test"); });
afterAll(async () => { await teardown(); });
const list = (who: string, scope: string | null = null) =>
  run(who, "select * from app.list_leads(null,null,null,null,null,null,null,'created','desc',100,0,'visible',$1)", [scope]).then((r) => r.rows);
const has = (rows: any[], id: string) => rows.some((r) => r.id === id);
const visible = (who: string, id: string) => run(who, "select count(*)::int n from leads where id=$1", [id]).then((r) => r.rows[0].n);
let seq = 1;
const rowsFor = (n: number) => Array.from({ length: n }, (_, i) => { const d = String(7000000 + seq * 1000 + i); return {
  row_no: i + 2, raw: {}, name: `موزّع ${seq}-${i}`, phone_raw: "055" + d, phone_e164: "+96655" + d, phone_country: "SA", phone_valid: true, store_url: "", store_key: null,
  status_text: "", notes: "", hunter: "هنتر أصلي", original_added: null, date_text: null }; });
const stage = async (rows: any[]) => (await run("super", "select app.dist_create($1::jsonb,$2::jsonb) id", [JSON.stringify({ file_name: "ملف.csv", file_hash: "h" + Math.random(), file_size: 1, file_kind: "csv", mapping: { headers: [] } }), JSON.stringify(rows)])).rows[0].id as string;
const distribute = async (n: number, emp: string) => { const id = await stage(rowsFor(n)); seq++; await run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [emp]]); return id; };

const total = (who: string, scope: string | null) =>
  run(who, "select coalesce(max(total),0)::int n from app.list_leads(null,null,null,null,null,null,null,'created','desc',1,0,'visible',$1)", [scope]).then((r) => r.rows[0].n as number);
const monthQ = "date_trunc('month', now() at time zone app.company_tz())::date";
const overview = async (who: string) => (await run(who, `select app.company_overview(${monthQ}) o`)).rows[0].o;

describe("one definition per number", () => {
  it("«المستلمة» never repeats what the employee added herself (old data imported in her name)", async () => {
    // an old-data import done by the admin in tele1's name: she is the creator, the admin made the assignment
    const own = (await register("tele1", leadPayload({ name: "قديم باسمها", phone: "0567000001" }))).lead_id;
    await admin.query("insert into lead_assignments(lead_id, kind, to_employee_id, assigned_by, reason) values ($1,'owner',$2,$3,'استيراد بيانات سابقة')", [own, ids.tele1, ids.super]);
    await distribute(4, ids.tele1);
    const [added, received, all] = [await total("tele1", "added"), await total("tele1", "received"), await total("tele1", null)];
    expect(has(await list("tele1", "received"), own)).toBe(false);
    expect(has(await list("tele1", "added"), own)).toBe(true);
    expect(received).toBe(4);
    expect(added + received).toBe(all);                       // the two tabs add up to everything she sees — nothing twice, nothing missing
  });
  it("header, tabs, progress card and monthly archive agree with the database", async () => {
    const c = (await run("tele1", "select * from app.added_counts(null)")).rows[0];
    const db = (await admin.query("select count(*)::int n from leads where original_creator_id=$1", [ids.tele1])).rows[0].n;
    expect(c.total).toBe(db); expect(await total("tele1", "added")).toBe(db);
    const pr = (await run("tele1", `select * from app.my_progress($1, ${monthQ})`, [ids.tele1])).rows[0];
    const am = (await run("tele1", "select * from app.archive_months(null)")).rows.find((r: any) => r.received > 0);
    expect(pr.received).toBe(4); expect(am.received).toBe(4);
    // the archive list for that month = added that month + received that month
    const arch = (await run("tele1", `select total from app.archive_leads(null, ${monthQ}, null, 1, 0, null)`)).rows[0].total;
    expect(Number(arch)).toBe(am.leads + am.received);
    // the admin sees the same numbers for her
    expect((await run("super", "select * from app.added_counts($1)", [ids.tele1])).rows[0].total).toBe(db);
    expect((await run("super", "select * from app.archive_months($1)", [ids.tele1])).rows.find((r: any) => r.received > 0).received).toBe(4);
  });
  it("handed = distinct leads everywhere, also after a reject and a second hand-off", async () => {
    const lead = (await list("tele1", "received"))[0].id;
    await admin.query("update leads set lead_status='Interested' where id=$1", [lead]);
    await run("tele1", "select app.handoff_lead($1,$2,'أول مرة')", [lead, ids.sales1]);
    await run("sales1", "select app.reject_handoff($1,'unreachable',null)", [lead]);
    // rejected → back to the Tele who handed it (not to the admin who created the distributed lead), and she can work on it
    const l = (await admin.query("select current_owner_id, original_creator_id, assigned_sales_id, handed_off_at from leads where id=$1", [lead])).rows[0];
    expect(l.original_creator_id).toBe(ids.super); expect(l.current_owner_id).toBe(ids.tele1); expect(l.assigned_sales_id).toBeNull();
    expect((await run("tele1", "update leads set lead_temperature='warm' where id=$1", [lead])).rowCount).toBe(1);
    expect(await total("tele1", "received")).toBe(4);          // still one lead, not two
    await admin.query("update leads set lead_status='Interested' where id=$1", [lead]);
    await run("tele1", "select app.handoff_lead($1,$2,'تاني مرة')", [lead, ids.sales1]);
    expect((await admin.query("select count(*)::int n from lead_handoffs where lead_id=$1", [lead])).rows[0].n).toBe(2);   // two operations
    expect((await run("tele1", "select handed_off from app.added_counts(null)")).rows[0].handed_off).toBe(1);             // one lead
    expect((await run("tele1", `select handed_off from app.my_progress($1, ${monthQ})`, [ids.tele1])).rows[0].handed_off).toBe(1);
    expect((await run("tele1", "select handed_off from app.archive_months(null) order by month desc limit 1")).rows[0].handed_off).toBe(1);
    expect((await run("tele1", "select count(*)::int n from app.my_lead_outcomes(null)")).rows[0].n).toBe(1);
    const o = await overview("super");
    expect(o.handoffs).toBe(1); expect(o.handoffOps).toBe(2);
    expect(o.handoffMonth.reduce((a: number, x: any) => a + x.n, 0)).toBe(o.handoffs);
  });
  it("«خلّيتهم مهتم» counts distributed data the Tele worked, once per lead", async () => {
    const before = (await run("tele1", `select interested_leads from app.tele_stats($1, ${monthQ})`, [ids.tele1])).rows[0].interested_leads;
    const lead = (await list("tele1", "received")).find((r: any) => r.lead_status === "New Lead").id;
    for (let i = 0; i < 2; i++) await run("tele1", "insert into lead_activities(lead_id, kind, status_to, created_by) values ($1,'status_change','Interested',$2)", [lead, ids.tele1]);
    expect((await run("tele1", `select interested_leads from app.tele_stats($1, ${monthQ})`, [ids.tele1])).rows[0].interested_leads).toBe(before + 1);
  });
  it("company dashboard: total = every lead; hidden stated; break-downs = what the list shows", async () => {
    const victim = (await list("tele1", "added"))[0].id;
    await run("super", "select app.set_lead_hidden($1,true,'اختبار')", [victim]);
    const o = await overview("super");
    const db = (await admin.query("select count(*)::int n, count(*) filter (where hidden_at is not null)::int h from leads")).rows[0];
    expect(o.totalLeads).toBe(db.n); expect(o.hiddenLeads).toBe(db.h); expect(o.hiddenLeads).toBeGreaterThanOrEqual(1);
    expect(o.byStatus.reduce((a: number, x: any) => a + x.n, 0)).toBe(db.n - db.h);
    expect(await total("super", null)).toBe(db.n - db.h);
    expect((await run("super", "select coalesce(max(total),0)::int n from app.list_leads(null,null,null,null,null,null,null,'created','desc',1,0,'all',null)")).rows[0].n).toBe(db.n);
    // per employee: added counts the real records (hidden too) — same as the employee's own header
    const e = o.perEmployee.find((x: any) => x.id === ids.tele1);
    expect(e.added).toBe((await run("tele1", "select this_month from app.added_counts(null)")).rows[0].this_month);
    expect(e.received).toBe(4);
    await expect(run("tele1", `select app.company_overview(${monthQ})`)).rejects.toThrow(/no access/);
    await run("super", "select app.set_lead_hidden($1,false,'رجوع')", [victim]);
  });
  it("a Tele manager sees distributed leads her team handed to Sales; other teams do not", async () => {
    const lead = (await run("tele1", "select lead_id from app.my_lead_outcomes(null)")).rows[0].lead_id;
    expect(await visible("telemgr", lead)).toBe(1);
    expect(has(await list("telemgr"), lead)).toBe(true);
    expect((await run("telemgr", "select app.lead_visible($1) v", [lead])).rows[0].v).toBe(true);
    expect(await visible("tele2", lead)).toBe(0);
    expect(await visible("sales2", lead)).toBe(0);
  });
  it("search is the same everywhere: archive finds Arabic spelling variants and phone parts", async () => {
    const id = (await register("tele2", leadPayload({ name: "مكتبة الأمل", phone: "0567111222" }))).lead_id;
    const a = async (q: string) => (await run("tele2", "select lead_id from app.archive_leads(null,null,null,50,0,$1)", [q])).rows.map((r: any) => r.lead_id);
    expect(await a("مكتبه الامل")).toContain(id);
    expect(await a("7111222")).toContain(id);
    expect(await a("0567111222")).toContain(id);
  });
  it("meeting counters are counted directly (not from a capped list)", async () => {
    const c = (await run("super", "select * from app.meeting_counts()")).rows[0];
    const db = (await admin.query("select count(*)::int n from meetings")).rows[0].n;
    expect(c.upcoming + c.awaiting + c.done + c.cancelled).toBe(db);
    expect((await run("tele2", "select * from app.meeting_counts()")).rows[0].upcoming).toBe(0);
  });
});
