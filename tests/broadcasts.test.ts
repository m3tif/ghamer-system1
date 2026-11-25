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
  it("the Technical Manager and Account Managers message the technical and operations teams only, and the pop-up shows who sent it", async () => {
    const notice = async (w: string) => (await run(w, "select * from app.my_pending_notice()")).rows[0];
    for (const aud of ["all", "tele", "sales", "finance"]) await expect(run("techmgr", "select app.broadcast_send('x','y',$1,null,null)", [aud])).rejects.toThrow(/not allowed/);
    await expect(run("designer", "select app.broadcast_send('x','y','tech',null,null)")).rejects.toThrow(/not allowed/);
    const n = (await run("techmgr", "select app.broadcast_send('اجتماع الفريق','الساعة 3','tech',null,null) n")).rows[0].n;
    const techCount = (await admin.query("select count(*)::int n from users u join roles r on r.id=u.role_id where u.is_active and app._tech_ops_role(r.code) and r.code not in ('operations_manager','account_manager')")).rows[0].n;
    expect(n).toBe(techCount);
    const d = await notice("designer");
    expect(d.title).toBe("اجتماع الفريق"); expect(d.sender).toBe("المديرة التقنية — المدير التقني");
    expect((await pending("sales1")).some((x: any) => x.title === "اجتماع الفريق")).toBe(false);
    // an Account Manager picking someone outside the teams reaches nobody
    await expect(run("am1", "select app.broadcast_send('x','y','selected',$1::uuid[],null)", [[ids.sales1]])).rejects.toThrow(/no recipients/);
    await run("am1", "select app.broadcast_send('للأكاونت','رسالة','ops',null,null)");
    expect((await pending("am2")).some((x: any) => x.title === "للأكاونت")).toBe(true);
    expect((await pending("techmgr")).some((x: any) => x.title === "للأكاونت")).toBe(true);
    // each sees what they sent; the admin sees all; admin messages still show «from the admin»
    expect((await run("am1", "select * from app.broadcast_list()")).rows.map((r: any) => r.title)).toEqual(["للأكاونت"]);
    expect((await run("super", "select * from app.broadcast_list()")).rows.length).toBeGreaterThanOrEqual(5);
    expect((await run("am1", "select * from app.broadcast_recipients()")).rows.some((r: any) => r.id === ids.sales1)).toBe(false);
    await run("super", "select app.broadcast_send('من الإدارة','x','tech',null,null)");
    expect((await notice("designer")).sender).toBeNull();
  });
  it("a message that asks for replies: tele sales write back, the admin sees who wrote what", async () => {
    const id = "00000000-0000-4000-8000-000000000061";
    const n = (await run("super", "select app.broadcast_send('شكل الداتا','ابعتولي شكل الداتا اللي انتوا عاوزينها','tele',null,$1,true) n", [id])).rows[0].n;
    expect(n).toBeGreaterThan(0);
    const pop = (await run("tele1", "select * from app.my_pending_notice()")).rows[0];
    expect(pop.broadcast_id).toBe(id); expect(pop.allow_reply).toBe(true);
    await run("tele1", "select app.broadcast_reply($1,'عاوزين أرقام متاجر سلة بس')", [id]);
    await run("tele2", "select app.broadcast_reply($1,'بالمدينة لو ينفع')", [id]);
    await expect(run("tele1", "select app.broadcast_reply($1,'  ')", [id])).rejects.toThrow(/reply text required/);
    await expect(run("sales1", "select app.broadcast_reply($1,'x')", [id])).rejects.toThrow(/no access/);   // the message did not reach him
    expect((await run("tele1", "select count(*)::int c from app.my_pending_notice() where id = $1", [pop.id])).rows[0].c).toBe(0);   // replying closes the pop-up
    const rs = (await run("super", "select * from app.broadcast_replies($1)", [id])).rows;
    expect(rs.map((r: any) => r.body)).toEqual(["عاوزين أرقام متاجر سلة بس", "بالمدينة لو ينفع"]); expect(rs[0].employee).toBeTruthy();
    expect((await run("tele1", "select * from app.broadcast_replies($1)", [id])).rows.length).toBe(0);   // employees can't read each other's replies
    const l = (await run("super", "select * from app.broadcast_list() where id = $1", [id])).rows[0];
    expect(l.allow_reply).toBe(true); expect(l.replies).toBe(2);
    expect((await run("tele1", "select my_replies from app.my_replyable() where broadcast_id = $1", [id])).rows[0].my_replies.length).toBe(1);
    expect((await admin.query("select count(*)::int c from notifications where user_id = $1 and kind = 'broadcast_reply'", [ids.super])).rows[0].c).toBe(2);
    // a plain message has no reply box
    await run("super", "select app.broadcast_send('عادي','x','tele',null,null)");
    const plain = (await admin.query("select id from broadcasts where title = 'عادي'")).rows[0].id;
    await expect(run("tele1", "select app.broadcast_reply($1,'x')", [plain])).rejects.toThrow(/replies closed/);
  });
});
