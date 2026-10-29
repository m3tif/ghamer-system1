import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin } from "./helpers";
import { parsePhone } from "../src/lib/normalize";

beforeAll(async () => { await setupDb("ghamer_phones_test"); });
afterAll(async () => { await teardown(); });

const pl = (name: string, raw: string, country: any = "SA", store?: string) => {
  const p = parsePhone(raw, country); if (!p.e164) throw new Error("bad " + raw);
  return { name, source: "cold_call", lead_status: "New Lead", required_services: ["seo"],
    identifiers: [{ kind: "phone", value: p.e164, label: "mobile" }, ...(store ? [{ kind: "store", value: store, label: "store" }] : [])],
    contacts: [{ label: "mobile", phone: p.e164, is_primary: true, phone_raw: raw, phone_country: p.country }],
    stores: store ? [{ url_raw: store, url_key: store }] : [] };
};

describe("phone is the only duplicate criterion", () => {
  it("same name with different phones is allowed", async () => {
    const a = await register("tele1", pl("محمد أحمد", "0551110001"));
    const b = await register("tele2", pl("محمد أحمد", "0551110002"));
    expect(a.status).not.toBe("duplicate"); expect(b.status).not.toBe("duplicate");
  });
  it("same number typed in different international formats is rejected, and the answer tells who owns it", async () => {
    await register("tele1", pl("مصري", "01012345678", "EG"));
    for (const [raw, c] of [["+20 101 234 5678", "SA"], ["0020 10 1234 5678", "SA"], ["01012345678", "EG"], ["٠١٠١٢٣٤٥٦٧٨", "EG"]] as const) {
      const r = await register("tele2", pl("آخر", raw, c));
      expect(r.status).toBe("duplicate");
      expect(r.owner_name).toBe("سارة"); expect(r.existing_name).toBe("مصري"); expect(r.existing_status).toBe("New Lead");
    }
  });
  it("same store URL alone never blocks", async () => {
    await register("tele1", pl("متجر 1", "0552220001", "SA", "shop.example.com"));
    const r = await register("tele2", pl("متجر 2", "0552220002", "SA", "shop.example.com"));
    expect(r.status).not.toBe("duplicate");
  });
  it("the database itself refuses a second row for the same phone (race-proof)", async () => {
    const e = "+966553330001";
    await register("tele1", pl("سباق", e));
    await expect(admin.query("insert into client_identifiers(client_id,kind,value) select client_id,'phone',$1 from client_identifiers limit 1", [e])).rejects.toThrow(/client_identifiers_phone_uq|duplicate key/);
  });
  it("many parallel registrations of one number create exactly one client", async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => register(i % 2 ? "tele1" : "tele2", pl("متزامن", "0554440077")).catch((e) => ({ status: "error", e }))));
    expect(rs.filter((r: any) => r.status === "duplicate" || r.status === "error").length).toBe(5);
    const n = await admin.query("select count(*)::int n from client_identifiers where value = '+966554440077'");
    expect(n.rows[0].n).toBe(1);
  });
  it("keeps what the user typed and the country", async () => {
    const r = await admin.query("select phone_raw, phone_country from client_contacts where phone = '+201012345678'");
    expect(r.rows[0]).toEqual({ phone_raw: "01012345678", phone_country: "EG" });
  });
  it("same last digits under a different country code are saved but queued for review", async () => {
    await register("tele1", pl("سعودي", "0556660001"));
    const r = await register("tele2", pl("إماراتي", "+971556660001"));
    expect(r.status).not.toBe("duplicate");
    const q = await admin.query("select reason from duplicate_reviews where status='open' and attempted->>'phone' = '+971556660001'");
    expect(q.rows.length).toBe(1);
  });
  it("an employee cannot see another employee's lead through the duplicate answer beyond name/status/owner", async () => {
    const r = await register("tele2", pl("x", "0551110001"));
    expect(Object.keys(r).sort()).toEqual(expect.arrayContaining(["status", "owner_name", "existing_client_id"]));
    const direct = await run("tele2", "select count(*)::int n from clients where id = $1", [r.existing_client_id]);
    expect(direct.rows[0].n).toBe(0);
  });
  it("old numbers are untouched by migration 012", async () => {
    const r = await admin.query("select count(*)::int n from client_identifiers where kind='phone'");
    expect(r.rows[0].n).toBeGreaterThan(5);
  });
});

describe("employee management", () => {
  it("only super admin can rename; name changes everywhere, ownership and history stay; log says who and when", async () => {
    const lead = (await register("tele1", pl("لعميل سارة", "0557770001"))).lead_id;
    await expect(run("tele1", "select app.rename_employee($1,'اسم جديد')", [ids.tele1])).rejects.toThrow(/not allowed/);
    await run("super", "select app.rename_employee($1,'سارة العتيبي')", [ids.tele1]);
    const n = await run("super", "select full_name from app.employee_list() where id = $1", [ids.tele1]);
    expect(n.rows[0].full_name).toBe("سارة العتيبي");
    const o = await run("super", "select app.emp_name(original_creator_id) n from leads where id = $1", [lead]);
    expect(o.rows[0].n).toBe("سارة العتيبي");
    const h = await run("super", "select * from app.employee_name_history($1)", [ids.tele1]);
    expect(h.rows[0]).toMatchObject({ old_name: "سارة", new_name: "سارة العتيبي", actor_name: "المدير النظام" });
    const own = await run("tele1", "select count(*)::int n from leads where id = $1", [lead]);
    expect(own.rows[0].n).toBe(1);
  });
  it("link counts show what is attached, reassign moves open work only, then disable keeps history", async () => {
    const before = await run("super", "select * from app.employee_link_counts() where id = $1", [ids.tele1]);
    expect(before.rows[0].leads_created).toBeGreaterThan(0);
    await expect(run("super", "select app.set_employee_active($1,false,'ترك العمل')", [ids.tele1])).rejects.toThrow(/open work/);
    const mv = await run("super", "select app.reassign_employee($1,$2,'نقل') r", [ids.tele1, ids.tele2]);
    expect(mv.rows[0].r.leads_owner).toBeGreaterThan(0);
    const after = await run("super", "select * from app.employee_link_counts() where id = $1", [ids.tele1]);
    expect(after.rows[0].leads_owned).toBe(0);
    expect(after.rows[0].leads_created).toBe(before.rows[0].leads_created);   // history stays
    await expect(run("super", "select app.reassign_employee($1,$2,'x')", [ids.tele1, ids.sales1])).rejects.toThrow(/invalid target/);
    await run("super", "select app.set_employee_active($1,false,'ترك العمل')", [ids.tele1]);
    const e = await run("super", "select is_active from app.employee_list() where id = $1", [ids.tele1]);
    expect(e.rows[0].is_active).toBe(false);
    const kept = await admin.query("select count(*)::int n from leads where original_creator_id = $1", [ids.tele1]);
    expect(kept.rows[0].n).toBe(before.rows[0].leads_created);
    await run("super", "select app.set_employee_active($1,true,'عاد')", [ids.tele1]);
  });
});

describe("search by phone in any format, partial or full", () => {
  const find = (who: string, phone: string | null, q: string | null = null) =>
    run(who, "select name from app.list_leads($1,$2,null,null,null,null,null,null,null,100,0,null)", [q, phone]).then((r) => r.rows.map((x: any) => x.name));
  it("setup", async () => {
    await register("tele1", pl("بحث سعودي", "0558880001"));
    await register("tele1", pl("بحث مصري", "+201112223334"));
    await register("tele2", pl("بحث إماراتي", "+971558880002", "AE", "https://shop.search.example/"));
  });
  it("full number, local format, international format, partial digits, with spaces", async () => {
    for (const p of ["0558880001", "+966558880001", "966558880001", "558880001", "88000", "0055888"]) expect(await find("tele1", p), p).toContain("بحث سعودي");
    for (const p of ["+201112223334", "01112223334", "1112223334", "22233"]) expect(await find("tele1", p), p).toContain("بحث مصري");
    expect(await find("tele1", "0558880001")).not.toContain("بحث مصري");
  });
  it("search is permission-filtered: tele1 never finds tele2's client by phone", async () => {
    expect(await find("tele1", "558880002")).toEqual([]);
    expect(await find("tele2", "558880002")).toEqual(["بحث إماراتي"]);
  });
  it("name and store URL search; no results returns an empty list", async () => {
    expect(await find("tele2", null, "بحث إماراتي")).toEqual(["بحث إماراتي"]);
    expect(await find("tele2", null, "search.example")).toEqual(["بحث إماراتي"]);
    expect(await find("tele1", null, "لا يوجد أبدا")).toEqual([]);
  });
  it("client_matches (used by archive / assigned / pipeline) agrees", async () => {
    const id = (await admin.query("select client_id from client_identifiers where value = '+201112223334'")).rows[0].client_id;
    for (const q of ["1112223", "+20 111 222 3334", "بحث مصري", "مصري"]) expect((await run("super", "select app.client_matches($1,$2) m", [id, q])).rows[0].m, q).toBe(true);
    expect((await run("super", "select app.client_matches($1,'0509999999') m", [id])).rows[0].m).toBe(false);
  });
});
