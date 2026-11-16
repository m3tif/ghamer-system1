import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, admin, leadPayload, sendAccepted, register } from "./helpers";

// Tele Sales rename the client from the leads table (same SQL as quickEditAction): own leads, leads handed to Sales, nobody else's.
const rename = (who: string, lead: string, name: string) =>
  run(who, "update clients set name = $2 where id = (select client_id from leads where id = $1) and name is distinct from $2", [lead, name]);
const nameOf = async (lead: string) => (await admin.query("select c.name from clients c join leads l on l.client_id = c.id where l.id = $1", [lead])).rows[0].name;

describe("Tele Sales can rename their clients", () => {
  let own: string; let handed: string;
  beforeAll(async () => {
    await setupDb("ghamer_test_names");
    own = (await register("tele1", leadPayload({ name: "", phone: "0574000001" }))).lead_id;
    handed = await sendAccepted("tele1", "sales1", leadPayload({ name: "قديم", phone: "0574000002", status: "Interested" }));
  });
  afterAll(teardown);
  it("own client without a name, and a client already handed to Sales", async () => {
    expect(await nameOf(own)).toBe("بدون اسم");
    await rename("tele1", own, "متجر الريحان"); expect(await nameOf(own)).toBe("متجر الريحان");
    await rename("tele1", handed, "اسم صحيح"); expect(await nameOf(handed)).toBe("اسم صحيح");
  });
  it("another Tele cannot touch it; the change is in the audit log", async () => {
    const r = await rename("tele2", own, "تخريب");
    expect(r.rowCount).toBe(0); expect(await nameOf(own)).toBe("متجر الريحان");
    expect((await admin.query("select count(*)::int n from audit_logs where entity_type='clients' and action='UPDATE' and new_value->>'name' = 'متجر الريحان'")).rows[0].n).toBe(1);
  });
});
