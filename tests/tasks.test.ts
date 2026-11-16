import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin, leadPayload, sendAccepted, contractPayload, signContract } from "./helpers";

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
});
