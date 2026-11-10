import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_recv_undo_test"); });
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

describe("Tele Sales: added vs received data", () => {
  it("own leads appear only in 'added', distributed ones only in 'received', with their origin", async () => {
    const own = (await register("tele1", leadPayload({ name: "ضفتها", phone: "0557770001" }))).lead_id;
    const batch = await distribute(3, ids.tele1);
    const added = await list("tele1", "added"), received = await list("tele1", "received");
    expect(has(added, own)).toBe(true); expect(received.length).toBe(3); expect(added.length).toBe(1);
    expect(received.every((r: any) => r.batch_name === "ملف.csv" && r.received_from && r.received_at && r.source)).toBe(true);
    expect(has(received, own)).toBe(false);
    // another Tele sees neither
    expect((await list("tele2")).length).toBe(0);
    const rid = received[0].id;
    expect(await visible("tele2", rid)).toBe(0);
    // stats do not mix: "leads I added" counts only her own
    expect((await run("tele1", "select * from app.added_counts(null)")).rows[0].total).toBe(1);
    expect(batch).toBeTruthy();
  });
  it("a received lead handed to Sales stays visible to the Tele, shows at Sales, and survives refresh (re-query)", async () => {
    const rec = (await list("tele1", "received"))[0];
    await admin.query("update leads set lead_status='Interested' where id=$1", [rec.id]);
    await run("tele1", "select app.handoff_lead($1,$2,'جاهز')", [rec.id, ids.sales1]);
    expect(await visible("sales1", rec.id)).toBe(1);
    const again = await list("tele1", "received");
    expect(has(again, rec.id)).toBe(true);
    expect(again.find((r: any) => r.id === rec.id).handed_off).toBe(true);
    expect(has(await list("sales1"), rec.id)).toBe(true);
    expect(await visible("super", rec.id)).toBe(1); expect(await visible("salesmgr", rec.id)).toBe(1);
    expect(await visible("tele2", rec.id)).toBe(0);
    expect((await admin.query("select count(*)::int n from lead_activities where lead_id=$1", [rec.id])).rows[0].n).toBeGreaterThanOrEqual(2);   // history kept
  });
});

describe("hiding a Tele's data never hides what is already with Sales", () => {
  it("the handed lead stays visible to Sales after an employee hide; her own un-handed leads are hidden", async () => {
    const a = (await register("tele2", leadPayload({ name: "للسيلز", phone: "0557770011", status: "Interested" }))).lead_id;
    const b = (await register("tele2", leadPayload({ name: "تفضل", phone: "0557770012" }))).lead_id;
    await run("tele2", "select app.handoff_lead($1,$2,'x')", [a, ids.sales2]);
    await run("sales2", "select app.accept_handoff($1)", [a]);
    await run("super", "select app.hide_period('month',(now() at time zone 'Asia/Riyadh')::date,$1,true,'اختبار')", [ids.tele2]);
    expect(await visible("sales2", a)).toBe(1);
    expect(await visible("tele2", b)).toBe(0);
    expect(await visible("super", b)).toBe(1);
  });
});

describe("undo a whole distribution", () => {
  it("preview, undo by batch number, no old lead touched, not twice, audit + notification", async () => {
    const old = (await register("tele1", leadPayload({ name: "قديم", phone: "0557770021" }))).lead_id;
    const batch = await distribute(4, ids.tele2);
    const pre = (await run("super", "select app.dist_undo_preview($1) p", [batch])).rows[0].p;
    expect(pre).toMatchObject({ total: 4, touched: 0, can_undo: true });
    expect(pre.per_employee).toEqual([{ employee: expect.any(String), count: 4 }]);
    const before = (await admin.query("select count(*)::int n from leads")).rows[0].n;
    const r = (await run("super", "select app.dist_undo($1,'ملف غلط') r", [batch])).rows[0].r;
    expect(r.undone).toBe(4);
    expect((await admin.query("select count(*)::int n from leads")).rows[0].n).toBe(before);          // nothing deleted
    expect(await visible("tele2", (await admin.query("select id from leads where import_batch_id=$1 limit 1", [batch])).rows[0].id)).toBe(0);
    expect(await visible("tele1", old)).toBe(1);                                                        // older client untouched
    expect((await admin.query("select status from import_batches where id=$1", [batch])).rows[0].status).toBe("rolled_back");
    await expect(run("super", "select app.dist_undo($1,'تاني')", [batch])).rejects.toThrow(/already undone/);
    expect((await admin.query("select count(*)::int n from audit_logs where reason like '%تراجع عن توزيع%' and entity_type = 'import_batches' and actor_id is not null")).rows[0].n).toBeGreaterThan(0);
    expect((await admin.query("select count(*)::int n from notifications where kind='lead_distribution' and title like 'تم التراجع%'")).rows[0].n).toBe(1);
    // the same phones can be sent again with a corrected file
    const again = await stage(rowsFor(0).concat(Array.from({ length: 4 }, (_, i) => ({ ...rowsFor(4)[i], phone_raw: "055" + String(7000000 + (seq - 1) * 1000 + i), phone_e164: "+96655" + String(7000000 + (seq - 1) * 1000 + i) }))));
    const plan = (await admin.query("select count(*)::int n from import_rows where batch_id=$1 and status='new'", [again])).rows[0].n;
    expect(plan).toBe(4);
  });
  it("refused when employees already worked on the data; permissions", async () => {
    const batch = await distribute(2, ids.tele1);
    const lead = (await admin.query("select id from leads where import_batch_id=$1 limit 1", [batch])).rows[0].id;
    await admin.query("select pg_sleep(1.5)");
    await admin.query("update leads set call_notes='اتصلت' where id=$1", [lead]);
    const pre = (await run("super", "select app.dist_undo_preview($1) p", [batch])).rows[0].p;
    expect(pre.can_undo).toBe(false); expect(pre.touched).toBe(1); expect(pre.blocking[0].reason).toBeTruthy();
    await expect(run("super", "select app.dist_undo($1,'x')", [batch])).rejects.toThrow(/worked on/);
    expect((await admin.query("select status from import_batches where id=$1", [batch])).rows[0].status).toBe("completed");
    for (const who of ["tele1", "telemgr", "sales1", "gm"]) await expect(run(who, "select app.dist_undo($1,'x')", [batch])).rejects.toThrow(/no access|not allowed/);
    await expect(run("super", "select app.dist_undo($1,'')", [batch])).rejects.toThrow(/reason|worked on/);
  });
});
