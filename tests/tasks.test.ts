import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin, leadPayload, sendAccepted, contractPayload, signContract, PDF } from "./helpers";

const dealOf = async (lead: string) => (await admin.query("select id from deals where lead_id=$1", [lead])).rows[0].id as string;
const save = async (who: string, ops: string, task: string | null, p: any) => (await run(who, "select app.task_save($1,$2,$3::jsonb) id", [ops, task, JSON.stringify(p)])).rows[0].id as string;
const get = async (who: string, id: string) => (await run(who, "select app.task_get($1) j", [id])).rows[0]?.j;
const list = async (who: string, scope: string | null = null) => (await run(who, "select * from app.task_list($1,null)", [scope])).rows;

describe("Phase 3 — tasks, timer, delivery and review", () => {
  let ops: string; let task: string; let t2: string;
  beforeAll(async () => {
    await setupDb("ghamer_test_tasks");
    const deal = await dealOf(await sendAccepted("tele1", "sales1", leadPayload({ name: "متجر الورد", phone: "0573000001", status: "Interested" })));
    const c = await signContract("sales1", deal, { ...contractPayload({ start: "2027-01-01" }), total: 9000, items: [{ service: "seo" }, { service: "media" }] });
    await run("fin", "select app.contract_approve($1,null)", [c]);
    ops = (await run("techmgr", "select id from app.ops_list(null)")).rows[0].id;
    await run("techmgr", "select app.ops_assign($1,$2,null)", [ops, ids.am1]);
  });
  afterAll(teardown);

  it("the Account Manager of the client (or the Technical Manager) writes tasks; others cannot; the assignee must be a technical employee", async () => {
    const p = { title: "تصميم بنرات المتجر", assignee: ids.designer, service: "media", priority: "high", start_date: "2027-01-02", due_date: "2027-01-05", estimated_hours: 6 };
    for (const w of ["am2", "designer", "sales1", "fin", "gm"]) await expect(save(w, ops, null, p)).rejects.toThrow(/not allowed/);
    await expect(save("am1", ops, null, { ...p, assignee: ids.sales1 })).rejects.toThrow(/invalid assignee/);
    await expect(save("am1", ops, null, { ...p, title: " " })).rejects.toThrow(/title required/);
    await expect(save("am1", ops, null, { ...p, due_date: "2027-01-01" })).rejects.toThrow(/due date is before/);
    task = await save("am1", ops, null, p);
    t2 = await save("techmgr", ops, null, { title: "تحسين السيو", assignee: ids.seo, service: "seo" });
    expect((await admin.query("select count(*)::int n from notifications where kind='task_new' and user_id=$1", [ids.designer])).rows[0].n).toBe(1);
    expect((await run("am1", "select * from app.task_assignees()")).rows.map((r: any) => r.full_name).sort()).toEqual(["ديزاينر", "سيو", "موظف تقني"]);
  });
  it("who sees a task: the assignee, the client's Account Manager, the Technical Manager, admins — nobody else; no direct table access", async () => {
    for (const w of ["designer", "am1", "techmgr", "super", "gm"]) expect((await get(w, task))?.title).toBe("تصميم بنرات المتجر");
    for (const w of ["seo", "am2", "sales1", "fin", "tele1"]) expect(await get(w, task)).toBeNull();
    expect((await list("designer", "mine")).length).toBe(1);
    expect((await list("seo")).map((r: any) => r.id)).toEqual([t2]);
    expect((await list("am1")).length).toBe(2); expect((await list("am2")).length).toBe(0);
    for (const tb of ["tasks", "task_time_logs", "task_comments"]) await expect(run("designer", `select * from ${tb}`)).rejects.toThrow(/permission denied/);
  });
  it("timer: only the assignee; one running timer per employee — starting another task pauses the first", async () => {
    await expect(run("seo", "select app.task_start($1)", [task])).rejects.toThrow(/not allowed/);
    await expect(run("am1", "select app.task_start($1)", [task])).rejects.toThrow(/not allowed/);
    await run("designer", "select app.task_start($1)", [task]);
    await run("designer", "select app.task_start($1)", [task]);            // twice = one period
    expect((await get("designer", task)).status).toBe("in_progress");
    const other = await save("am1", ops, null, { title: "تاسك تاني", assignee: ids.designer });
    await run("designer", "select app.task_start($1)", [other]);
    expect((await get("designer", task)).status).toBe("paused");
    expect((await admin.query("select count(*)::int n from task_time_logs where employee_id=$1 and ended_at is null", [ids.designer])).rows[0].n).toBe(1);
    await run("designer", "select app.task_pause($1)", [other]);
    expect((await admin.query("select count(*)::int n from task_time_logs where employee_id=$1 and ended_at is null", [ids.designer])).rows[0].n).toBe(0);
    expect((await admin.query("select count(*)::int n from task_time_logs where employee_id=$1", [ids.designer])).rows[0].n).toBe(2);
  });
  it("time added by hand needs a reason and is kept as its own record", async () => {
    await expect(run("designer", "select app.task_add_time($1,30,'')", [task])).rejects.toThrow(/reason required/);
    await expect(run("designer", "select app.task_add_time($1,0,'x')", [task])).rejects.toThrow(/invalid minutes/);
    await expect(run("am1", "select app.task_add_time($1,30,'x')", [task])).rejects.toThrow(/not allowed/);
    await run("designer", "select app.task_add_time($1,90,'اشتغلت من غير نت')", [task]);
    const g = await get("am1", task);
    expect(g.minutes).toBeGreaterThanOrEqual(90);
    expect(g.logs.filter((l: any) => l.manual).length).toBe(1);
  });
  it("delivery needs a link and goes to review; the reviewer is told", async () => {
    await expect(run("designer", "select app.task_submit($1,'','')", [task])).rejects.toThrow(/delivery link required/);
    await expect(run("designer", "select app.task_submit($1,'drive','')", [task])).rejects.toThrow(/delivery link required/);
    await expect(run("seo", "select app.task_submit($1,'https://x.com/a','')", [task])).rejects.toThrow(/not allowed/);
    await run("designer", "select app.task_submit($1,'https://drive.google.com/file/1','النسخة الأولى')", [task]);
    await run("designer", "select app.task_submit($1,'https://drive.google.com/file/1','النسخة الأولى')", [task]);
    expect((await get("am1", task)).status).toBe("submitted");
    expect((await admin.query("select count(*)::int n from notifications where kind='task_submitted' and user_id=$1", [ids.am1])).rows[0].n).toBe(1);
    await expect(run("designer", "select app.task_start($1)", [task])).rejects.toThrow(/cannot be started/);
  });
  it("review: the employee cannot approve his own task; sending back needs a reason; approve closes the task", async () => {
    await expect(run("designer", "select app.task_review($1,true,null)", [task])).rejects.toThrow(/not allowed/);
    await expect(run("am2", "select app.task_review($1,true,null)", [task])).rejects.toThrow(/not allowed/);
    await expect(run("am1", "select app.task_review($1,false,'')", [task])).rejects.toThrow(/reason required/);
    await run("am1", "select app.task_review($1,false,'اللون مش مظبوط')", [task]);
    let g = await get("designer", task);
    expect(g.status).toBe("changes_requested"); expect(g.review_note).toBe("اللون مش مظبوط"); expect(g.revisions).toBe(1);
    await expect(run("am1", "select app.task_review($1,true,null)", [task])).rejects.toThrow(/not waiting for review/);
    await run("designer", "select app.task_start($1)", [task]);
    await run("designer", "select app.task_submit($1,'https://drive.google.com/file/2',null)", [task]);
    await run("am1", "select app.task_review($1,true,null)", [task]);
    await run("am1", "select app.task_review($1,true,null)", [task]);
    g = await get("designer", task);
    expect(g.status).toBe("approved"); expect(g.reviewed_by).toBe(ids.am1);
    expect((await admin.query("select count(*)::int n from notifications where kind in ('task_changes','task_approved') and user_id=$1", [ids.designer])).rows[0].n).toBe(2);
    await expect(run("designer", "select app.task_start($1)", [task])).rejects.toThrow(/cannot be started/);
    await expect(save("am1", ops, task, { title: "تغيير", assignee: ids.designer })).rejects.toThrow(/closed/);
    expect((await admin.query("select count(*)::int n from task_time_logs where task_id=$1", [task])).rows[0].n).toBe(3);   // every period kept
  });
  it("edit moves a task to someone else and tells them; comments reach the other side; late tasks are flagged; all in the audit log", async () => {
    await run("seo", "select app.task_start($1)", [t2]);
    await save("am1", ops, t2, { title: "تحسين السيو", assignee: ids.designer, due_date: "2020-01-01" });
    expect(await get("seo", t2)).toBeNull();
    const g = await get("designer", t2);
    expect(g.status).toBe("todo"); expect(g.late).toBe(true); expect(g.running_since).toBeNull();
    await run("designer", "select app.task_comment($1,'محتاج صلاحية المتجر')", [t2]);
    await expect(run("seo", "select app.task_comment($1,'x')", [t2])).rejects.toThrow(/no access/);
    expect((await admin.query("select count(*)::int n from notifications where kind='task_comment' and user_id=$1", [ids.am1])).rows[0].n).toBe(1);
    expect((await get("am1", t2)).comments.length).toBe(1);
    expect((await admin.query("select count(*)::int n from audit_logs where entity_type='tasks' and entity_id=$1", [task])).rows[0].n).toBeGreaterThanOrEqual(6);
  });
  it("onboarding: the client's Account Manager writes the brief, kickoff and checklist; others only read or see nothing", async () => {
    const ob = async (w: string) => (await run(w, "select app.onboarding_get($1) j", [ops])).rows[0]?.j;
    await expect(run("am2", "select app.onboarding_save($1,$2::jsonb)", [ops, "{}"])).rejects.toThrow(/not allowed/);
    await expect(run("designer", "select app.onboarding_item_add($1,'x y')", [ops])).rejects.toThrow(/not allowed/);
    await run("am1", "select app.onboarding_save($1,$2::jsonb)", [ops, JSON.stringify({ kickoff_at: "2027-01-03T10:00:00Z", goals: "زيادة المبيعات", brand_identity: "ألوان دافية" })]);
    await run("am1", "select app.onboarding_save($1,$2::jsonb)", [ops, JSON.stringify({ kickoff_at: "2027-01-03T10:00:00Z", goals: "زيادة المبيعات 30%", brand_identity: "ألوان دافية" })]);
    await run("am1", "select app.onboarding_item_add($1,null)", [ops]);
    await run("am1", "select app.onboarding_item_add($1,null)", [ops]);                 // standard list only once
    await run("am1", "select app.onboarding_item_add($1,'ملف المنتجات')", [ops]);
    const g = await ob("techmgr");
    expect(g.brief.goals).toBe("زيادة المبيعات 30%"); expect(g.items.length).toBe(8); expect(g.can_edit).toBe(true);
    await run("am1", "select app.onboarding_item_set($1,true)", [g.items[0].id]);
    await expect(run("designer", "select app.onboarding_item_set($1,true)", [g.items[1].id])).rejects.toThrow(/not allowed/);
    expect((await ob("am1")).items.filter((x: any) => x.done).length).toBe(1);
    for (const w of ["am2", "designer", "sales1"]) expect(await ob(w)).toBeNull();
    expect((await get("designer", t2)).brief.brand_identity).toBe("ألوان دافية");       // the employee sees the brief through his task
  });
  it("task templates: only the Technical Manager writes them; whoever writes tasks can use them", async () => {
    await expect(run("am1", "select app.task_template_save($1::jsonb)", [JSON.stringify({ title: "قالب" })])).rejects.toThrow(/not allowed/);
    const id = (await run("techmgr", "select app.task_template_save($1::jsonb) id", [JSON.stringify({ title: "تدقيق سيو أولي", service: "seo", estimated_hours: 4 })])).rows[0].id;
    expect((await run("am1", "select * from app.task_template_list(false)")).rows.map((r: any) => r.title)).toEqual(["تدقيق سيو أولي"]);
    expect((await run("designer", "select * from app.task_template_list(true)")).rows.length).toBe(0);
    await run("techmgr", "select app.task_template_set($1,false)", [id]);
    expect((await run("am1", "select * from app.task_template_list(false)")).rows.length).toBe(0);
    expect((await run("techmgr", "select * from app.task_template_list(true)")).rows.length).toBe(1);
  });
  it("files on a task: the assignee or the manager uploads; only people who see the task download; the uploader deletes", async () => {
    await expect(run("seo", "select app.task_attach($1,'a.pdf','application/pdf',$2)", [t2, PDF])).rejects.toThrow(/not allowed/);
    await expect(run("designer", "select app.task_attach($1,'a.pdf','application/pdf',$2)", [t2, Buffer.from("<html>")])).rejects.toThrow(/unsupported file type/);
    const f = (await run("designer", "select app.task_attach($1,'تصميم.pdf','application/pdf',$2) id", [t2, PDF])).rows[0].id;
    expect((await get("am1", t2)).files.length).toBe(1);
    for (const w of ["designer", "am1", "techmgr", "super"]) expect((await run(w, "select filename from app.attachment_get($1)", [f])).rows.length).toBe(1);
    for (const w of ["seo", "am2", "sales1", "fin"]) expect((await run(w, "select filename from app.attachment_get($1)", [f])).rows.length).toBe(0);
    await expect(run("am1", "select app.task_file_delete($1)", [f])).rejects.toThrow(/not the uploader/);
    await expect(run("designer", "select app.task_attach($1,'a.pdf','application/pdf',$2)", [task, PDF])).rejects.toThrow(/closed/);
    await run("designer", "select app.task_file_delete($1)", [f]);
    expect((await get("am1", t2)).files.length).toBe(0);
  });
  it("team performance for the Technical Manager and admins only", async () => {
    const rows = (await run("techmgr", "select * from app.tech_performance(null)")).rows;
    const d = rows.find((r: any) => r.employee_id === ids.designer);
    expect(d.assigned).toBe(3); expect(d.approved).toBe(1); expect(d.open_now).toBe(2); expect(d.late_now).toBe(1); expect(d.revisions).toBe(1);
    expect(d.on_time_base).toBe(1); expect(d.minutes).toBeGreaterThanOrEqual(90);
    for (const w of ["am1", "designer", "sales1", "fin"]) expect((await run(w, "select * from app.tech_performance(null)")).rows.length).toBe(0);
    expect((await run("gm", "select * from app.tech_performance(null)")).rows.length).toBeGreaterThan(0);
  });
  it("360° client file: one file for the whole journey; money only for admins and Finance; closed to everyone else", async () => {
    const cid = (await admin.query("select client_id from client_operations where id=$1", [ops])).rows[0].client_id;
    const c360 = async (w: string) => (await run(w, "select app.client_360($1) j", [cid])).rows[0].j;
    const a = await c360("super");
    expect(a.client.name).toBe("متجر الورد"); expect(a.client.creator).toBe("سارة"); expect(a.show_money).toBe(true);
    expect(Number(a.contracts[0].total)).toBe(9000); expect(a.contracts[0].packages).toEqual(["باقة سيو", "باقة ميديا"]);
    expect(a.ops[0].account_manager).toBe("أكاونت 1"); expect(a.ops[0].tasks_all).toBe(3); expect(a.ops[0].tasks_done).toBe(1);
    const kinds = a.timeline.map((e: any) => e.kind);
    for (const k of ["client_created", "stage", "contract_created", "contract_approved", "ops_assigned", "task_created", "task_approved", "kickoff"]) expect(kinds).toContain(k);
    for (const w of ["techmgr", "am1"]) { const j = await c360(w); expect(j.show_money).toBe(false); expect(j.contracts[0].total).toBeNull(); expect(j.tasks.length).toBe(3); }
    expect((await c360("fin")).show_money).toBe(true);
    for (const w of ["am2", "designer", "sales1", "sales2", "tele1"]) expect(await c360(w)).toBeNull();
  });
});
