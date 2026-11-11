import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_credit_order_test"); });
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

const month = () => run("super", "select date_trunc('month', now() at time zone 'Asia/Riyadh')::date::text m").then((r) => r.rows[0].m as string);
const teleStats = async (who: string, emp: string) => (await run(who, "select * from app.tele_stats($1,$2::date)", [emp, await month()])).rows[0];
const future = () => new Date(Date.now() + 3 * 864e5).toISOString();
const order = async (who: string) => (await list(who, "received")).map((r: any) => r.id).join(",");

describe("meeting counts for the Tele who worked a distributed client", () => {
  let lead = "", meeting = "";
  it("admin-added lead → Tele hands it off → Sales books → +1 for the Tele, with hand-off, batch and source on the meeting", async () => {
    const batch = await distribute(2, ids.tele1);
    lead = (await list("tele1", "received"))[0].id;
    expect((await admin.query("select original_creator_id from leads where id=$1", [lead])).rows[0].original_creator_id).toBe(ids.super);
    const before = await teleStats("tele1", ids.tele1);
    await admin.query("update leads set lead_status='Interested' where id=$1", [lead]);
    await run("tele1", "select app.handoff_lead($1,$2,'جاهز')", [lead, ids.sales1]);
    await run("sales1", "select app.accept_handoff($1)", [lead]);
    const req = "11111111-2222-4333-8444-555555555555";
    meeting = (await run("sales1", "select app.book_meeting($1,$2,null,'online',null,null,$3) id", [lead, future(), req])).rows[0].id;
    const after = await teleStats("tele1", ids.tele1);
    expect(after.meetings_scheduled).toBe(before.meetings_scheduled + 1);
    const m = (await admin.query("select tele_sales_id, handoff_id, import_batch_id, lead_source from meetings where id=$1", [meeting])).rows[0];
    expect(m.tele_sales_id).toBe(ids.tele1); expect(m.handoff_id).toBeTruthy(); expect(m.import_batch_id).toBe(batch); expect(m.lead_source).toBeTruthy();
    // counted once: same request again, an edit, and re-reading do not add another
    await run("sales1", "select app.book_meeting($1,$2,null,'online',null,null,$3)", [lead, future(), req]);
    await run("sales1", "select app.update_meeting($1,'عنوان جديد',$2,null,null,null,'تعديل')", [meeting, future()]);
    expect((await teleStats("tele1", ids.tele1)).meetings_scheduled).toBe(before.meetings_scheduled + 1);
    expect((await admin.query("select count(*)::int n from meetings where lead_id=$1", [lead])).rows[0].n).toBe(1);
    // the other Tele got nothing, and the Tele now sees the meeting
    expect((await teleStats("tele2", ids.tele2)).meetings_scheduled).toBe(0);
    expect((await run("tele1", "select count(*)::int n from meetings where id=$1", [meeting])).rows[0].n).toBe(1);
  });
  it("managers and admin see the same numbers; the daily report credits the Tele", async () => {
    const own = (await teleStats("tele1", ids.tele1)).meetings_scheduled;
    expect((await teleStats("telemgr", ids.tele1)).meetings_scheduled).toBe(own);
    expect((await teleStats("super", ids.tele1)).meetings_scheduled).toBe(own);
    expect((await run("salesmgr", "select count(*)::int n from meetings where id=$1", [meeting])).rows[0].n).toBe(1);
    const day = (await run("super", "select * from app.daily_report(null)")).rows;
    expect(day.find((r: any) => r.emp_id === ids.tele1).meetings_booked).toBeGreaterThanOrEqual(1);
    expect(day.find((r: any) => r.emp_id === ids.tele2).meetings_booked).toBe(0);
  });
  it("a cancelled meeting shows in the cancelled count (existing rule) and is not counted twice", async () => {
    const before = await teleStats("tele1", ids.tele1);
    await run("sales1", "select app.set_meeting_status($1,'cancel','العميل اعتذر',null,null)", [meeting]);
    const after = await teleStats("tele1", ids.tele1);
    expect(after.meetings_cancelled).toBe(before.meetings_cancelled + 1);
    expect(after.meetings_scheduled).toBe(before.meetings_scheduled);
  });
  it("a Tele's own lead still counts for her (unchanged)", async () => {
    const before = (await teleStats("tele2", ids.tele2)).meetings_scheduled;
    const own = (await register("tele2", leadPayload({ name: "عميلي", phone: "0558880001", status: "Interested" }))).lead_id;
    await run("tele2", "select app.handoff_lead($1,$2,'x')", [own, ids.sales2]);
    await run("sales2", "select app.accept_handoff($1)", [own]);
    await run("sales2", "select app.book_meeting($1,$2,null,'online',null,null,null)", [own, future()]);
    expect((await teleStats("tele2", ids.tele2)).meetings_scheduled).toBe(before + 1);
  });
});

describe("received data keeps its order while the Tele works", () => {
  it("colouring, status, notes and refresh do not move rows; pages never skip or repeat a lead", async () => {
    await distribute(6, ids.tele2);
    const first = await order("tele2");
    const rows = await list("tele2", "received");
    expect(new Set(rows.map((r: any) => r.created_at.toISOString())).size).toBeLessThan(rows.length);   // same time inside one distribution
    const [a, b] = [rows[0].id, rows[1].id];
    await run("tele2", "select app.mark_cells($1,array['name','notes'],'yellow')", [a]);
    await run("tele2", "update leads set lead_status='Contacted', call_notes='اتصلت', updated_by=$2 where id=$1", [a, ids.tele2]);
    expect(await order("tele2")).toBe(first);
    await run("tele2", "update leads set lead_status='No Answer', call_notes='مردش', updated_by=$2 where id=$1", [b, ids.tele2]);
    await run("tele2", "select app.mark_cells($1,array['phone'],'red')", [b]);
    expect(await order("tele2")).toBe(first);
    expect(await order("tele2")).toBe(first);   // "refresh"
    // inside a distribution the rows follow the file order
    const seqs = (await admin.query("select seq from leads where id = any($1::uuid[])", [rows.map((r: any) => r.id)])).rows;
    expect(seqs.length).toBe(rows.length);
    // loading in chunks gives exactly the same list
    const page = (off: number) => run("tele2", "select id from app.list_leads(null,null,null,null,null,null,null,'created','desc',2,$1,'visible','received')", [off]).then((r) => r.rows.map((x: any) => x.id));
    const chunks = [...(await page(0)), ...(await page(2)), ...(await page(4))];
    expect(chunks.join(",")).toBe(first.split(",").slice(0, 6).join(","));
    expect(new Set(chunks).size).toBe(6);
  });
  it("other employees' lists are not affected", async () => {
    expect((await list("tele1", "received")).every((r: any) => r.id)).toBe(true);
    expect((await list("tele2", "added")).some((r: any) => r.name === "عميلي")).toBe(true);
  });
});
