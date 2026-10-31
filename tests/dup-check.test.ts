import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_dupcheck_test"); });
afterAll(async () => { await teardown(); });

describe("live duplicate check (read-only, permission-aware)", () => {
  it("phone duplicate: owner sees details, an unrelated employee only sees that it exists", async () => {
    const r = await register("tele1", leadPayload({ name: "عميل مرئي", phone: "0501237001", store: "https://shop-dup-1.com/" }));
    const phone = "+966501237001";
    const own = (await run("tele1", "select app.check_duplicate($1,null) r", [phone])).rows[0].r;
    expect(own.phone.exists).toBe(true); expect(own.phone.visible).toBe(true); expect(own.phone.name).toBe("عميل مرئي"); expect(own.phone.lead_id).toBe(r.lead_id);
    const other = (await run("tele2", "select app.check_duplicate($1,null) r", [phone])).rows[0].r;
    expect(other.phone.exists).toBe(true); expect(other.phone.visible).toBe(false);
    expect(other.phone.name).toBeUndefined(); expect(other.phone.owner).toBeUndefined(); expect(other.phone.lead_id).toBeUndefined();
    const mgr = (await run("telemgr", "select app.check_duplicate($1,null) r", [phone])).rows[0].r;
    expect(mgr.phone.visible).toBe(true);
  });
  it("store duplicate is detected by the normalised key; new numbers/stores return nothing", async () => {
    const { normalizeStoreUrl } = await import("../src/lib/normalize");
    const key = normalizeStoreUrl("https://www.shop-dup-1.com/")!.key;
    const r = (await run("tele2", "select app.check_duplicate(null,$1) r", [key])).rows[0].r;
    expect(r.store.exists).toBe(true); expect(r.store.visible).toBe(false);
    expect((await run("tele2", "select app.check_duplicate('+966509999999','nothere.com') r")).rows[0].r).toEqual({});
  });
  it("does not log anything or notify (read-only), and the same name with a different phone is not a duplicate", async () => {
    const before = (await run("super", "select (select count(*) from lead_activities where kind='duplicate_attempt')::int a, (select count(*) from notifications)::int n")).rows[0];
    await run("tele2", "select app.check_duplicate('+966501237001','x.com')");
    const after = (await run("super", "select (select count(*) from lead_activities where kind='duplicate_attempt')::int a, (select count(*) from notifications)::int n")).rows[0];
    expect(after).toEqual(before);
    expect((await register("tele2", leadPayload({ name: "عميل مرئي", phone: "0501237002" }))).status).toBe("created");
  });
});
