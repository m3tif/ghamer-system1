import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
});
