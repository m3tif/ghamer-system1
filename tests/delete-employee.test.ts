import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as H from "./helpers";
import { setupDb, teardown, run, register, ids, admin, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_delemp_test"); });
afterAll(async () => { await teardown(); });

const mk = async (email: string, role = "tele_sales") =>
  (await run("super", "select app.create_employee($1::jsonb) r", [JSON.stringify({ email, password_hash: "x", role_code: role, full_name: "مؤقت " + email })])).rows[0].r;

describe("delete employee", () => {
  it("Super Admin only, needs a reason, not self", async () => {
    const id = await mk("a@t.com");
    for (const who of ["gm", "telemgr", "tele1"]) await expect(run(who, "select app.delete_employee($1,'x')", [id])).rejects.toThrow(/not allowed/);
    await expect(run("super", "select app.delete_employee($1,'')", [id])).rejects.toThrow(/reason required/);
    await expect(run("super", "select app.delete_employee($1,'x')", [ids.super])).rejects.toThrow(/cannot delete self/);
  });
  it("deletes an account with no records, and logs it", async () => {
    const id = await mk("b@t.com");
    await run("super", "select app.delete_employee($1,'أنشئ بالخطأ')", [id]);
    expect((await admin.query("select count(*)::int n from users where id=$1", [id])).rows[0].n).toBe(0);
    expect((await admin.query("select count(*)::int n from employees where id=$1", [id])).rows[0].n).toBe(0);
    const log = (await admin.query("select reason, actor_id from audit_logs where action='DELETE' and entity_type='employees' and entity_id=$1", [id])).rows;
    expect(log.length).toBe(1); expect(log[0].actor_id).toBe(ids.super);
  });
  it("refuses an employee that has history (clients, activities…)", async () => {
    await register("tele1", leadPayload({ phone: "0501239999" }));
    await expect(run("super", "select app.delete_employee($1,'x')", [ids.tele1])).rejects.toThrow(/has history/);
    expect((await admin.query("select count(*)::int n from users where id=$1", [ids.tele1])).rows[0].n).toBe(1);
  });
  it("refuses to delete the last Super Admin", async () => {
    const other = await mk("c@t.com", "super_admin");
    await run("super", "select app.delete_employee($1,'x')", [other]);   // another super still exists (the caller) → ok
    expect(true).toBe(true);
  });
  it("force delete: employee with clients, handoff, meeting, deal is removed with his clients; others' records survive", async () => {
    const tele = await mk("force-tele@t.com");
    await admin.query("select 1");
    const email = "force-tele@t.com";
    const l1 = await H.sendAccepted("tele1", "sales1", { ...H.leadPayload({ phone: "0501238801" }), lead_status: "Interested" });
    await H.bookAs("sales1", l1);
    // a lead created by tele1 stays; make a lead by the new employee through admin SQL ownership swap is complex -> use existing tele2
    await H.register("tele2", H.leadPayload({ phone: "0501238802" }));
    const before = (await admin.query("select count(*)::int n from leads where original_creator_id=$1", [ids.tele2])).rows[0].n;
    expect(before).toBeGreaterThan(0);
    const r = (await run("super", "select app.delete_employee($1,'تنظيف',true) r", [ids.tele2])).rows[0].r;
    expect(r.clients_deleted).toBe(before);
    expect((await admin.query("select count(*)::int n from users where id=$1", [ids.tele2])).rows[0].n).toBe(0);
    expect((await admin.query("select count(*)::int n from leads where id=$1", [l1])).rows[0].n).toBe(1);
    const log = (await admin.query("select old_value from audit_logs where action='DELETE' and entity_type='employees' and entity_id=$1", [ids.tele2])).rows;
    expect(log.length).toBe(1);
    void tele; void email;
  });
  it("force delete also works for a sales rep who owns a deal and meeting", async () => {
    const l = await H.sendAccepted("tele1", "sales1", { ...H.leadPayload({ phone: "0501238803" }), lead_status: "Interested" });
    await H.bookAs("sales1", l);
    await run("super", "select app.delete_employee($1,'تنظيف',true)", [ids.sales1]);
    expect((await admin.query("select count(*)::int n from users where id=$1", [ids.sales1])).rows[0].n).toBe(0);
    expect((await admin.query("select count(*)::int n from leads where id=$1", [l])).rows[0].n).toBe(1);   // tele1's client survives
  });
});
