import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { setupDb, teardown, run, register, leadPayload, ids, admin } from "./helpers";
import { autoMap, buildRows, parseDate, readTable, sha256 } from "../src/lib/import-parse";

beforeAll(async () => { await setupDb("ghamer_import_test"); });
afterAll(async () => { await teardown(); });

const CSV = [
  "الاسم,رقم الهاتف,رقم بديل,اسم النشاط التجاري,رابط المتجر,تاريخ الإضافة,الحالة,ملاحظات",
  "محمد أحمد,0501110001,,متجر أ,https://a.example.com,2025-03-14,New Lead,ملاحظة 1",      // 2  new
  "محمد أحمد,0501110002,,,,14/04/2025,Interested,",                                         // 3  same name, other phone → new
  "عميل مكرر,+966 50 111 0003,,,,,,",                                                         // 4  duplicate of existing (other format)
  "نفس الرقم,00966501110001,,,,,,",                                                          // 5  duplicate inside the file (row 2)
  "رقم خربان,12345,,,,,,",                                                                    // 6  invalid
  ",0501110004,,,,,,",                                                                        // 7  review: no name
  "مصري,01012345678,,,,2025-05-02,,",                                                        // 8  new (Egypt number typed locally → needs EG default? SA default makes it invalid)
  "مصري دولي,+20 101 234 5679,,,,,,",                                                        // 9  new (international)
  "إماراتي,+971501110010,0501110011,,,,,",                                                    // 10 new + alt
].join("\n");

async function stage(who: string, owner: string, csv = CSV, o: { name?: string; country?: string; orig?: string } = {}) {
  const buf = Buffer.from(csv, "utf-8");
  const { kind, table } = await readTable(buf, o.name ?? "old.csv");
  const map = autoMap(table.headers);
  const rows = buildRows(table, map, o.country ?? "SA");
  const header = { file_name: o.name ?? "old.csv", file_hash: sha256(buf), file_size: buf.length, file_kind: kind, data_owner_id: ids[owner], original_employee_name: o.orig ?? "أحمد (قديم)", default_country: o.country ?? "SA", mapping: { ...map, headers: table.headers } };
  const r = await run(who, "select app.import_create($1::jsonb,$2::jsonb) id", [JSON.stringify(header), JSON.stringify(rows)]);
  return r.rows[0].id as string;
}
const batch = (who: string, id: string) => run(who, "select * from app.import_get($1)", [id]).then((r) => r.rows[0]);
const rowsOf = (who: string, id: string) => run(who, "select * from app.import_rows_page($1,null,500,0)", [id]).then((r) => r.rows);

describe("file parsing", () => {
  it("auto-maps Arabic headers and parses dates without inventing any", () => {
    const m = autoMap(["الاسم", "رقم الهاتف", "تاريخ الإضافة", "اسم النشاط التجاري"]);
    expect(m).toMatchObject({ name: "الاسم", phone: "رقم الهاتف", added_date: "تاريخ الإضافة", business_name: "اسم النشاط التجاري" });
    expect(parseDate("2025-03-14")).toBe("2025-03-14"); expect(parseDate("14/03/2025")).toBe("2025-03-14"); expect(parseDate("٢٠٢٥/٠٣/١٤")).toBe("2025-03-14");
    expect(parseDate("45000")).toBe("2023-03-15");
    expect(parseDate("")).toBeNull(); expect(parseDate("sometime last year")).toBeNull(); expect(parseDate("2999-01-01")).toBeNull(); expect(parseDate("31/02/2025")).toBeNull();
  });
  it("reads xlsx and csv, rejects fake / oversized / unsupported files", async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("x"); ws.addRow(["Name", "Phone"]); ws.addRow(["Ali", 501234567]); ws.addRow(["Sara", "+201012345678"]);
    const x = await readTable(Buffer.from(await wb.xlsx.writeBuffer()), "a.xlsx");
    expect(x.kind).toBe("xlsx"); expect(x.table.rows).toEqual([["Ali", "501234567"], ["Sara", "+201012345678"]]);
    const c = await readTable(Buffer.from("﻿Name;Phone\r\n\"Ali, B\";0501234567\r\n", "utf-8"), "a.csv");
    expect(c.table.rows[0]).toEqual(["Ali, B", "0501234567"]);
    await expect(readTable(Buffer.from("not a zip"), "a.xlsx")).rejects.toThrow(/Excel/);
    await expect(readTable(Buffer.from("x,y\n1,2"), "a.exe")).rejects.toThrow(/غير مدعوم/);
    await expect(readTable(Buffer.alloc(5 * 1024 * 1024, 65), "a.csv")).rejects.toThrow(/4 ميجابايت/);
    await expect(readTable(Buffer.from("name,phone\n"), "a.csv")).rejects.toThrow(/لا يحتوي/);
    await expect(readTable(Buffer.from([110, 0, 1, 2]), "a.csv")).rejects.toThrow(/CSV/);
  });
});

describe("classification and import", () => {
  let id: string;
  it("setup: an existing client registered by another employee", async () => {
    await register("tele2", leadPayload({ name: "عميل نورة", phone: "0501110003", store: "https://ex-store.example.com" }));
  });
  it("staging touches nothing; summary has new / duplicate / invalid / review", async () => {
    const before = (await admin.query("select count(*)::int n from clients")).rows[0].n;
    id = await stage("tele1", "tele1");
    expect((await admin.query("select count(*)::int n from clients")).rows[0].n).toBe(before);
    const b = await batch("tele1", id);
    expect(b).toMatchObject({ rows_total: 9, c_duplicate: 2, c_invalid: 1, c_review: 0, c_new: 6 /* a row without a name is fine; a local Egyptian number is recognised without any country setting */, status: "staged" });
    const rs = await rowsOf("tele1", id);
    expect(rs.find((r: any) => r.row_no === 4)).toMatchObject({ status: "duplicate" });
    expect(rs.find((r: any) => r.row_no === 4).diff).toBeNull();                    // tele1 may not see tele2's client
    expect(rs.find((r: any) => r.row_no === 4).reason).toMatch(/موظف آخر/);
    expect(rs.find((r: any) => r.row_no === 5)).toMatchObject({ status: "duplicate", reason: expect.stringMatching(/الصف 2/) });
    expect(rs.find((r: any) => r.row_no === 7)).toMatchObject({ status: "new", name: null });
    expect(rs.find((r: any) => r.row_no === 8)).toMatchObject({ status: "new", phone_e164: "+201012345678" });
  });
  it("same name with a different phone is a new client", async () => {
    const rs = await rowsOf("tele1", id);
    expect(rs.filter((r: any) => r.name === "محمد أحمد").map((r: any) => r.status)).toEqual(["new", "new"]);
  });
  it("fixing a row is still possible (here: a wrong number corrected)", async () => {
    const bad = (await rowsOf("tele1", id)).find((r: any) => r.row_no === 6);
    expect(bad.status).toBe("invalid");
    await run("tele1", "select app.import_fix_row($1,null,'+201099900011','EG',true)", [bad.id]);
    expect((await batch("tele1", id)).c_new).toBe(7);
  });
  it("another employee cannot see, run or fix this batch", async () => {
    expect((await run("tele2", "select * from app.import_get($1)", [id])).rows.length).toBe(0);
    await expect(run("tele2", "select app.import_run($1,50)", [id])).rejects.toThrow(/no access/);
    expect((await run("sales1", "select * from app.import_batches_list()")).rows.length).toBe(0);
  });
  it("an employee cannot import for someone else; GM has no import permission", async () => {
    const buf = Buffer.from(CSV); const h = (o: string) => JSON.stringify({ file_name: "x.csv", file_hash: "zz" + o, file_size: 1, file_kind: "csv", data_owner_id: ids[o] });
    await expect(run("tele1", "select app.import_create($1::jsonb,'[{\"row_no\":2}]')", [h("tele2")])).rejects.toThrow(/not allowed/);
    await expect(run("gm", "select app.import_create($1::jsonb,'[{\"row_no\":2}]')", [h("tele1")])).rejects.toThrow(/not allowed/);
    await expect(run("fin", "select app.import_create($1::jsonb,'[{\"row_no\":2}]')", [h("fin")])).rejects.toThrow(/not allowed/);
    void buf;
  });
  it("runs in chunks, parallel runs never double-import, stores origin info and the original date", async () => {
    const [a, b] = await Promise.all([run("tele1", "select app.import_run($1,2) r", [id]), run("tele1", "select app.import_run($1,2) r", [id])]);
    expect(a.rows[0].r.imported + b.rows[0].r.imported).toBe(4);
    let last: any = { done: false };
    for (let i = 0; i < 5 && !last.done; i++) last = (await run("tele1", "select app.import_run($1,2) r", [id])).rows[0].r;
    expect(last.done).toBe(true);
    const n = (await admin.query("select count(*)::int n from leads where import_batch_id = $1", [id])).rows[0].n;
    expect(n).toBe(7);
    const done = await batch("tele1", id);
    expect(done).toMatchObject({ status: "completed", c_imported: 7, c_new: 0 });
    const l = (await admin.query(`select l.*, c.name, c.original_creator_id oc from leads l join clients c on c.id=l.client_id join client_contacts cc on cc.client_id=c.id where cc.phone='+966501110001'`)).rows[0];
    expect(l.original_creator_id).toBe(ids.tele1); expect(l.imported_by).toBe(ids.tele1); expect(l.original_employee_name).toBe("أحمد (قديم)");
    expect(l.created_month.toISOString().slice(0, 10)).toBe("2025-03-01"); expect(l.date_known).toBe(true);
    const nodate = (await admin.query(`select l.date_known, l.created_at from leads l join client_contacts cc on cc.client_id=l.client_id where cc.phone='+971501110010'`)).rows[0];
    expect(nodate.date_known).toBe(false);
    expect(Date.now() - nodate.created_at.getTime()).toBeLessThan(120000);          // import time, not an invented past date
    const alt = (await admin.query("select 1 from client_identifiers where value = '+966501110011'")).rows.length;
    expect(alt).toBe(1);
    expect((await run("tele1", "select count(*)::int n from leads where import_batch_id = $1", [id])).rows[0].n).toBe(7);
  });
  it("existing clients are never overwritten", async () => {
    const c = (await admin.query("select name from clients c join client_contacts cc on cc.client_id=c.id where cc.phone='+966501110003'")).rows;
    expect(c).toEqual([{ name: "عميل نورة" }]);
  });
  it("importing the same file again is refused; the same rows through another file import nothing", async () => {
    await expect(stage("tele1", "tele1")).rejects.toThrow(/already imported/);
    await expect(run("tele1", "select app.import_run($1,50)", [id])).rejects.toThrow(/not runnable/);
    const id2 = await stage("tele1", "tele1", CSV + "\n", { name: "again.csv" });
    const b = await batch("tele1", id2);
    expect(b.c_new).toBe(0); expect(b.c_duplicate).toBe(8);
    await run("tele1", "select app.import_cancel($1)", [id2]);
  });
  it("admin sees the differences against an existing client and can fill only its empty fields", async () => {
    const id3 = await stage("super", "tele1", "الاسم,رقم الهاتف,اسم النشاط التجاري,رابط المتجر\nاسم مختلف,0501110003,مؤسسة الجديدة,https://new-store.example.com", { name: "adm.csv" });
    const r = (await rowsOf("super", id3))[0];
    expect(r.status).toBe("duplicate"); expect(r.diff.name.existing).toBe("عميل نورة"); expect(r.diff.business_name.file).toBe("مؤسسة الجديدة");
    await expect(run("tele1", "select app.import_apply_update($1)", [r.id])).rejects.toThrow(/not allowed/);
    await run("super", "select app.import_apply_update($1)", [r.id]);
    const c = (await admin.query("select name, business_name from clients c join client_contacts cc on cc.client_id=c.id where cc.phone='+966501110003'")).rows[0];
    expect(c).toEqual({ name: "عميل نورة", business_name: "مؤسسة الجديدة" });                // name untouched, empty field filled
    await run("super", "select app.import_cancel($1)", [id3]);
  });
  it("a sales employee can import his own data; it lands in his own list", async () => {
    const sid = await stage("sales1", "sales1", "name,phone\nسيلز عميل,0509990001", { name: "s.csv" });
    await run("sales1", "select app.import_run($1,50)", [sid]);
    expect((await run("sales1", "select count(*)::int n from leads where import_batch_id=$1", [sid])).rows[0].n).toBe(1);
    expect((await run("sales2", "select count(*)::int n from leads where import_batch_id=$1", [sid])).rows[0].n).toBe(0);
  });
  it("rollback hides untouched imports, frees their numbers and keeps leads that were modified later", async () => {
    const touched = (await admin.query("select l.id from leads l join client_contacts cc on cc.client_id=l.client_id where cc.phone='+966501110002'")).rows[0].id;
    await run("tele1", "update leads set call_notes = 'عدّلتها بعد الاستيراد' where id = $1", [touched]);
    await expect(run("tele2", "select app.import_rollback($1,'x')", [id])).rejects.toThrow(/no access/);
    const r = (await run("tele1", "select app.import_rollback($1,'ملف خطأ') r", [id])).rows[0].r;
    expect(r).toMatchObject({ rolled_back: 6, kept: 1 });
    const left = (await run("tele1", "select count(*)::int n from leads where import_batch_id=$1", [id])).rows[0].n;
    expect(left).toBe(1);                                                                // only the modified one is still visible
    expect((await admin.query("select count(*)::int n from leads where import_batch_id=$1", [id])).rows[0].n).toBe(7);   // nothing deleted
    expect((await batch("tele1", id)).status).toBe("rolled_back");
    const again = await stage("tele1", "tele1");                                         // numbers are free again → the file can be re-imported
    expect((await batch("tele1", again)).c_new).toBeGreaterThanOrEqual(3);
  });
});
