import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin, leadPayload, sendAccepted, contractPayload, signContract, register } from "./helpers";

const p = async (acc: string, sql: string, params: unknown[] = []) => { const { ptx } = await import("../src/lib/db"); return ptx(acc, (c) => c.query(sql, params)); };
const dealOf = async (lead: string) => (await admin.query("select id from deals where lead_id=$1", [lead])).rows[0].id as string;
const project = async (acc: string, ops: string) => (await p(acc, "select app.portal_project_get($1) j", [ops])).rows[0]?.j;
const staff = async (who: string, ops: string) => (await run(who, "select app.portal_staff_get($1) j", [ops])).rows[0]?.j;
const saveTask = async (who: string, ops: string, x: any) => (await run(who, "select app.task_save($1,null,$2::jsonb) id", [ops, JSON.stringify(x)])).rows[0].id as string;

async function newOps(name: string, phone: string, am: string) {
  const deal = await dealOf(await sendAccepted("tele1", "sales1", leadPayload({ name, phone, status: "Interested" })));
  const c = await signContract("sales1", deal, { ...contractPayload({ start: "2027-01-01" }), total: 9000, items: [{ service: "seo" }] });
  await run("fin", "select app.contract_approve($1,null)", [c]);
  const ops = (await admin.query("select id from client_operations where contract_id=$1", [c])).rows[0].id as string;
  await run("techmgr", "select app.ops_assign($1,$2,null)", [ops, ids[am]]);
  return ops;
}

describe("Client Portal — accounts, isolation, project follow-up, approvals, requests, support", () => {
  let A: string; let B: string; let accA: string; let accB: string;
  beforeAll(async () => {
    await setupDb("ghamer_portal_test");
    A = await newOps("متجر أ", "0574000001", "am1");
    B = await newOps("متجر ب", "0574000002", "am2");
  });
  afterAll(teardown);

  it("only the client's Account Manager / Technical Manager / admin opens the portal; the contract must be approved; one account per client", async () => {
    for (const w of ["am2", "designer", "sales1", "fin", "tele1"]) await expect(run(w, "select app.portal_enable($1,'+966574000001','h','x')", [A])).rejects.toThrow(/not allowed/);
    await expect(run("am1", "select app.portal_enable($1,'0574','h','x')", [A])).rejects.toThrow(/invalid phone/);
    expect((await run("am1", "select app.portal_enable($1,'+966574000001','hashA','') n", [A])).rows[0].n).toBe(true);
    expect((await run("am1", "select app.portal_enable($1,'+966574000001','other','') n", [A])).rows[0].n).toBe(false);   // already has it: password untouched
    expect((await admin.query("select password_hash from portal_accounts where phone='+966574000001'")).rows[0].password_hash).toBe("hashA");
    await expect(run("am2", "select app.portal_enable($1,'+966574000001','h','')", [B])).rejects.toThrow(/phone already has/);
    await run("am2", "select app.portal_enable($1,'+966574000002','hashB','')", [B]);
    accA = (await admin.query("select id from portal_accounts where phone='+966574000001'")).rows[0].id;
    accB = (await admin.query("select id from portal_accounts where phone='+966574000002'")).rows[0].id;
    const st = await staff("am1", A);
    expect(st.stages.length).toBe(7); expect(st.stages[0].status).toBe("current"); expect(st.project.title).toBe("متجر أ");
    expect(await staff("am2", A)).toBeNull();
  });

  it("sign-in: lookup by phone, sessions, lock after 5 wrong tries, admin-only password reset", async () => {
    const u = (await run(null as any, "select * from app.portal_auth_lookup('+966574000001')")).rows[0];
    expect(u.password_hash).toBe("hashA"); expect(u.is_active).toBe(true);
    await run(null as any, "select app.portal_session_create($1,'tok-a',12,'1.1.1.1','ua')", [accA]);
    const s = (await run(null as any, "select * from app.portal_session_get('tok-a')")).rows[0];
    expect(s.account_id).toBe(accA); expect(s.must_change_password).toBe(true); expect(s.client_name).toBe("متجر أ");
    for (let i = 0; i < 5; i++) await run(null as any, "select app.portal_auth_fail($1)", [accA]);
    expect((await run(null as any, "select * from app.portal_auth_lookup('+966574000001')")).rows[0].locked_until).not.toBeNull();
    for (const w of ["am1", "techmgr"]) await expect(run(w, "select app.portal_reset_password($1,'x')", [A])).rejects.toThrow(/not allowed/);
    await run("super", "select app.portal_reset_password($1,'hashA2')", [A]);
    expect((await run(null as any, "select * from app.portal_session_get('tok-a')")).rows.length).toBe(0);   // signed out everywhere
    const after = (await run(null as any, "select * from app.portal_auth_lookup('+966574000001')")).rows[0];
    expect(after.password_hash).toBe("hashA2"); expect(after.locked_until).toBeNull();
    await p(accA, "select app.portal_set_password('hashA3', 'none')");
    expect((await admin.query("select must_change_password m from portal_accounts where id=$1", [accA])).rows[0].m).toBe(false);
  });

  it("a client sees only his own project — never another client's, and never staff data", async () => {
    expect((await project(accA, A)).title).toBe("متجر أ");
    expect(await project(accA, B)).toBeNull();
    expect(await project(accB, A)).toBeNull();
    expect((await p(accA, "select * from app.portal_projects()")).rows.map((r: any) => r.ops_id)).toEqual([A]);
    // the portal identity is nobody to the staff functions, and the staff identity is nobody to the client functions
    expect((await p(accA, "select * from app.task_list(null,null)")).rows.length).toBe(0);
    expect((await p(accA, "select app.portal_staff_get($1) j", [A])).rows[0].j).toBeNull();
    expect((await run("am1", "select app.portal_project_get($1) j", [A])).rows[0].j).toBeNull();
    for (const tb of ["portal_accounts", "portal_files", "project_stages", "portal_messages", "portal_sessions", "portal_events"]) {
      await expect(p(accA, `select * from ${tb}`)).rejects.toThrow(/permission denied/);
      await expect(run("am1", `select * from ${tb}`)).rejects.toThrow(/permission denied/);
    }
    // a stopped account can't sign in
    await expect(run("am1", "select app.portal_set_active($1,false)", [A])).rejects.toThrow(/not allowed/);
    await run("techmgr", "select app.portal_set_active($1,false)", [B]);
    expect((await run(null as any, "select * from app.portal_auth_lookup('+966574000002')")).rows[0].is_active).toBe(false);
    expect(await project(accB, B)).toBeNull();
    await run("techmgr", "select app.portal_set_active($1,true)", [B]);
  });

  it("stages: moving the project forward shows to the client with a clear progress number", async () => {
    let j = await project(accA, A);
    expect(j.progress).toBe(0); expect(j.stages.find((s: any) => s.status === "current").name).toBe("البداية وتجميع البيانات");
    await expect(run("am2", "select app.portal_stage_advance($1)", [A])).rejects.toThrow(/not allowed/);
    await run("am1", "select app.portal_stage_advance($1)", [A]);
    j = await project(accA, A);
    expect(j.progress).toBe(14);   // 1 of 7 stages
    expect(j.updates[0].title).toContain("بدأنا «التخطيط وخطة العمل»");
    // the current stage counts by its linked tasks: 1 of 2 done → half a stage
    const st = (await staff("am1", A)).stages; const cur = st.find((s: any) => s.status === "current").id;
    const t1 = await saveTask("am1", A, { title: "خطة المحتوى", assignee: ids.seo }); const t2 = await saveTask("am1", A, { title: "خطة الإعلانات", assignee: ids.seo });
    for (const t of [t1, t2]) await run("am1", "select app.portal_task_set($1,true,$2,'خطة الشهر الأول')", [t, cur]);
    await run("seo", "select app.task_submit($1,'',null)", [t1]); await run("am1", "select app.task_review($1,true,null)", [t1]);
    expect((await project(accA, A)).progress).toBe(21);   // (1 + 0.5) / 7
    // set a later stage as current: everything before it is done
    await run("am1", "select app.portal_stage_set_current($1)", [st[4].id]);
    j = await project(accA, A);
    expect(j.stages.filter((s: any) => s.status === "done").length).toBe(4);
    const n = (await p(accA, "select * from app.portal_notifications()")).rows;
    expect(n.some((x: any) => x.title === "مشروعك دخل مرحلة جديدة")).toBe(true);
    // stages are editable per project
    const added = (await run("am1", "select app.portal_stage_save($1,null,'تدريب فريق العميل',null) id", [A])).rows[0].id;
    await run("am1", "select app.portal_stage_move($1,-1)", [added]);
    await expect(run("am1", "select app.portal_stage_delete($1)", [st[4].id])).rejects.toThrow(/current stage/);
    await run("am1", "select app.portal_stage_delete($1)", [added]);
    expect((await project(accA, A)).stages.length).toBe(7);
  });

  it("tasks: internal by default; shown ones appear without anything internal; the client approves or asks for changes with a reason", async () => {
    const hidden = await saveTask("am1", A, { title: "تاسك داخلي", assignee: ids.designer });
    await run("designer", "select app.task_comment($1,'ملاحظة داخلية جدا')", [hidden]);
    const shown = await saveTask("am1", A, { title: "تصميم البنرات", assignee: ids.designer, needs_client: true });
    let j = await project(accA, A);
    expect(j.tasks.map((t: any) => t.title)).not.toContain("تاسك داخلي");
    expect(j.tasks.map((t: any) => t.title)).not.toContain("تصميم البنرات");   // needs the client, but not sent to him yet
    expect(JSON.stringify(j)).not.toMatch(/ملاحظة داخلية|ديزاينر|designer/);
    await run("designer", "select app.task_submit($1,'https://figma.com/x','ملاحظة للأكاونت بس')", [shown]);
    await run("am1", "select app.task_review($1,true,null)", [shown]);
    j = await project(accA, A);
    const t = j.tasks.find((x: any) => x.id === shown);
    expect(t.needs_you).toBe(true); expect(t.link).toBe("https://figma.com/x"); expect(JSON.stringify(t)).not.toMatch(/ملاحظة للأكاونت/);
    expect((await p(accA, "select * from app.portal_notifications()")).rows.some((x: any) => x.title === "شغل مستني موافقتك")).toBe(true);
    await expect(p(accB, "select app.portal_task_decide($1,true,null)", [shown])).rejects.toThrow(/not allowed/);
    await expect(p(accA, "select app.portal_task_decide($1,false,' ')", [shown])).rejects.toThrow(/reason required/);
    await expect(p(accA, "select app.portal_task_decide($1,true,null)", [hidden])).rejects.toThrow(/not allowed/);
    await p(accA, "select app.portal_task_decide($1,false,'عاوز اللون أغمق')", [shown]);
    const g = (await run("designer", "select app.task_get($1) j", [shown])).rows[0].j;
    expect(g.status).toBe("changes_requested"); expect(g.review_note).toContain("عاوز اللون أغمق");
    expect((await admin.query("select count(*)::int n from notifications where user_id=$1 and kind='portal'", [ids.am1])).rows[0].n).toBeGreaterThan(0);
    await run("designer", "select app.task_submit($1,'https://figma.com/y',null)", [shown]);
    await run("am1", "select app.task_review($1,true,null)", [shown]);
    await p(accA, "select app.portal_task_decide($1,true,'تمام كده')", [shown]);
    expect((await run("designer", "select app.task_get($1) j", [shown])).rows[0].j.status).toBe("approved");
    expect((await project(accA, A)).tasks.find((x: any) => x.id === shown).messages.map((m: any) => m.body)).toEqual(["عاوز اللون أغمق", "تمام كده"]);
  });

  it("documents: staff files are internal until shown; the client's own files reach the staff; nobody else can open them", async () => {
    const internal = (await run("am1", "select app.portal_staff_file_add($1,'داخلي.pdf','application/pdf',$2,false,null,null) id", [A, Buffer.from("%PDF-x")])).rows[0].id;
    const shown = (await run("am1", "select app.portal_staff_file_add($1,'الخطة.pdf','application/pdf',$2,true,null,null) id", [A, Buffer.from("%PDF-y")])).rows[0].id;
    const mine = (await p(accA, "select app.portal_client_file_add($1,'لوجو.png','image/png',$2,null,null) id", [A, Buffer.from("png")])).rows[0].id;
    let files = (await project(accA, A)).files.map((f: any) => f.filename);
    expect(files).toContain("الخطة.pdf"); expect(files).toContain("لوجو.png"); expect(files).not.toContain("داخلي.pdf");
    expect((await p(accA, "select * from app.portal_file_get($1)", [internal])).rows.length).toBe(0);
    expect((await p(accA, "select * from app.portal_file_get($1)", [shown])).rows[0].content.toString()).toBe("%PDF-y");
    expect((await p(accB, "select * from app.portal_file_get($1)", [shown])).rows.length).toBe(0);
    expect((await run("am2", "select * from app.portal_file_get($1)", [mine])).rows.length).toBe(0);
    expect((await run("am1", "select * from app.portal_file_get($1)", [mine])).rows[0].content.toString()).toBe("png");
    await expect(p(accB, "select app.portal_client_file_add($1,'x.png','image/png',$2,null,null)", [A, Buffer.from("x")])).rejects.toThrow(/not allowed/);
    await expect(run("am1", "select app.portal_file_visibility($1,false)", [mine])).rejects.toThrow(/not allowed/);
    await run("am1", "select app.portal_file_visibility($1,true)", [internal]);
    files = (await project(accA, A)).files.map((f: any) => f.filename);
    expect(files).toContain("داخلي.pdf");
  });

  it("requests from the client: he answers (text and files), the staff accepts or sends it back", async () => {
    const r = (await run("am1", "select app.portal_request_save($1,'ابعت صور المنتجات','بجودة عالية','2027-01-10') id", [A])).rows[0].id;
    await expect(p(accB, "select app.portal_request_respond($1,'x')", [r])).rejects.toThrow(/not allowed/);
    await expect(p(accA, "select app.portal_request_respond($1,'')", [r])).rejects.toThrow(/reply text required/);
    await p(accA, "select app.portal_client_file_add($1,'منتج.jpg','image/jpeg',$2,'request',$3)", [A, Buffer.from("jpg"), r]);
    await p(accA, "select app.portal_request_respond($1,'')", [r]);   // a file alone is an answer
    await run("am1", "select app.portal_request_close($1,'return','محتاجين صور أكتر')", [r]);
    let j = (await project(accA, A)).requests.find((x: any) => x.id === r);
    expect(j.status).toBe("open"); expect(j.return_note).toBe("محتاجين صور أكتر"); expect(j.files.length).toBe(1);
    await p(accA, "select app.portal_request_respond($1,'بعت باقي الصور على الدرايف')", [r]);
    await run("am1", "select app.portal_request_close($1,'done',null)", [r]);
    j = (await project(accA, A)).requests.find((x: any) => x.id === r);
    expect(j.status).toBe("done");
    await expect(p(accA, "select app.portal_request_respond($1,'x')", [r])).rejects.toThrow(/closed/);
  });

  it("support: the client opens a ticket, the team replies, either side closes it; comments on updates go to the team", async () => {
    const tk = (await p(accA, "select app.portal_ticket_open($1,'الموقع بطيء','الصفحة الرئيسية بتاخد وقت') id", [A])).rows[0].id;
    await expect(p(accB, "select app.portal_ticket_open($1,'x','y')", [A])).rejects.toThrow(/not allowed/);
    expect((await p(accB, "select app.portal_ticket_get($1) j", [tk])).rows[0].j).toBeNull();
    await expect(run("am2", "select app.portal_staff_message('ticket',$1,'x')", [tk])).rejects.toThrow(/not allowed/);
    await run("am1", "select app.portal_staff_message('ticket',$1,'بنشتغل عليها النهارده')", [tk]);
    let g = (await p(accA, "select app.portal_ticket_get($1) j", [tk])).rows[0].j;
    expect(g.status).toBe("answered"); expect(g.messages.map((m: any) => m.from_client)).toEqual([true, false]);
    await p(accA, "select app.portal_client_message('ticket',$1,'شكرًا')", [tk]);
    await p(accA, "select app.portal_ticket_close($1)", [tk]);
    await expect(p(accA, "select app.portal_client_message('ticket',$1,'تاني')", [tk])).rejects.toThrow(/closed/);
    const u = (await run("am1", "select app.portal_update_post($1,'خلصنا تصميم الصفحة الرئيسية','شوف الرابط') id", [A])).rows[0].id;
    await p(accA, "select app.portal_client_message('update',$1,'حلو جدا')", [u]);
    await expect(p(accB, "select app.portal_client_message('update',$1,'x')", [u])).rejects.toThrow(/not allowed/);
    const st = await staff("am1", A);
    expect(st.updates.find((x: any) => x.id === u).messages[0].body).toBe("حلو جدا");
    expect(st.events.length).toBeGreaterThan(10);
    expect(st.events.some((e: any) => e.by === "العميل" && e.action === "العميل فتح طلب دعم")).toBe(true);
    // notifications are the client's own
    const mineN = (await p(accA, "select * from app.portal_notifications()")).rows.length;
    await p(accB, "select app.portal_notifications_read(null)");
    expect((await p(accA, "select count(*)::int n from app.portal_notifications() where read_at is null")).rows[0].n).toBe(mineN - (await p(accA, "select count(*)::int n from app.portal_notifications() where read_at is not null")).rows[0].n);
    await p(accA, "select app.portal_notifications_read(null)");
    expect((await p(accA, "select count(*)::int n from app.portal_notifications() where read_at is null")).rows[0].n).toBe(0);
  });
  it("an existing client («عميل قائم», no contract in the system) gets the portal too, with his packages and dates", async () => {
    await register("super", { ...leadPayload({ name: "عميل قائم", phone: "0574000009" }), mode: "existing" });
    const q = (await run("techmgr", "select * from app.ops_list('new')")).rows.find((x: any) => x.client_name === "عميل قائم");
    await run("techmgr", "select app.ops_set_packages($1,$2,'2026-01-01','2026-12-31')", [q.id, ["seo"]]);
    await run("techmgr", "select app.ops_assign($1,$2,null)", [q.id, ids.am1]);
    const st = await staff("super", q.id);
    expect(st).not.toBeNull(); expect(st.contract_approved).toBe(true); expect(st.project).toBeNull();
    expect((await run("am1", "select app.portal_enable($1,'+966574000009','hashC','') n", [q.id])).rows[0].n).toBe(true);
    const acc = (await admin.query("select id from portal_accounts where phone='+966574000009'")).rows[0].id;
    const j = await project(acc, q.id);
    expect(j.services).toEqual(["باقة سيو"]); expect(String(j.start_date)).toContain("2026-01-01"); expect(String(j.expected_end)).toContain("2026-12-31");
    expect(await project(acc, A)).toBeNull();
  });
  it("client dates and contract upload: the Account Manager / Technical Manager / admin set the dates and upload the contract", async () => {
    const before = (await admin.query("select c.start_date, c.end_date from contracts c join client_operations o on o.contract_id = c.id where o.id = $1", [A])).rows[0];
    const payload = (x: any) => JSON.stringify({ name: "متجر أ", identifiers: [{ kind: "phone", value: "+966574000001", label: "mobile" }], phones: [{ label: "mobile", raw: "0574000001", value: "+966574000001" }], ...x });
    await expect(run("am2", "select app.ops_client_update($1,$2::jsonb)", [A, payload({ start_date: "2027-02-01", end_date: "2027-08-01" })])).rejects.toThrow(/no access/);
    await expect(run("am1", "select app.ops_client_update($1,$2::jsonb)", [A, payload({ start_date: "2027-08-01", end_date: "2027-02-01" })])).rejects.toThrow(/end date is before/);
    await run("am1", "select app.ops_client_update($1,$2::jsonb)", [A, payload({ start_date: "2027-02-01", end_date: "2027-08-01" })]);
    const g = (await run("techmgr", "select app.ops_client_get($1) j", [A])).rows[0].j;
    expect(g.start_date).toBe("2027-02-01"); expect(g.end_date).toBe("2027-08-01"); expect(g.has_contract).toBe(true);
    const row = (await run("am1", "select * from app.ops_list(null) where id = $1", [A])).rows[0];
    expect(String(row.end_date)).toContain(new Date("2027-08-01").getFullYear().toString());
    const after = (await admin.query("select c.start_date, c.end_date from contracts c join client_operations o on o.contract_id = c.id where o.id = $1", [A])).rows[0];
    expect(after).toEqual(before);   // the Finance contract itself is untouched
    // the contract file
    const pdf = Buffer.from("%PDF-1.4 contract");
    for (const w of ["sales1", "am2", "designer", "fin"]) await expect(run(w, "select app.ops_contract_attach($1,'عقد.pdf','application/pdf',$2)", [A, pdf])).rejects.toThrow(/not allowed/);
    await expect(run("am1", "select app.ops_contract_attach($1,'x.pdf','application/pdf',$2)", [A, Buffer.from("not a pdf")])).rejects.toThrow(/unsupported/);
    const f = (await run("am1", "select app.ops_contract_attach($1,'عقد لولوه.pdf','application/pdf',$2) id", [A, pdf])).rows[0].id;
    expect((await run("techmgr", "select * from app.ops_contract_files($1)", [A])).rows.map((r: any) => r.filename)).toEqual(["عقد لولوه.pdf"]);
    expect((await run("techmgr", "select * from app.attachment_get($1)", [f])).rows[0].content.toString()).toBe("%PDF-1.4 contract");
    expect((await run("am2", "select * from app.attachment_get($1)", [f])).rows.length).toBe(0);
    expect((await run("am2", "select * from app.ops_contract_files($1)", [A])).rows.length).toBe(0);
    await expect(run("techmgr", "select app.ops_contract_delete($1)", [f])).rejects.toThrow(/not allowed/);
    await run("am1", "select app.ops_contract_delete($1)", [f]);
    expect((await run("am1", "select * from app.ops_contract_files($1)", [A])).rows.length).toBe(0);
  });
});
