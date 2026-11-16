import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin, leadPayload, sendAccepted, contractPayload, signContract } from "./helpers";

const dealOf = async (lead: string) => (await admin.query("select id from deals where lead_id=$1", [lead])).rows[0].id as string;
const list = async (who: string, status: string | null = null) => (await run(who, "select * from app.ops_list($1)", [status])).rows;

describe("Phase 3 — approved clients go to the Technical Manager, who hands them to an Account Manager", () => {
  let contract: string; let op: string;
  beforeAll(async () => {
    await setupDb("ghamer_test_ops");
    const deal = await dealOf(await sendAccepted("tele1", "sales1", leadPayload({ name: "متجر الورد", phone: "0572000001", status: "Interested" })));
    contract = await signContract("sales1", deal, { ...contractPayload({ start: "2027-01-01" }), total: 9000, items: [{ service: "seo" }, { service: "media" }] });
  });
  afterAll(teardown);

  it("nothing reaches operations before financial approval", async () => {
    expect((await list("techmgr")).length).toBe(0);
    expect((await admin.query("select count(*)::int n from client_operations")).rows[0].n).toBe(0);
  });
  it("on approval the client lands in the Technical Manager queue once, and she is notified", async () => {
    await run("fin", "select app.contract_approve($1,null)", [contract]);
    await run("fin", "select app.contract_approve($1,null)", [contract]);
    const rows = await list("techmgr", "new");
    expect(rows.length).toBe(1);
    op = rows[0].id;
    expect(rows[0].client_name).toBe("متجر الورد");
    expect(rows[0].packages).toEqual(["باقة سيو", "باقة ميديا"]);
    expect(rows[0].sales_name).toBe("خالد");
    expect((await admin.query("select count(*)::int n from notifications where kind='ops_new' and user_id=$1", [ids.techmgr])).rows[0].n).toBe(1);
  });
  it("who sees the queue: Technical Manager and admins; an Account Manager only his own; nobody else; no direct table access", async () => {
    for (const w of ["techmgr", "super", "gm"]) expect((await list(w)).length).toBe(1);
    for (const w of ["am1", "am2", "sales1", "tele1", "fin", "designer"]) expect((await list(w)).length).toBe(0);
    await expect(run("techmgr", "select * from client_operations")).rejects.toThrow(/permission denied/);
    await expect(run("techmgr", "update client_operations set status='assigned'")).rejects.toThrow(/permission denied/);
  });
  it("the Technical Manager sees technical things only: no contracts, no employee list", async () => {
    expect((await run("techmgr", "select count(*)::int n from contracts")).rows[0].n).toBe(0);
    expect((await run("techmgr", "select app.has_perm('employees.view') e, app.has_perm('contracts.view') c")).rows[0]).toEqual({ e: false, c: false });
  });
  it("she hands the client to an Account Manager; he sees it and is told; only an active Account Manager can be picked", async () => {
    const ams = (await run("techmgr", "select * from app.ops_account_managers()")).rows;
    expect(ams.map((a: any) => a.full_name).sort()).toEqual(["أكاونت 1", "أكاونت 2"]);
    await expect(run("am1", "select app.ops_assign($1,$2,null)", [op, ids.am1])).rejects.toThrow(/not allowed/);
    await expect(run("sales1", "select app.ops_assign($1,$2,null)", [op, ids.am1])).rejects.toThrow(/not allowed/);
    await expect(run("techmgr", "select app.ops_assign($1,$2,null)", [op, ids.designer])).rejects.toThrow(/invalid account manager/);
    await run("techmgr", "select app.ops_assign($1,$2,'ابدأ بالسيو')", [op, ids.am1]);
    await run("techmgr", "select app.ops_assign($1,$2,'ابدأ بالسيو')", [op, ids.am1]);           // twice = once
    const mine = await list("am1");
    expect(mine.length).toBe(1); expect(mine[0].status).toBe("assigned"); expect(mine[0].assign_note).toBe("ابدأ بالسيو");
    expect((await list("am2")).length).toBe(0);
    expect((await list("techmgr", "new")).length).toBe(0);
    expect((await admin.query("select count(*)::int n from notifications where kind='ops_assigned' and user_id=$1", [ids.am1])).rows[0].n).toBe(1);
  });
  it("moving the client to another Account Manager tells both, and it is all in the audit log", async () => {
    await run("techmgr", "select app.ops_assign($1,$2,null)", [op, ids.am2]);
    expect((await list("am1")).length).toBe(0); expect((await list("am2")).length).toBe(1);
    expect((await admin.query("select count(*)::int n from notifications where kind='ops_unassigned' and user_id=$1", [ids.am1])).rows[0].n).toBe(1);
    const a = (await admin.query("select action, reason from audit_logs where entity_type='client_operations' and entity_id=$1 order by at", [op])).rows;
    expect(a.map((x: any) => x.action)).toEqual(["INSERT", "UPDATE", "UPDATE"]);
    expect(a[1].reason).toBe("ابدأ بالسيو"); expect(a[2].reason).toBe("تغيير الأكاونت مانجر");
  });
  it("the new technical job titles exist as roles", async () => {
    const r = (await admin.query("select code, name_ar from roles where code in ('seo_specialist','ui_designer','developer','designer','content_creator','media_buyer') order by code")).rows;
    expect(r.length).toBe(6);
    expect((await admin.query("select name_ar from roles where code='operations_manager'")).rows[0].name_ar).toBe("المدير التقني");
  });
});
