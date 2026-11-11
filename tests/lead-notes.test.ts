import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_notes_test"); });
afterAll(async () => { await teardown(); });

const notes = (who: string, lead: string) => run(who, "select * from app.lead_notes($1)", [lead]).then((r) => r.rows);
const bodies = async (who: string, lead: string) => (await notes(who, lead)).map((n: any) => n.body).reverse();   // oldest → newest
const latest = (lead: string) => admin.query("select call_notes from leads where id=$1", [lead]).then((r) => r.rows[0].call_notes);

describe("notes are kept forever", () => {
  let lead = "";
  it("the first note, then several more: all kept with employee and time; the table shows the newest", async () => {
    lead = (await register("tele1", { ...leadPayload({ name: "عميل ملاحظات", phone: "0551230001" }), call_notes: "أول ملاحظة" })).lead_id;
    await run("tele1", "select app.add_lead_note($1,'اتصلت ومردش')", [lead]);
    await run("tele1", "select app.add_lead_note($1,'رد وطلب عرض سعر','call')", [lead]);
    expect(await bodies("tele1", lead)).toEqual(["أول ملاحظة", "اتصلت ومردش", "رد وطلب عرض سعر"]);
    const n = await notes("tele1", lead);
    expect(n.every((x: any) => x.by_name && x.created_at)).toBe(true);
    expect(n[0].source).toBe("call");
    expect(await latest(lead)).toBe("رد وطلب عرض سعر");
    // same text twice (double click / old tab) → still one
    await run("tele1", "select app.add_lead_note($1,'رد وطلب عرض سعر')", [lead]);
    expect((await notes("tele1", lead)).length).toBe(3);
  });
  it("no update anywhere can wipe or overwrite a note", async () => {
    await run("tele1", "update leads set call_notes = null, lead_status = 'Contacted' where id = $1", [lead]);
    expect(await latest(lead)).toBe("رد وطلب عرض سعر");
    await run("tele1", "update leads set call_notes = '' where id = $1", [lead]);
    expect(await latest(lead)).toBe("رد وطلب عرض سعر");
    await run("tele1", "update leads set call_notes = 'كتبت فوقها من تاب قديم' where id = $1", [lead]);   // old way of saving
    expect(await bodies("tele1", lead)).toEqual(["أول ملاحظة", "اتصلت ومردش", "رد وطلب عرض سعر", "كتبت فوقها من تاب قديم"]);
    await admin.query("update leads set lead_status='Interested', lead_temperature='hot' where id=$1", [lead]);
    expect((await notes("tele1", lead)).length).toBe(4);
  });
  it("hand-off Tele → Sales, Sales adds notes: both see the whole history (also after a new session)", async () => {
    await run("tele1", "select app.handoff_lead($1,$2,'جاهز للسيلز')", [lead, ids.sales1]);
    await run("sales1", "select app.accept_handoff($1)", [lead]);
    await run("sales1", "select app.add_lead_note($1,'السيلز: اتفقنا على اجتماع')", [lead]);
    const all = ["أول ملاحظة", "اتصلت ومردش", "رد وطلب عرض سعر", "كتبت فوقها من تاب قديم", "السيلز: اتفقنا على اجتماع"];
    expect(await bodies("sales1", lead)).toEqual(all);
    expect(await bodies("tele1", lead)).toEqual(all);       // every run() is a fresh session = refresh / log out + in
    expect(await bodies("salesmgr", lead)).toEqual(all);
    expect(await bodies("super", lead)).toEqual(all);
    // other employees see nothing
    expect((await notes("tele2", lead)).length).toBe(0);
    await expect(run("tele2", "select app.add_lead_note($1,'x')", [lead])).rejects.toThrow(/no access/);
  });
  it("nobody can write the notes table directly", async () => {
    await expect(run("tele1", "insert into lead_notes(lead_id, body) values ($1,'x')", [lead])).rejects.toThrow(/permission denied/);
    await expect(run("super", "update lead_notes set body='x' where lead_id=$1", [lead])).rejects.toThrow(/permission denied/);
    await expect(run("super", "delete from lead_notes where lead_id=$1", [lead])).rejects.toThrow(/permission denied/);
  });
  it("deleting: Super Admin only, with a reason, kept in the audit log", async () => {
    const target = (await notes("super", lead)).find((n: any) => n.body === "كتبت فوقها من تاب قديم").id;
    await expect(run("tele1", "select app.delete_lead_note($1,'x')", [target])).rejects.toThrow(/not allowed/);
    await expect(run("gm", "select app.delete_lead_note($1,'x')", [target])).rejects.toThrow(/not allowed/);
    await expect(run("super", "select app.delete_lead_note($1,'')", [target])).rejects.toThrow(/reason required/);
    await run("super", "select app.delete_lead_note($1,'مكررة بالغلط')", [target]);
    expect((await bodies("tele1", lead))).not.toContain("كتبت فوقها من تاب قديم");
    const s = (await notes("super", lead)).find((n: any) => n.id === target);
    expect(s.deleted_at).toBeTruthy(); expect(s.delete_reason).toBe("مكررة بالغلط");
    expect((await admin.query("select count(*)::int n from lead_notes where id=$1", [target])).rows[0].n).toBe(1);   // soft
    const a = (await admin.query("select reason from audit_logs where entity_type='lead_notes' and entity_id=$1 and action='UPDATE'", [target])).rows;
    expect(a.length).toBe(1); expect(a[0].reason).toBe("مكررة بالغلط");
    await expect(run("super", "select app.delete_lead_note($1,'تاني')", [target])).rejects.toThrow(/already deleted/);
    expect(await latest(lead)).toBe("السيلز: اتفقنا على اجتماع");
  });
  it("distributed data: its note is the first entry, and later notes are added after it", async () => {
    const d = String(Date.now()).slice(-7);
    const rows = [{ row_no: 2, raw: {}, name: "موزع بملاحظة", phone_raw: "053" + d, phone_e164: "+96653" + d, phone_country: "SA", phone_valid: true, store_url: "", store_key: null, status_text: "", notes: "ملاحظة من الملف", hunter: "هنتر", original_added: null, date_text: null }];
    const id = (await run("super", "select app.dist_create($1::jsonb,$2::jsonb) id", [JSON.stringify({ file_name: "n.csv", file_hash: "h" + Math.random(), file_size: 1, file_kind: "csv", mapping: { headers: [] } }), JSON.stringify(rows)])).rows[0].id;
    await run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [ids.tele2]]);
    const l = (await admin.query("select id, call_notes from leads where import_batch_id=$1", [id])).rows[0];
    if (l.call_notes) {
      await run("tele2", "select app.add_lead_note($1,'كلمته')", [l.id]);
      expect(await bodies("tele2", l.id)).toEqual([l.call_notes, "كلمته"]);
    } else {
      await run("tele2", "select app.add_lead_note($1,'كلمته')", [l.id]);
      expect(await bodies("tele2", l.id)).toEqual(["كلمته"]);
    }
  });
});
