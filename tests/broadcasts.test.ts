import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_broadcast_test"); });
afterAll(async () => { await teardown(); });
const pending = (who: string) => run(who, "select id, title, body from notifications where read_at is null and kind='system' and dedupe_key like 'release:%' order by created_at desc").then((r) => r.rows);

describe("admin messages to employees", () => {
  it("only the system admin sends; everyone active gets it once; the sender does not", async () => {
    await expect(run("gm", "select app.broadcast_send('x','y','all',null,null)")).rejects.toThrow(/not allowed/);
    await expect(run("tele1", "select app.broadcast_send('x','y','all',null,null)")).rejects.toThrow(/not allowed/);
    await expect(run("super", "select app.broadcast_send('','y','all',null,null)")).rejects.toThrow(/text required/);
    const req = "aaaaaaaa-1111-4222-8333-444444444444";
    const n = (await run("super", "select app.broadcast_send('صباح الخير','رسالة للكل','all',null,$1) n", [req])).rows[0].n;
    const again = (await run("super", "select app.broadcast_send('صباح الخير','رسالة للكل','all',null,$1) n", [req])).rows[0].n;   // pressed twice
    const active = (await admin.query("select count(*)::int n from users where is_active")).rows[0].n;
    expect(n).toBe(active - 1); expect(again).toBe(n);
    expect((await admin.query("select count(*)::int n from broadcasts")).rows[0].n).toBe(1);
    expect((await pending("tele1"))[0].title).toBe("صباح الخير");
    expect((await pending("super")).length).toBe(0);
  });
  it("audience: Tele only / chosen employees; read counts; other employees cannot read the log", async () => {
    await run("super", "select app.broadcast_send('للتلي','بس','tele',null,null)");
    expect((await pending("tele2")).some((x: any) => x.title === "للتلي")).toBe(true);
    expect((await pending("sales1")).some((x: any) => x.title === "للتلي")).toBe(false);
    await run("super", "select app.broadcast_send('خاص','ليك','selected',$1::uuid[],null)", [[ids.sales1]]);
    expect((await pending("sales1")).some((x: any) => x.title === "خاص")).toBe(true);
    expect((await pending("sales2")).some((x: any) => x.title === "خاص")).toBe(false);
    await expect(run("super", "select app.broadcast_send('فاضي','x','selected','{}'::uuid[],null)")).rejects.toThrow(/no recipients/);
    const mine = (await pending("sales1")).find((x: any) => x.title === "خاص").id;
    await run("sales1", "update notifications set read_at = now() where id=$1", [mine]);
    const row = (await run("super", "select * from app.broadcast_list()")).rows.find((b: any) => b.title === "خاص");
    expect(row.recipients).toBe(1); expect(row.seen).toBe(1);
    expect((await run("tele1", "select * from app.broadcast_list()")).rowCount).toBe(0);
    expect((await run("tele1", "select count(*)::int n from broadcasts")).rows[0].n).toBe(0);
    expect((await admin.query("select count(*)::int n from audit_logs where entity_type='broadcasts' and action='INSERT'")).rows[0].n).toBe(3);
  });
});
