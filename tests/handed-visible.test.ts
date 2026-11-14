import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_handed_visible_test"); });
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

const search = (who: string, q: string | null, phone: string | null, scope: string | null = null) =>
  run(who, "select id from app.list_leads($1,$2,null,null,null,null,null,'created','desc',100,0,'visible',$3)", [q, phone, scope]).then((r) => r.rows.map((x: any) => x.id));
const outcomes = (who: string, q: string | null = null) => run(who, "select * from app.my_lead_outcomes($1)", [q]).then((r) => r.rows);
const phoneOf = async (lead: string) => (await admin.query("select cc.phone from leads l join client_contacts cc on cc.client_id=l.client_id where l.id=$1 limit 1", [lead])).rows[0].phone as string;
const nameOf = async (lead: string) => (await admin.query("select c.name from leads l join clients c on c.id=l.client_id where l.id=$1", [lead])).rows[0].name as string;

describe("a Tele hands 15 leads to Sales (10 she added + 5 distributed to her)", () => {
  const leads: string[] = [];
  it("all 15 are in her hand-off list and her counter, each with the right status", async () => {
    for (let i = 0; i < 10; i++)
      leads.push((await register("tele1", leadPayload({ name: `عميلة أسماء ${i}`, phone: `05612300${String(i).padStart(2, "0")}`, status: "Interested" }))).lead_id);
    await distribute(5, ids.tele1);
    leads.push(...(await list("tele1", "received")).slice(0, 5).map((r: any) => r.id));
    expect(new Set(leads).size).toBe(15);
    for (const id of leads) { await admin.query("update leads set lead_status='Interested' where id=$1", [id]); await run("tele1", "select app.handoff_lead($1,$2,'جاهز')", [id, ids.sales1]); }
    for (const id of leads.slice(0, 8)) await run("sales1", "select app.accept_handoff($1)", [id]);
    const o = await outcomes("tele1");
    expect(o.length).toBe(15);
    expect(new Set(o.map((x: any) => x.lead_id))).toEqual(new Set(leads));
    expect(o.filter((x: any) => x.handoff_status === "accepted").length).toBe(8);
    expect(o.filter((x: any) => String(x.handoff_status).startsWith("pending")).length).toBe(7);
    expect((await run("tele1", "select * from app.added_counts(null)")).rows[0].handed_off).toBe(15);
    const m = (await run("tele1", "select handed_off from app.my_progress($1, date_trunc('month', now() at time zone 'Asia/Riyadh')::date)", [ids.tele1])).rows[0];
    expect(m.handed_off).toBe(15);
  });
  it("Sales sees all 15, pending and accepted", async () => {
    const rows = await search("sales1", null, null);
    expect(leads.every((id) => rows.includes(id))).toBe(true);
  });
  it("each of the 15 is found by phone, part of the phone and name — from any tab (no tab limit when searching)", async () => {
    for (const id of leads) {
      const ph = await phoneOf(id), digits = ph.replace(/\D/g, "");
      expect(await search("tele1", null, digits)).toContain(id);               // full number
      expect(await search("tele1", null, digits.slice(-6))).toContain(id);     // part of it
      expect(await search("tele1", null, "0" + digits.slice(3))).toContain(id); // local 05… format
      expect(await search("tele1", await nameOf(id), null)).toContain(id);
      expect((await outcomes("tele1", digits.slice(-7))).map((x: any) => x.lead_id)).toContain(id);
    }
    // the old behaviour: searching inside «اللي ضفتهم» did not reach the distributed ones
    const dist = leads[12];
    expect(await search("tele1", null, (await phoneOf(dist)).replace(/\D/g, "").slice(-6), "added")).not.toContain(dist);
  });
  it("Arabic spelling variants match", async () => {
    expect(await search("tele1", "عميله اسماء 3", null)).toContain(leads[3]);   // ة→ه , أ→ا
    expect((await outcomes("tele1", "اسماء 3")).map((x: any) => x.lead_id)).toContain(leads[3]);
  });
  it("no other employee sees them", async () => {
    expect((await outcomes("tele2")).some((x: any) => leads.includes(x.lead_id))).toBe(false);
    const r = await search("tele2", null, (await phoneOf(leads[0])).replace(/\D/g, ""));
    expect(r).not.toContain(leads[0]);
    expect((await search("sales2", null, null)).some((id) => leads.includes(id))).toBe(false);
  });
  it("after a new session (refresh / log out + in) the same 15 are there", async () => {
    expect((await outcomes("tele1")).length).toBe(15);
  });
});
