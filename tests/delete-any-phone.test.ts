import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, ids, admin, sendAccepted, bookAs } from "./helpers";
import { parsePhoneAny } from "../src/lib/normalize";

beforeAll(async () => { await setupDb("ghamer_delete_test"); });
afterAll(async () => { await teardown(); });

const pay = (raw: string, name = "") => {
  const p = parsePhoneAny(raw)!; if (!p.value) throw new Error("bad " + raw);
  return { name, source: "cold_call", lead_status: "New Lead", required_services: [], identifiers: [{ kind: "phone", value: p.value, label: "mobile" }],
           contacts: [{ label: "mobile", phone: p.value, is_primary: true, phone_raw: raw, phone_country: p.country }], stores: [] };
};

describe("any phone, no country picker", () => {
  it("recognises local numbers of different countries and the same number typed differently", () => {
    expect(parsePhoneAny("0501234567").value).toBe("+966501234567");
    expect(parsePhoneAny("01012345678").value).toBe("+201012345678");
    expect(parsePhoneAny("+20 101 234 5678").value).toBe("+201012345678");
    expect(parsePhoneAny("00201012345678").value).toBe("+201012345678");
    expect(parsePhoneAny("+971 50 123 4567").value).toBe("+971501234567");
    expect(parsePhoneAny("٠٥٠١٢٣٤٥٦٧").value).toBe("+96650123456" + "7");
  });
  it("accepts odd numbers (kept as digits) and rejects only absurd lengths", () => {
    expect(parsePhoneAny("123456").value).toBe("123456");
    expect(parsePhoneAny("+999 123 456 789").value).toBe("+999123456789");
    expect(parsePhoneAny("12345").value).toBeNull();
    expect(parsePhoneAny("1234567890123456").value).toBeNull();
    expect(parsePhoneAny("abc").value).toBeNull();
  });
  it("a lead can be saved with no name, and a second one with the same number is still a duplicate", async () => {
    const a = await register("tele1", pay("0501230001"));
    expect(a.status).toBe("created");
    expect((await admin.query("select name from clients where id=$1", [a.client_id])).rows[0].name).toBe("بدون اسم");
    const b = await register("tele2", pay("+966 50 123 0001", "اسم"));
    expect(b.status).toBe("duplicate");
  });
});

describe("complete deletion by the Super Admin", () => {
  let lead: string, client: string;
  it("only the Super Admin can delete (not GM, managers or employees)", async () => {
    const r = await register("tele1", pay("0501230002", "للحذف"));
    lead = r.lead_id; client = r.client_id;
    for (const who of ["tele1", "telemgr", "gm", "sales1"]) await expect(run(who, "select app.delete_client($1,'x')", [client])).rejects.toThrow(/not allowed/);
    await expect(run("super", "select app.delete_client($1,'')", [client])).rejects.toThrow(/reason required/);
  });
  it("removes the client with its meeting, deal, hand-off, activities and releases the number; keeps a log", async () => {
    const l = await sendAccepted("tele1", "sales1", { ...pay("0501230003", "كامل"), lead_status: "Interested" });
    await bookAs("sales1", l);
    const c = (await admin.query("select client_id from leads where id=$1", [l])).rows[0].client_id;
    for (const cl of [c, client]) await run("super", "select app.delete_client($1,'تنظيف')", [cl]);
    for (const t of ["clients", "leads", "meetings", "deals", "lead_handoffs", "client_identifiers", "client_contacts"]) {
      const n = (await admin.query(`select count(*)::int n from ${t} where ${t === "clients" ? "id" : t === "leads" ? "client_id" : t === "meetings" || t === "lead_handoffs" ? "lead_id" : t === "deals" ? "client_id" : "client_id"} = any($1)`, [[c, client]])).rows[0].n;
      expect(n, t).toBe(0);
    }
    const log = (await admin.query("select old_value, reason, actor_id from audit_logs where action='DELETE' and entity_type='clients' order by id desc limit 2")).rows;
    expect(log.length).toBe(2); expect(log[0].reason).toBe("تنظيف"); expect(log[0].actor_id).toBe(ids.super);
    // the number is free again
    expect((await register("tele2", pay("0501230002", "من جديد"))).status).toBe("created");
  });
  it("delete a whole month of one employee", async () => {
    for (const p of ["0501230010", "0501230011"]) await register("tele2", pay(p, "شهري"));
    const month = new Date().toISOString().slice(0, 7) + "-01";
    await expect(run("telemgr", "select app.delete_leads_month($1,$2,'x')", [ids.tele2, month])).rejects.toThrow(/not allowed/);
    const n = (await run("super", "select app.delete_leads_month($1,$2,'تنظيف الشهر') n", [ids.tele2, month])).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(3);
    expect((await admin.query("select count(*)::int n from leads where original_creator_id=$1", [ids.tele2])).rows[0].n).toBe(0);
    expect((await admin.query("select count(*)::int n from leads where original_creator_id=$1", [ids.tele1])).rows[0].n).toBeGreaterThan(0);   // others untouched
  });
});
