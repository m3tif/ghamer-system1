import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, admin, leadPayload } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_whatsapp_test"); });
afterAll(async () => { await teardown(); });

describe("has WhatsApp? (optional)", () => {
  it("starts unknown, can be yes / no / unknown again, and shows in the list", async () => {
    const id = (await register("tele1", leadPayload({ name: "واتس", phone: "0559990001" }))).lead_id;
    const get = async () => (await run("tele1", "select has_whatsapp from app.list_leads(null,null,null,null,null,null,null,'created','desc',100,0,'visible',null) where id=$1", [id])).rows[0].has_whatsapp;
    expect(await get()).toBeNull();
    await run("tele1", "update leads set has_whatsapp = true where id=$1", [id]); expect(await get()).toBe(true);
    await run("tele1", "update leads set has_whatsapp = false where id=$1", [id]); expect(await get()).toBe(false);
    await run("tele1", "update leads set has_whatsapp = null where id=$1", [id]); expect(await get()).toBeNull();
    // the 12-argument version still works
    expect((await run("tele1", "select count(*)::int n from app.list_leads(null,null,null,null,null,null,null,'created','desc',100,0,'visible')")).rows[0].n).toBeGreaterThan(0);
    // other employees cannot change it
    expect((await run("tele2", "update leads set has_whatsapp = true where id=$1", [id])).rowCount).toBe(0);
  });
  it("the update notice: one per employee, shown until read", async () => {
    const users = (await admin.query("select u.id from users u where u.is_active")).rows.map((r: any) => r.id);
    for (const u of users) for (let k = 0; k < 2; k++)   // same statement as the migration, run twice → still one each
      await admin.query("insert into notifications(user_id, kind, title, body, link, dedupe_key) values ($1,'system','تحديث جديد: x','y','/leads','release:test') on conflict (user_id, dedupe_key) do nothing", [u]);
    expect((await admin.query("select count(*)::int n from notifications where dedupe_key='release:test'")).rows[0].n).toBe(users.length);
    const q = "select id from notifications where read_at is null and kind='system' and dedupe_key like 'release:%' limit 1";
    const mine = (await run("tele1", q)).rows[0].id;
    await run("tele1", "update notifications set read_at = now() where id=$1", [mine]);
    expect((await run("tele1", q)).rows.length).toBe(0);
    expect((await run("tele2", q)).rows.length).toBe(1);   // others still see it
  });
});
