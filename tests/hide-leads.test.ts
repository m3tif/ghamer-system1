import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, sendAccepted, bookAs, ids } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_hide_test"); });
afterAll(async () => { await teardown(); });

const month = new Date().toISOString().slice(0, 7) + "-01";
const list = (who: string, hidden?: string) =>
  run(who, "select * from app.list_leads(null,null,null,null,null,null,null,null,null,100,0,$1)", [hidden ?? null]).then((r) => r.rows);
const own = (who: string, id: string) => run(who, "select count(*)::int n from leads where id = $1", [id]).then((r) => r.rows[0].n);

describe("hiding leads from employees", () => {
  let a: string, b: string, c: string;
  it("setup", async () => {
    a = (await register("tele1", leadPayload({ name: "أول", phone: "0554440001" }))).lead_id;
    b = (await register("tele1", leadPayload({ name: "ثاني", phone: "0554440002" }))).lead_id;
    c = (await register("tele2", leadPayload({ name: "ثالث", phone: "0554440003" }))).lead_id;
    expect((await list("tele1")).length).toBe(2);
  });
  it("employees cannot hide or unhide anything", async () => {
    await expect(run("tele1", "select app.set_lead_hidden($1,true,null)", [a])).rejects.toThrow(/not allowed/);
    await expect(run("sales1", "select app.hide_leads_month($1,$2,true,null)", [ids.tele1, month])).rejects.toThrow(/not allowed/);
    await expect(run("tele1", "update leads set hidden_at = now() where id = $1", [a])).rejects.toThrow(/permission denied/);
  });
  it("the tele manager hides a lead: the employee no longer sees it anywhere, the manager and admin still do", async () => {
    await run("telemgr", "select app.set_lead_hidden($1,true,'تنظيف الشهر')", [a]);
    expect((await list("tele1")).map((x) => x.id)).toEqual([b]);
    expect(await own("tele1", a)).toBe(0);
    expect((await run("tele1", "select app.lead_visible($1) v", [a])).rows[0].v).toBe(false);
    expect((await run("tele1", "select * from app.list_leads('أول',null,null,null,null,null,null,null,null,25,0,'all')")).rowCount).toBe(0); // cannot ask for hidden ones
    expect((await run("tele1", "select * from app.archive_leads(null,null,null,50,0)")).rows.some((x) => x.lead_id === a)).toBe(false);
    const hid = await list("telemgr", "hidden");
    expect(hid.map((x) => x.id)).toEqual([a]);
    expect(hid[0]).toMatchObject({ hidden_reason: "تنظيف الشهر" }); expect(hid[0].hidden_by_name).toBeTruthy();
    expect((await list("super", "hidden")).length).toBe(1);
    expect((await list("telemgr")).map((x) => x.id)).not.toContain(a); // default view = visible only
    expect((await list("telemgr", "all")).length).toBe(3);
  });
  it("it is only a hide: the record, its history and the employee's counts stay", async () => {
    expect((await run("tele1", "select * from app.added_counts(null)")).rows[0].total).toBe(2);
    expect((await run("telemgr", "select count(*)::int n from lead_activities where lead_id = $1 and note like '%إخفاء%'", [a])).rows[0].n).toBe(1);
  });
  it("a manager of another team cannot hide it", async () => {
    await expect(run("salesmgr", "select app.set_lead_hidden($1,true,null)", [a])).rejects.toThrow(/no access/);
  });
  it("unhide brings it back", async () => {
    await run("telemgr", "select app.set_lead_hidden($1,false,null)", [a]);
    expect((await list("tele1")).length).toBe(2);
  });
  it("hide a whole month of one employee at once (and only that employee)", async () => {
    const n = (await run("telemgr", "select app.hide_leads_month($1,$2,true,'أرشفة') n", [ids.tele1, month])).rows[0].n;
    expect(n).toBe(2);
    expect((await list("tele1")).length).toBe(0);
    expect((await list("tele2")).length).toBe(1);
    expect((await run("telemgr", "select app.hide_leads_month($1,$2,true,null) n", [ids.tele1, month])).rows[0].n).toBe(0); // idempotent
    expect((await run("telemgr", "select app.hide_leads_month($1,$2,false,null) n", [ids.tele1, month])).rows[0].n).toBe(2);
    expect((await list("tele1")).length).toBe(2);
  });
});

describe("hiding a lead that is already with Sales", () => {
  it("hides the lead, the deal and the meeting from that Sales; the manager can restore it", async () => {
    const l = await sendAccepted("tele1", "sales1", leadPayload({ name: "عند السيلز", phone: "0554440010", status: "Interested" }));
    await bookAs("sales1", l);
    expect((await list("sales1")).length).toBe(1);
    expect((await run("sales1", "select count(*)::int n from deals")).rows[0].n).toBe(1);
    expect((await run("sales1", "select * from app.list_meetings('all',50)")).rowCount).toBe(1);
    await run("salesmgr", "select app.set_lead_hidden($1,true,'مخفي')", [l]);
    expect((await list("sales1")).length).toBe(0);
    expect((await run("sales1", "select count(*)::int n from deals")).rows[0].n).toBe(0);
    expect((await run("sales1", "select * from app.list_meetings('all',50)")).rowCount).toBe(0);
    expect((await run("tele1", "select * from app.my_lead_outcomes() where lead_id = $1", [l])).rowCount).toBe(0);
    expect((await run("sales1", "select app.lead_visible($1) v", [l])).rows[0].v).toBe(false);
    expect((await list("salesmgr", "hidden")).length).toBe(1);
    await run("salesmgr", "select app.set_lead_hidden($1,false,null)", [l]);
    expect((await list("sales1")).length).toBe(1);
    expect((await run("sales1", "select count(*)::int n from deals")).rows[0].n).toBe(1);
  });
  it("the old search function that ignored the flag is gone", async () => {
    await expect(run("sales1", "select * from app.search_leads('x',null,null,null,null,null,10,0)")).rejects.toThrow();
  });
});
