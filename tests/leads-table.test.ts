import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, sendAccepted, ids, admin } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_leadstable_test"); });
afterAll(async () => { await teardown(); });

const list = (who: string, o: Partial<{ q: string; phone: string; status: string; creator: string; sales: string; temp: string; sort: string; dir: string; limit: number; offset: number }> = {}) =>
  run(who, "select * from app.list_leads($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,'visible')",
    [o.q ?? null, o.phone ?? null, o.status ?? null, o.creator ?? null, o.sales ?? null, o.temp ?? null, o.sort ?? null, o.dir ?? null, o.limit ?? 25, o.offset ?? 0]).then((r) => r.rows);

describe("leads table", () => {
  let a: string, b: string, c: string;
  it("returns real columns: store, phone, creator, duplicate attempts", async () => {
    const r1 = await register("tele1", leadPayload({ name: "متجر الورد", phone: "0551110001", store: "https://rose-shop.com/ar" }));
    a = r1.lead_id;
    const rows = await list("tele1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "متجر الورد", phone: "+966551110001", creator_name: "سارة", dup_attempts: 0, handed_off: false });
    expect(rows[0].store_url).toContain("rose-shop.com");
    expect(rows[0].next_followup_at).toBeNull();
  });
  it("a duplicate attempt is recorded on the existing lead (throttled)", async () => {
    const d1 = await register("tele2", leadPayload({ name: "نفسه", phone: "0551110001" }));
    expect(d1.status).toBe("duplicate");
    await register("tele2", leadPayload({ name: "نفسه", phone: "0551110001" }));
    const rows = await list("tele1");
    expect(rows[0].dup_attempts).toBe(1);
    expect(await list("tele2")).toHaveLength(0); // the other employee still cannot see it
  });
  it("search by name, phone and store URL; filters; sort; paging", async () => {
    b = (await register("tele1", leadPayload({ name: "بيت القهوة", phone: "0551110002", store: "https://coffee.sa" }))).lead_id;
    c = (await register("tele1", leadPayload({ name: "أزياء نور", phone: "0551110003" }))).lead_id;
    await admin.query("update leads set lead_temperature='hot' where id=$1", [b]);
    expect((await list("tele1", { q: "القهوة" })).map((x) => x.id)).toEqual([b]);
    expect((await list("tele1", { phone: "0551110003".replace(/^0/, "+966") })).map((x) => x.id)).toEqual([c]);
    expect((await list("tele1", { q: "coffee.sa" })).map((x) => x.id)).toEqual([b]);
    expect((await list("tele1", { temp: "hot" })).map((x) => x.id)).toEqual([b]);
    expect((await list("tele1", { sort: "name", dir: "asc" }))[0].name).toBe("أزياء نور");
    const p = await list("tele1", { limit: 2, offset: 2 });
    expect(p).toHaveLength(1); expect(p[0].total).toBe(3);
    expect(await list("tele1", { q: "%" })).toHaveLength(0); // wildcard is escaped
  });
  it("admin and managers see everything in scope, other employees nothing", async () => {
    expect((await list("super")).length).toBe(3);
    expect((await list("telemgr")).length).toBe(3);
    expect((await list("sales1")).length).toBe(0);
    expect((await list("fin")).length).toBe(0);
  });
});

describe("hand-off from any open status", () => {
  it("Tele Sales can send a New Lead / Contacted lead to Sales by choosing Interested at the same step", async () => {
    const l = (await register("tele1", leadPayload({ name: "جديد", phone: "0552220001" }))).lead_id;
    await expect(run("tele1", "select app.handoff_lead($1,$2,'x')", [l, ids.sales1])).rejects.toThrow(/Interested or Qualified/);
    await run("tele1", "select app.handoff_lead($1,$2,'x','Interested')", [l, ids.sales1]);
    const r = await admin.query("select lead_status, assigned_sales_id from leads where id=$1", [l]);
    expect(r.rows[0]).toMatchObject({ lead_status: "Pending Sales Review", assigned_sales_id: ids.sales1 });
    const act = await admin.query("select 1 from lead_activities where lead_id=$1 and kind='status_change' and status_to='Interested'", [l]);
    expect(act.rowCount).toBe(1);
  });
  it("rejects dead statuses and bogus status values; no double hand-off", async () => {
    const l = (await register("tele1", leadPayload({ name: "ميت", phone: "0552220002" }))).lead_id;
    await admin.query("update leads set lead_status='Not Interested' where id=$1", [l]);
    await expect(run("tele1", "select app.handoff_lead($1,$2,'x','Interested')", [l, ids.sales1])).rejects.toThrow(/does not allow/);
    const m = (await register("tele1", leadPayload({ name: "تجربة", phone: "0552220003" }))).lead_id;
    await expect(run("tele1", "select app.handoff_lead($1,$2,'x','Accepted by Sales')", [m, ids.sales1])).rejects.toThrow();
    await run("tele1", "select app.handoff_lead($1,$2,'x','Qualified Lead')", [m, ids.sales1]);
    await expect(run("tele1", "select app.handoff_lead($1,$2,'x','Qualified Lead')", [m, ids.sales2])).rejects.toThrow();
  });
  it("another employee cannot hand off a lead that is not theirs", async () => {
    const l = (await register("tele1", leadPayload({ name: "ليس لك", phone: "0552220004" }))).lead_id;
    await expect(run("tele2", "select app.handoff_lead($1,$2,'x','Interested')", [l, ids.sales1])).rejects.toThrow(/no access/);
  });
});

describe("Sales cannot see each other's leads", () => {
  it("each Sales sees only the leads assigned to them, in the table, search and by id", async () => {
    const l1 = await sendAccepted("tele1", "sales1", leadPayload({ name: "لخالد", phone: "0553330001", status: "Interested" }));
    const l2 = await sendAccepted("tele2", "sales2", leadPayload({ name: "لفهد", phone: "0553330002", status: "Interested" }));
    const s1 = (await list("sales1")).map((x) => x.id), s2 = (await list("sales2")).map((x) => x.id);
    expect(s1).toContain(l1); expect(s1).not.toContain(l2); expect(s2).toContain(l2); expect(s2).not.toContain(l1);
    expect(await list("sales1", { q: "لفهد" })).toHaveLength(0);
    expect(await list("sales1", { phone: "+966553330002" })).toHaveLength(0);
    expect((await run("sales1", "select count(*)::int n from leads where id=$1", [l2])).rows[0].n).toBe(0);
    expect((await run("sales1", "select app.lead_visible($1) v", [l2])).rows[0].v).toBe(false);
    expect((await run("sales2", "select count(*)::int n from deals")).rows[0].n).toBe(1);
    expect((await list("salesmgr")).map((x) => x.id)).toEqual(expect.arrayContaining([l1, l2]));
    // after hand-off, the Tele who added it still sees it (read only)
    expect((await list("tele1")).some((x) => x.id === l1)).toBe(true);
    expect((await list("tele2")).some((x) => x.id === l1)).toBe(false);
  });
});
