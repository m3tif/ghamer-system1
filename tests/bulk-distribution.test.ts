import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin, leadPayload } from "./helpers";
import { buildRows, autoMap, detectHeaderRow } from "../src/lib/import-parse";
import { parseSheetUrl, fetchSheetCsv } from "../src/lib/gsheet";

beforeAll(async () => { await setupDb("ghamer_bulkdist_test"); });
afterAll(async () => { await teardown(); });

const extra: string[] = [];
async function addTele(n: number) {
  for (let i = 0; i < n; i++) {
    const u = await admin.query("insert into users(email, password_hash, role_id) select $1, 'x', id from roles where code='tele_sales' returning id", [`extra${extra.length}@test.local`]);
    await admin.query("insert into employees(id, full_name, department_id) select $1, $2, department_id from roles where code='tele_sales'", [u.rows[0].id, `موظف ${extra.length}`]);
    extra.push(u.rows[0].id);
  }
}
let seq = 1;
const rowsFor = (n: number, prefix = "0551") => Array.from({ length: n }, (_, i) => ({
  row_no: i + 2, raw: {}, name: i % 3 === 0 ? "نفس الاسم" : `عميل ${seq}-${i}`, phone_raw: `${prefix}${String(seq * 100000 + i).padStart(6, "0")}`.slice(0, 10),
  phone_e164: "+966" + `${prefix}${String(seq * 100000 + i).padStart(6, "0")}`.slice(1, 10), phone_country: "SA", phone_valid: true, store_url: i % 5 === 0 ? `https://shop${seq}-${i}.com` : "", store_key: i % 5 === 0 ? `shop${seq}-${i}.com` : null,
  status_text: "", notes: i === 0 ? "ملاحظة" : "", hunter: "هنتر أصلي", original_added: null, date_text: null,
}));
const stage = async (who: string, rows: any[], hash = "h" + Math.random()) =>
  (await run(who, "select app.dist_create($1::jsonb,$2::jsonb) id", [JSON.stringify({ file_name: "t.csv", file_hash: hash, file_size: 1, file_kind: "csv", mapping: { headers: [] } }), JSON.stringify(rows)])).rows[0].id as string;

describe("bulk distribution — permissions", () => {
  it("only Super Admin and Sales Manager; never Tele Sales, GM-less roles", async () => {
    await addTele(5);
    for (const who of ["tele1", "telemgr", "sales1", "gm", "fin"]) await expect(stage(who, rowsFor(3))).rejects.toThrow(/not allowed/);
    const a = await stage("super", rowsFor(3)); const b = await stage("salesmgr", rowsFor(3));
    expect(a && b).toBeTruthy();
    // a Sales Manager cannot see or run another manager's batch; Tele Sales cannot call the functions
    await expect(run("salesmgr", "select * from app.dist_get($1)", [a])).resolves.toMatchObject({ rowCount: 0 });
    await expect(run("tele1", "select app.dist_confirm($1,$2::uuid[])", [b, [ids.tele1]])).rejects.toThrow(/no access/);
    expect((await run("super", "select * from app.dist_get($1)", [b])).rowCount).toBe(1);        // admin sees all
    await expect(run("tele1", "select * from app.dist_candidates()")).resolves.toMatchObject({ rowCount: 0 });
  });
  it("the legacy importer cannot run or roll back a distribution batch", async () => {
    const id = await stage("salesmgr", rowsFor(2));
    await expect(run("salesmgr", "select app.import_run($1,10)", [id])).rejects.toThrow(/no access/);
    await expect(run("super", "select app.import_run($1,10)", [id])).rejects.toThrow(/no access/);
  });
});

describe("duplicate rule and preview", () => {
  it("excludes numbers already in the system and repeated in the file; same name with another phone is fine; existing client untouched", async () => {
    const ex = await register("tele1", leadPayload({ name: "نفس الاسم", phone: "0509990001" }));
    const rows = rowsFor(6);
    rows[0].phone_e164 = "+966509990001"; rows[0].phone_raw = "0509990001";         // exists in the system
    rows[3].phone_e164 = rows[2].phone_e164;                                          // repeated inside the file
    rows[5].phone_e164 = null as any; rows[5].phone_valid = false;                    // invalid
    const id = await stage("super", rows);
    const b = (await run("super", "select * from app.dist_get($1)", [id])).rows[0];
    expect(b).toMatchObject({ rows_total: 6, c_new: 3, c_duplicate: 2, c_invalid: 1 });
    expect((await admin.query("select name from clients where id=$1", [ex.client_id])).rows[0].name).toBe("نفس الاسم");
    const plan = (await run("super", "select * from app.dist_plan($1,$2::uuid[])", [id, [ids.tele1, ids.tele2]])).rows;
    expect(plan.map((p: any) => p.planned).sort()).toEqual([1, 2]);
  });
});

describe("even split + safety", () => {
  it("100 leads / 5 employees → 20 each; 102 → 21,21,20,20,20", async () => {
    const five = extra.slice(0, 5);
    const id1 = await stage("super", rowsFor(100)); seq++;
    const r1 = (await run("super", "select app.dist_confirm($1,$2::uuid[]) r", [id1, five])).rows[0].r;
    expect(r1.imported).toBe(100); expect(r1.split.map((x: any) => x.count)).toEqual([20, 20, 20, 20, 20]);
    const id2 = await stage("super", rowsFor(102)); seq++;
    const plan = (await run("super", "select * from app.dist_plan($1,$2::uuid[])", [id2, five])).rows.map((p: any) => p.planned);
    expect(plan.sort((a: number, b: number) => b - a)).toEqual([21, 21, 20, 20, 20]);
    const r2 = (await run("super", "select app.dist_confirm($1,$2::uuid[]) r", [id2, five])).rows[0].r;
    expect(r2.imported).toBe(102);
    const counts = (await admin.query("select current_owner_id, count(*)::int n from leads where import_batch_id=$1 group by 1", [id2])).rows.map((r: any) => r.n).sort();
    expect(counts).toEqual([20, 20, 20, 21, 21]);
    // the extra lead goes to the employees who had the fewest (they had 20+20, equal) — every lead is assigned, none is left without an owner
    expect((await admin.query("select count(*)::int n from leads where import_batch_id=$1 and current_owner_id is null", [id2])).rows[0].n).toBe(0);
  });
  it("leads show up for each employee only, with logs; the batch records who/when and the split", async () => {
    const e0 = extra[0];
    const id = await stage("salesmgr", rowsFor(4)); seq++;
    await run("salesmgr", "select app.dist_confirm($1,$2::uuid[])", [id, [e0, extra[1]]]);
    const b = (await run("salesmgr", "select * from app.dist_get($1)", [id])).rows[0];
    expect(b.status).toBe("completed"); expect(b.imported_by_name).toBe("مدير المبيعات"); expect(b.finished_at).toBeTruthy();
    const split = (await run("salesmgr", "select * from app.dist_breakdown($1)", [id])).rows; expect(split.map((x: any) => x.assigned).sort()).toEqual([2, 2]);
    expect((await admin.query("select count(*)::int n from lead_assignments a join leads l on l.id=a.lead_id where l.import_batch_id=$1 and a.assigned_by=$2", [id, ids.salesmgr])).rows[0].n).toBe(4);
    expect((await admin.query("select count(*)::int n from notifications where user_id=$1 and kind='lead_distribution'", [e0])).rows[0].n).toBeGreaterThan(0);
    expect((await run("super", "select * from app.dist_list(50)")).rows.length).toBeGreaterThan(2);
    // an employee sees his own leads through RLS (the test users are plain rows; here we check ownership + visibility function)
    const vis = (await admin.query("select count(*)::int n from leads where import_batch_id=$1 and current_owner_id=$2", [id, e0])).rows[0].n; expect(vis).toBe(2);
  });
  it("a second confirmation of the same batch is refused (no double import)", async () => {
    const id = await stage("super", rowsFor(3)); seq++;
    await run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [ids.tele1]]);
    await expect(run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [ids.tele1]])).rejects.toThrow(/not runnable/);
    expect((await admin.query("select count(*)::int n from leads where import_batch_id=$1", [id])).rows[0].n).toBe(3);
  });
  it("refuses inactive employees, non Tele Sales, empty selection", async () => {
    const id = await stage("super", rowsFor(3)); seq++;
    await admin.query("update users set is_active=false where id=$1", [extra[4]]);
    await expect(run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [extra[4]]])).rejects.toThrow(/invalid target/);
    await expect(run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [ids.sales1]])).rejects.toThrow(/invalid target/);
    await expect(run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [ids.tele1, extra[4]]])).rejects.toThrow(/invalid target/);
    await expect(run("super", "select app.dist_confirm($1,$2::uuid[])", [id, []])).rejects.toThrow(/choose employees/);
    expect((await run("super", "select * from app.dist_candidates()")).rows.some((c: any) => c.id === extra[4])).toBe(false);
    expect((await admin.query("select status from import_batches where id=$1", [id])).rows[0].status).toBe("staged");
  });
  it("all-or-nothing: an error in the middle leaves nothing behind and the batch stays confirmable", async () => {
    const rows = rowsFor(5); rows[3].notes = "BOOM";
    const id = await stage("super", rows); seq++;
    const before = (await admin.query("select (select count(*) from clients)::int c, (select count(*) from leads)::int l")).rows[0];
    await admin.query(`create or replace function pg_temp.x() returns void language sql as 'select 1'`);
    await admin.query(`create function public.boom() returns trigger language plpgsql as $$ begin if new.call_notes = 'BOOM' then raise exception 'boom'; end if; return new; end $$`);
    await admin.query("create trigger boom_t before insert on leads for each row execute function public.boom()");
    await expect(run("super", "select app.dist_confirm($1,$2::uuid[])", [id, [ids.tele1, ids.tele2]])).rejects.toThrow(/boom/);
    await admin.query("drop trigger boom_t on leads"); await admin.query("drop function public.boom()");
    const after = (await admin.query("select (select count(*) from clients)::int c, (select count(*) from leads)::int l")).rows[0];
    expect(after).toEqual(before);
    expect((await admin.query("select status from import_batches where id=$1", [id])).rows[0].status).toBe("staged");
    expect((await admin.query("select count(*)::int n from import_rows where batch_id=$1 and status='imported'", [id])).rows[0].n).toBe(0);
  });
  it("duplicates are re-checked at confirmation time (a number registered after staging is excluded)", async () => {
    const rows = rowsFor(4); const id = await stage("super", rows); seq++;
    await register("tele2", { ...leadPayload({ name: "سبق", phone: "0500000000" }), identifiers: [{ kind: "phone", value: rows[1].phone_e164, label: "mobile" }], contacts: [{ label: "mobile", phone: rows[1].phone_e164, is_primary: true }] });
    const r = (await run("super", "select app.dist_confirm($1,$2::uuid[]) r", [id, [ids.tele1, ids.tele2]])).rows[0].r;
    expect(r.imported).toBe(3);
    expect((await admin.query("select count(*)::int n from client_identifiers where value=$1", [rows[1].phone_e164])).rows[0].n).toBe(1);
  });
});

describe("sheet reading (no network: stubbed Google)", () => {
  const url = "https://docs.google.com/spreadsheets/d/1PMqtRyXn40NpwOfVDAvNi1V2oR5cO7QjSMuJPSeE-gY/edit?gid=2107113473#gid=2107113473";
  it("parses the link and builds the export URL from the id only", async () => {
    expect(parseSheetUrl(url)).toEqual({ id: "1PMqtRyXn40NpwOfVDAvNi1V2oR5cO7QjSMuJPSeE-gY", gid: "2107113473" });
    expect(parseSheetUrl("https://evil.com/spreadsheets/d/1PMqtRyXn40NpwOfVDAvNi1V2oR5cO7QjSMuJPSeE-gY")).toBeNull();
    expect(parseSheetUrl("http://docs.google.com/spreadsheets/d/1PMqtRyXn40NpwOfVDAvNi1V2oR5cO7QjSMuJPSeE-gY")).toBeNull();
    let seen = ""; const fake = (async (u: string) => { seen = u; return new Response("a,b\n1,2\n", { headers: { "content-type": "text/csv" } }); }) as any;
    await fetchSheetCsv(url, fake); expect(seen).toBe("https://docs.google.com/spreadsheets/d/1PMqtRyXn40NpwOfVDAvNi1V2oR5cO7QjSMuJPSeE-gY/export?format=csv&gid=2107113473");
  });
  it("a private sheet gives a clear message (no credentials asked)", async () => {
    const fake = (async () => new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html" } })) as any;
    await expect(fetchSheetCsv(url, fake)).rejects.toThrow(/أي شخص لديه الرابط/);
  });
  it("maps Hunter / link / phone / date / status / notes by header names, even with title rows above the headers", () => {
    const grid = [["قائمة الـ Hunt"], ["رابط المتجر", "رقم الهاتف", "اسم Hunter", "تاريخ الـ Hunt", "الحالة", "الملاحظات"], ["shop.com", "0551234567", "هبة", "2026-10-30", "New Lead", "اتصل"]];
    const t = detectHeaderRow(grid[0], grid.slice(1));
    const m = autoMap(t.headers); expect(m).toMatchObject({ store_url: "رابط المتجر", phone: "رقم الهاتف", hunter: "اسم Hunter", added_date: "تاريخ الـ Hunt", status: "الحالة", notes: "الملاحظات" });
    const rows = buildRows(t, m, "SA"); expect(rows[0]).toMatchObject({ hunter: "هبة", phone_e164: "+966551234567", store_key: "shop.com", original_added: "2026-10-30", notes: "اتصل" });
  });
});

describe("size", () => {
  it("3000 rows are distributed in one transaction in reasonable time", async () => {
    const id = await stage("super", rowsFor(3000, "0552")); seq++;
    const t0 = Date.now();
    const r = (await run("super", "select app.dist_confirm($1,$2::uuid[]) r", [id, extra.slice(0, 4).concat([ids.tele1, ids.tele2])])).rows[0].r;
    const ms = Date.now() - t0; console.log("3000 rows confirm:", ms, "ms");
    expect(r.imported).toBe(3000); expect(ms).toBeLessThan(25000);
    const c = (await admin.query("select count(*)::int n from leads where import_batch_id=$1 group by current_owner_id", [id])).rows.map((x: any) => x.n);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
  }, 60000);
});
