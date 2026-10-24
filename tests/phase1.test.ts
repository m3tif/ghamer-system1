import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, ids, admin, future } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_phase1_test"); });
afterAll(async () => { await teardown(); });

const month = new Date().toISOString().slice(0, 7) + "-01";
const rawPayload = (i: number, extra: any = {}) => ({
  name: `عميل ${i}`, source: "cold_call", lead_status: "Interested", required_services: [],
  identifiers: [{ kind: "phone", value: `+96655${String(1000000 + i)}`, label: "mobile" }],
  contacts: [{ label: "mobile", phone: `+96655${String(1000000 + i)}`, is_primary: true }], stores: [], ...extra,
});

describe("quick registration & double-submit protection", () => {
  it("the same request id never creates two leads (double click / retry)", async () => {
    const rid = "11111111-1111-1111-1111-111111111111";
    const results = await Promise.all(Array.from({ length: 8 }, () => register("tele1", rawPayload(1, { request_id: rid }))));
    expect(results.every((r) => r.status === "created")).toBe(true);
    expect(new Set(results.map((r) => r.lead_id)).size).toBe(1);
    const n = await admin.query("select count(*)::int n from leads where request_id = $1", [rid]);
    expect(n.rows[0].n).toBe(1);
  });
  it("only name + phone are needed; the month is stamped from the server clock", async () => {
    const r = await register("tele1", { name: "سريع", source: "cold_call", identifiers: [{ kind: "phone", value: "+966551234501", label: "mobile" }], contacts: [] });
    expect(r.status).toBe("created");
    const l = await admin.query("select lead_status, created_month, to_char(created_month,'YYYY-MM-DD') m from leads where id = $1", [r.lead_id]);
    expect(l.rows[0].lead_status).toBe("New Lead");
    expect(l.rows[0].m).toBe(month);
  });
  it("created_at / created_month / original creator cannot be rewritten", async () => {
    const r = await register("tele1", rawPayload(2));
    await expect(admin.query("update leads set created_month = '2020-01-01' where id = $1", [r.lead_id])).rejects.toThrow(/immutable/);
    await expect(admin.query("update leads set created_at = now() - interval '90 days' where id = $1", [r.lead_id])).rejects.toThrow(/immutable/);
    await expect(run("tele1", "update leads set created_month = '2020-01-01'")).rejects.toThrow(/permission denied/);
  });
});

describe("achievements (computed in the database, kept per month)", () => {
  it("awards 10/25/50/100 exactly once, at the moment they are crossed", async () => {
    const seen: Record<number, string[]> = {};
    for (let i = 100; i < 200; i++) {
      const r = await register("tele2", rawPayload(i, { lead_status: "New Lead" }));
      expect(r.status).toBe("created");
      seen[r.month_count] = r.new_achievements;
    }
    expect(seen[10]).toEqual(["leads_10"]);
    expect(seen[25]).toEqual(["leads_25"]);
    expect(seen[50]).toEqual(["leads_50"]);
    expect(seen[100]).toEqual(["leads_100"]);
    expect(seen[11]).toEqual([]);
    const a = await admin.query("select code, to_char(period_month,'YYYY-MM-DD') m from achievements where employee_id = $1 order by code", [ids.tele2]);
    expect(a.rows.map((x) => x.code)).toEqual(["leads_10", "leads_100", "leads_25", "leads_50"]);
    expect(a.rows.every((x) => x.m === month)).toBe(true);
  });
  it("monthly leads goal is awarded when reached and the count cannot be inflated from the client", async () => {
    await run("telemgr", "insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'new_leads',3,$3)", [ids.tele1, month, ids.telemgr]);
    const awarded: string[] = [];
    for (let i = 300; i < 303; i++) awarded.push(...(await register("tele1", rawPayload(i, { lead_status: "New Lead" }))).new_achievements);
    expect(awarded.filter((c) => c === "goal_new_leads")).toHaveLength(1); // awarded once, not on every lead
    const p = (await run("tele1", "select * from app.my_progress($1,$2)", [ids.tele1, month])).rows[0];
    expect(p.month_count).toBeGreaterThanOrEqual(3);
    expect(Number(p.goal)).toBe(3);
    await expect(run("tele1", "insert into achievements(employee_id, period_month, code) values ($1,$2,'leads_100')", [ids.tele1, month])).rejects.toThrow(/permission denied/);
    await expect(run("tele2", "select * from app.my_progress($1,$2)", [ids.tele1, month])).rejects.toThrow(/no access/);
  });
  it("previous months keep their own achievements", async () => {
    await admin.query("insert into achievements(employee_id, period_month, code) values ($1,'2026-01-01','leads_50')", [ids.tele2]);
    const m = await run("tele2", "select * from app.archive_months(null)");
    const months = m.rows.map((r) => r.month.toISOString().slice(0, 7));
    expect(months).toContain("2026-01");
    expect(m.rows.find((r) => r.month.toISOString().slice(0, 7) === "2026-01").achievements).toBe(1);
  });
});

describe("hand-off from Tele Sales to Sales", () => {
  let leadA: string, leadB: string;
  it("only Interested / Qualified leads can be handed off", async () => {
    const r = await register("tele1", rawPayload(400, { lead_status: "No Answer" }));
    await expect(run("tele1", "select app.handoff_lead($1,$2,'x')", [r.lead_id, ids.sales1])).rejects.toThrow(/Interested or Qualified/);
    leadA = (await register("tele1", rawPayload(401))).lead_id;
    leadB = (await register("tele1", rawPayload(402, { lead_status: "Qualified Lead" }))).lead_id;
  });
  it("direct hand-off: sales receives the lead with history, tele keeps outcome-only view, double hand-off is blocked", async () => {
    await run("tele1", "select app.handoff_lead($1,$2,'جاهز للاجتماع')", [leadA, ids.sales1]);
    expect((await run("sales1", "select * from leads where id = $1", [leadA])).rowCount).toBe(1);
    expect((await run("sales2", "select * from leads where id = $1", [leadA])).rowCount).toBe(0);
    expect((await run("tele1", "select * from leads where id = $1", [leadA])).rowCount).toBe(0);
    expect((await run("sales1", "select * from deals where lead_id = $1", [leadA])).rows[0].stage).toBe("Qualified");
    const acts = await run("sales1", "select count(*)::int n from lead_activities where lead_id = $1", [leadA]);
    expect(acts.rows[0].n).toBeGreaterThanOrEqual(2); // earlier history kept
    const o = await run("tele1", "select * from app.my_lead_outcomes() where lead_id = $1", [leadA]);
    expect(o.rows[0]).toMatchObject({ handoff_status: "assigned", to_name: "خالد" });
    await expect(run("tele1", "select app.handoff_lead($1,$2,'x')", [leadA, ids.sales2])).rejects.toThrow(/no access/);
    expect((await run("sales1", "select * from notifications where kind = 'lead_assigned'")).rowCount).toBeGreaterThan(0);
    await run("sales1", "select app.acknowledge_handoff($1)", [leadA]);
    const h = await admin.query("select status, received_at, assigned_at, handed_at from lead_handoffs where lead_id = $1", [leadA]);
    expect(h.rows[0].status).toBe("received");
    expect(h.rows[0].received_at).not.toBeNull();
    await expect(run("sales2", "select app.acknowledge_handoff($1)", [leadA])).rejects.toThrow(/no pending handoff/);
    expect((await run("tele1", "select * from notifications where kind = 'handoff_received'")).rowCount).toBe(1);
  });
  it("hand-off to admin for distribution: only the admin can distribute", async () => {
    await run("tele1", "select app.handoff_lead($1,null,'وزّعه على من تراه')", [leadB]);
    expect((await run("super", "select * from app.pending_handoffs()")).rowCount).toBe(1);
    expect((await run("super", "select * from notifications where kind = 'lead_pending_distribution'")).rowCount).toBe(1);
    expect((await run("sales1", "select * from leads where id = $1", [leadB])).rowCount).toBe(0);
    expect((await run("tele1", "select * from leads where id = $1", [leadB])).rowCount).toBe(0); // creator/owner no longer sees it while pending
    expect((await run("super", "select * from leads where id = $1", [leadB])).rowCount).toBe(1);
    expect((await run("salesmgr", "select * from app.pending_handoffs()")).rowCount).toBe(0);
    const ho = (await admin.query("select id from lead_handoffs where lead_id = $1", [leadB])).rows[0].id;
    await expect(run("salesmgr", "select app.assign_handoff($1,$2)", [ho, ids.sales2])).rejects.toThrow(/not allowed/);
    await run("super", "select app.assign_handoff($1,$2)", [ho, ids.sales2]);
    expect((await run("sales2", "select * from leads where id = $1", [leadB])).rowCount).toBe(1);
    await expect(run("super", "select app.assign_handoff($1,$2)", [ho, ids.sales1])).rejects.toThrow(/not pending/);
    const l = await admin.query("select original_creator_id, current_owner_id, assigned_sales_id from leads where id = $1", [leadB]);
    expect(l.rows[0]).toEqual({ original_creator_id: ids.tele1, current_owner_id: ids.sales2, assigned_sales_id: ids.sales2 });
  });
  it("the handed-off lead stays in the Tele Sales monthly archive but cannot be opened", async () => {
    const a = await run("tele1", "select * from app.archive_leads(null, null, null, 100, 0) where lead_id = $1", [leadA]);
    expect(a.rows[0].can_open).toBe(false);
    expect(a.rows[0].handoff_status).toBe("received");
    await expect(run("tele1", "select * from app.archive_leads($1, null, null, 10, 0)", [ids.tele2])).rejects.toThrow(/no access/);
    const adm = await run("super", "select count(*)::int n from app.archive_leads(null, $1, null, 100, 0)", [month]);
    expect(adm.rows[0].n).toBe(100);
    const filtered = await run("super", "select count(*)::int n from app.archive_leads($1, $2, 'Interested', 100, 0)", [ids.tele1, month]);
    expect(filtered.rows[0].n).toBeGreaterThan(0);
  });
});

describe("admin overview (data layer, as used by the dashboard)", () => {
  it("works for the Super Admin and the General Manager, with per-employee distribution", async () => {
    const { companyOverview } = await import("../src/server/data");
    for (const who of ["super", "gm"]) {
      const o = await companyOverview(ids[who], month);
      expect(o.totalLeads).toBeGreaterThan(100);
      expect(o.byStatus.length).toBeGreaterThan(0);
      const t2 = o.perEmployee.find((e: any) => e.full_name === "نورة");
      expect(t2.added).toBeGreaterThanOrEqual(100);
    }
  });
});

describe("performance with many clients", () => {
  it("lists, searches and paginates 20,000 clients quickly", { timeout: 180000 }, async () => {
    await admin.query("set session_replication_role = replica");
    await admin.query(`insert into clients(id, name, business_name, original_source, original_creator_id, created_at)
      select gen_random_uuid(), 'عميل تجريبي ' || g, 'نشاط ' || (g % 500), 'cold_call', $1, now() - (g || ' minutes')::interval from generate_series(1, 20000) g`, [ids.tele1]);
    await admin.query(`insert into leads(client_id, original_creator_id, current_owner_id, lead_status, created_month, created_at)
      select c.id, c.original_creator_id, c.original_creator_id, (array['New Lead','Interested','No Answer','Contacted'])[1 + (random()*3)::int], date_trunc('month', c.created_at)::date, c.created_at
      from clients c where c.name like 'عميل تجريبي %'`);
    await admin.query(`insert into client_contacts(client_id, label, phone, is_primary)
      select c.id, 'mobile', '+9665' || lpad((row_number() over ())::text, 8, '0'), true from clients c where c.name like 'عميل تجريبي %'`);
    await admin.query("set session_replication_role = origin; analyze clients; analyze leads; analyze client_contacts");
    const { listLeads } = await import("../src/server/data");
    const t = async (o: any) => { const s = performance.now(); const r = await listLeads(ids.tele1, o); return [performance.now() - s, r] as const; };
    const [tPage, page] = await t({ page: 1 });
    expect(page.rows.length).toBe(20); expect(page.total).toBeGreaterThan(20000);
    const [tDeep] = await t({ page: 500 });
    const [tName] = await t({ q: "عميل تجريبي 1234" });
    const [tPhone] = await t({ q: "+96650000123" });
    const [tStatus] = await t({ status: "Interested", page: 3 });
    console.log(`timings ms → first page ${tPage.toFixed(0)}, deep page ${tDeep.toFixed(0)}, name search ${tName.toFixed(0)}, phone search ${tPhone.toFixed(0)}, status filter ${tStatus.toFixed(0)}`);
    for (const x of [tPage, tDeep, tName, tPhone, tStatus]) expect(x).toBeLessThan(1500);
  });
  it("duplicate check stays fast with 20,000 identifiers (unique index lookup)", async () => {
    const s = performance.now();
    const r = await register("tele2", rawPayload(999999, { lead_status: "New Lead" }));
    expect(r.status).toBe("created");
    expect(performance.now() - s).toBeLessThan(1500);
  });
});
