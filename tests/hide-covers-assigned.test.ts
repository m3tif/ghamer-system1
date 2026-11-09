import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, ids, admin } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_hideassigned_test"); });
afterAll(async () => { await teardown(); });

const seen = (who: string, id: string) => run(who, "select count(*)::int n from leads where id=$1", [id]).then((r) => r.rows[0].n);
const today = () => new Date().toISOString().slice(0, 10);

describe("hiding an employee also hides leads distributed/assigned to her", () => {
  it("hides own, owned and later-assigned leads; restore brings them back", async () => {
    const own = (await register("tele1", leadPayload({ name: "ملكها", phone: "0554440001" }))).lead_id;
    const given = (await register("super", leadPayload({ name: "موزّع", phone: "0554440002" }))).lead_id;
    await admin.query("update leads set current_owner_id=$2 where id=$1", [given, ids.tele1]);
    expect(await seen("tele1", given)).toBe(1);
    const r = (await run("super", "select app.hide_period('day',$1::date,$2,true,'اختبار') j", [today(), ids.tele1])).rows[0].j;
    expect(r.affected).toBeGreaterThanOrEqual(2);
    expect(await seen("tele1", own)).toBe(0);
    expect(await seen("tele1", given)).toBe(0);
    expect(await seen("super", given)).toBe(1);
    // a lead handed to her after the hide is hidden at once
    const later = (await register("super", leadPayload({ name: "لاحق", phone: "0554440003" }))).lead_id;
    await admin.query("update leads set current_owner_id=$2 where id=$1", [later, ids.tele1]);
    expect(await seen("tele1", later)).toBe(0);
    expect(await seen("super", later)).toBe(1);
    // other employees are not affected
    expect(await seen("tele2", (await register("tele2", leadPayload({ name: "غيرها", phone: "0554440004" }))).lead_id)).toBe(1);
    await run("super", "select app.hide_period('day',$1::date,$2,false,null)", [today(), ids.tele1]);
    expect(await seen("tele1", own)).toBe(1); expect(await seen("tele1", given)).toBe(1); expect(await seen("tele1", later)).toBe(1);
  });
});
