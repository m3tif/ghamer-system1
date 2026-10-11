import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, ids, admin, future } from "./helpers";

beforeAll(async () => { await setupDb(); });
afterAll(async () => { await teardown(); });

describe("duplicate prevention", () => {
  let first: any;
  it("registers a lead and stores creator/owner", async () => {
    first = await register("tele1", leadPayload({ name: "متجر الورد", phone: "0501234567", store: "https://www.roses.com.sa/?utm=1" }));
    expect(first.status).toBe("created");
    const r = await admin.query("select original_creator_id, current_owner_id from leads where id = $1", [first.lead_id]);
    expect(r.rows[0].original_creator_id).toBe(ids.tele1);
    expect(r.rows[0].current_owner_id).toBe(ids.tele1);
  });
  it("blocks the same phone in another format by another employee and reveals only the owner name", async () => {
    const d = await register("tele2", leadPayload({ name: "اسم مختلف", phone: "+966501234567" }));
    expect(d.status).toBe("duplicate");
    expect(d.owner_name).toBe("سارة");
    expect(Object.keys(d).sort()).toEqual(["ambiguous", "existing_client_id", "matched_kinds", "owner_name", "status"]);
  });
  it("blocks the same store with different www/params/case", async () => {
    const d = await register("sales1", leadPayload({ name: "x", phone: "0559999999", store: "ROSES.com.sa/products?fbclid=9" }));
    expect(d.status).toBe("duplicate");
    expect(d.matched_kinds).toContain("store");
  });
  it("matches alternative numbers too", async () => {
    await register("tele1", leadPayload({ name: "عميل بديل", phone: "0502222222", alt: "0503333333" }));
    const d = await register("tele2", leadPayload({ phone: "0504444444", alt: "0 50 333 3333" }));
    expect(d.status).toBe("duplicate");
  });
  it("notifies the owner about the attempt", async () => {
    const n = await run("tele1", "select kind from notifications where kind = 'duplicate_attempt'");
    expect(n.rowCount).toBeGreaterThan(0);
  });
  it("only one of many simultaneous registrations wins (race condition)", async () => {
    const who = ["tele1", "tele2", "sales1", "sales2"];
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) =>
      register(who[i % 4], leadPayload({ name: `race ${i}`, phone: "0507070707" }))));
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(23);
    const c = await admin.query("select count(*)::int n from client_identifiers where value = '+966507070707'");
    expect(c.rows[0].n).toBe(1);
  });
  it("database rejects duplicate identifiers even when bypassing the function", async () => {
    await expect(admin.query(
      "insert into client_identifiers(client_id, kind, value) select client_id, 'phone', '+966501234567' from leads limit 1"))
      .rejects.toThrow(/duplicate key/);
  });
  it("ownership review request notifies the manager and manager can transfer", async () => {
    const d = await register("tele2", leadPayload({ phone: "0501234567" }));
    const rv = await run("tele2", "select app.request_ownership_review($1, $2, $3::jsonb) id", [d.existing_client_id, "أنا تواصلت مع العميل أولاً", "{}"]);
    const mgrNote = await run("telemgr", "select title from notifications where kind = 'ownership_review'");
    expect(mgrNote.rowCount).toBe(1);
    await run("telemgr", "select app.resolve_duplicate_review($1, 'transfer', 'تم التحقق من المكالمات')", [rv.rows[0].id]);
    const l = await admin.query("select current_owner_id, original_creator_id from leads where id = $1", [first.lead_id]);
    expect(l.rows[0].current_owner_id).toBe(ids.tele2);
    expect(l.rows[0].original_creator_id).toBe(ids.tele1); // original creator is preserved
  });
});

describe("data isolation & no-delete rules", () => {
  it("tele sales cannot see another tele sales' leads", async () => {
    // (the first lead was legitimately transferred to tele2 above; check a lead that was not)
    const r = await run("tele2", "select l.id from leads l join clients c on c.id = l.client_id where l.original_creator_id = $1 and c.name = 'عميل بديل'", [ids.tele1]);
    expect(r.rowCount).toBe(0);
    const own = await run("tele1", "select l.id from leads l join clients c on c.id = l.client_id where c.name = 'عميل بديل'");
    expect(own.rowCount).toBe(1);
  });
  it("tele sales cannot read deals at all, nor identifiers", async () => {
    expect((await run("tele1", "select * from deals")).rowCount).toBe(0);
    await expect(run("tele1", "select * from client_identifiers")).rejects.toThrow(/permission denied/);
    await expect(run("tele1", "select * from users")).rejects.toThrow(/permission denied/);
  });
  it("nobody can delete leads, meetings, payments or audit rows", async () => {
    for (const t of ["leads", "clients", "meetings", "deals", "lead_activities", "audit_logs", "follow_ups"]) {
      await expect(run("super", `delete from ${t}`)).rejects.toThrow(/permission denied/);
    }
  });
  it("employees cannot change original creator/source, even with direct SQL", async () => {
    await expect(run("tele1", "update leads set original_creator_id = $1", [ids.tele2])).rejects.toThrow(/permission denied/);
    await expect(run("super", "update clients set original_source = 'x'")).rejects.toThrow(/permission denied/);
    await expect(admin.query("update clients set original_source = 'x'")).rejects.toThrow(/immutable/);
  });
  it("audit log is append-only even for the owner role", async () => {
    await expect(admin.query("update audit_logs set action = 'x'")).rejects.toThrow(/append-only/);
    await expect(admin.query("delete from audit_logs")).rejects.toThrow(/append-only/);
  });
  it("finance and technical roles see no leads", async () => {
    expect((await run("fin", "select * from leads")).rowCount).toBe(0);
    expect((await run("tech", "select * from clients")).rowCount).toBe(0);
  });
  it("manager sees team leads, GM sees all, other manager sees none of tele team", async () => {
    expect((await run("telemgr", "select * from leads")).rowCount).toBeGreaterThan(0);
    expect((await run("gm", "select * from leads")).rowCount).toBeGreaterThan(0);
    expect((await run("salesmgr", "select * from leads where original_creator_id = $1", [ids.tele1])).rowCount).toBe(0);
  });
  it("GM is read-only", async () => {
    await expect(run("gm", "select app.register_lead($1::jsonb)", [JSON.stringify(leadPayload({ phone: "0508888888" }))])).rejects.toThrow(/not allowed/);
    const r = await run("gm", "update leads set call_notes = 'x'");
    expect(r.rowCount).toBe(0);
  });
  it("source correction needs permission and a written reason, and is audited", async () => {
    const c = await admin.query("select client_id from leads limit 1");
    await expect(run("telemgr", "select app.correct_attribution($1,'meta_ads',null,'x')", [c.rows[0].client_id])).rejects.toThrow(/not allowed/);
    await expect(run("super", "select app.correct_attribution($1,'meta_ads',null,'')", [c.rows[0].client_id])).rejects.toThrow(/reason required/);
    await run("super", "select app.correct_attribution($1,'meta_ads',null,'تصحيح بعد مراجعة المكالمات')", [c.rows[0].client_id]);
    const a = await admin.query("select reason, old_value, new_value from audit_logs where entity_type='clients' and entity_id=$1 and reason like 'تصحيح%'", [c.rows[0].client_id]);
    expect(a.rowCount).toBe(1);
    expect(a.rows[0].new_value.original_source).toBe("meta_ads");
  });
});

describe("meetings, targets and attribution", () => {
  let lead: string; let meeting: string;
  const month = new Date().toISOString().slice(0, 7) + "-01";
  it("tele sales books a meeting; the lead goes to the sales rep and a deal appears for him only", async () => {
    const r = await register("tele1", leadPayload({ name: "عميل الاجتماع", phone: "0511111111" }));
    lead = r.lead_id;
    const m = await run("tele1", "select app.book_meeting($1,$2,$3,'https://meet.example/x','ملاحظات') id", [lead, ids.sales1, future()]);
    meeting = m.rows[0].id;
    expect((await run("sales1", "select * from deals where lead_id = $1", [lead])).rowCount).toBe(1);
    expect((await run("sales2", "select * from deals where lead_id = $1", [lead])).rowCount).toBe(0);
    expect((await run("sales2", "select * from meetings")).rowCount).toBe(0);
    expect((await run("tele2", "select * from meetings")).rowCount).toBe(0);
  });
  it("cannot book a second active meeting for the same lead", async () => {
    await expect(run("tele1", "select app.book_meeting($1,$2,$3,null,null)", [lead, ids.sales1, future(300)])).rejects.toThrow(/already has an active meeting/);
  });
  it("rescheduling edits the same meeting and never creates a second one", async () => {
    await run("tele1", "select app.set_meeting_status($1,'reschedule','العميل طلب',$2,null)", [meeting, future(500)]);
    await run("tele1", "select app.set_meeting_status($1,'confirm',null,null,null)", [meeting]);
    const c = await admin.query("select count(*)::int n, max(reschedule_count) rc from meetings where lead_id = $1", [lead]);
    expect(c.rows[0]).toEqual({ n: 1, rc: 1 });
  });
  it("tele sales cannot mark her own meeting as completed; the sales rep can only after the time", async () => {
    await expect(run("tele1", "select app.set_meeting_status($1,'complete',null,null,null)", [meeting])).rejects.toThrow(/only the sales rep/);
    await expect(run("sales1", "select app.set_meeting_status($1,'complete',null,null,null)", [meeting])).rejects.toThrow(/not arrived/);
    await admin.query("update meetings set scheduled_at = now() - interval '1 hour' where id = $1", [meeting]);
    await run("sales1", "select app.set_meeting_status($1,'complete',null,null,null)", [meeting]);
    await expect(run("sales1", "select app.set_meeting_status($1,'cancel','x',null,null)", [meeting])).rejects.toThrow(/already closed/);
  });
  it("target counts completed meetings once; cancelled and rescheduled are not completed", async () => {
    const r2 = await register("tele1", leadPayload({ name: "ملغي", phone: "0522222221" }));
    const m2 = await run("tele1", "select app.book_meeting($1,$2,$3,null,null) id", [r2.lead_id, ids.sales2, future()]);
    await run("tele1", "select app.set_meeting_status($1,'cancel','العميل اعتذر',null,null)", [m2.rows[0].id]);
    await run("telemgr", "insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'completed_meetings',10,$3)", [ids.tele1, month, ids.telemgr]);
    const s = (await run("tele1", "select * from app.tele_stats($1,$2)", [ids.tele1, month])).rows[0];
    expect(s.meetings_completed).toBe(1);
    expect(s.meetings_cancelled).toBe(1);
    expect(s.meetings_scheduled).toBe(2);
    expect(Number(s.target)).toBe(10);
  });
  it("original tele sales stays attributed after the sales owner is changed", async () => {
    await run("salesmgr", "select app.transfer_lead($1,$2,'sales','تغيير توزيع')", [lead, ids.sales2]);
    const l = await admin.query("select original_creator_id, assigned_sales_id from leads where id = $1", [lead]);
    expect(l.rows[0].original_creator_id).toBe(ids.tele1);
    expect(l.rows[0].assigned_sales_id).toBe(ids.sales2);
    const h = await admin.query("select count(*)::int n from lead_assignments where lead_id = $1", [lead]);
    expect(h.rows[0].n).toBeGreaterThanOrEqual(3);
    expect((await run("sales2", "select * from deals where lead_id = $1", [lead])).rowCount).toBe(1);
    expect((await run("sales1", "select * from deals where lead_id = $1", [lead])).rowCount).toBe(0);
  });
  it("a manager can only set targets for their own team", async () => {
    await expect(run("telemgr", "insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'deals_won',5,$3)", [ids.sales1, month, ids.telemgr])).rejects.toThrow(/row-level security/);
    await expect(run("tele1", "insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'deals_won',5,$1)", [ids.tele1, month])).rejects.toThrow(/row-level security/);
  });
});

describe("sales pipeline", () => {
  let deal: string;
  it("sales registers a lead directly and gets a deal", async () => {
    const r = await register("sales1", leadPayload({ name: "مباشر", phone: "0533333331" }));
    expect(r.status).toBe("created");
    const d = await run("sales1", "select id, stage from deals where lead_id = $1", [r.lead_id]);
    expect(d.rows[0].stage).toBe("New Lead");
    deal = d.rows[0].id;
  });
  it("Postponed requires date and reason; Lost requires reason; finance approval is blocked for sales", async () => {
    await expect(run("sales1", "select app.move_deal_stage($1,'Postponed',null,null,null)", [deal])).rejects.toThrow(/follow-up date and reason/);
    await run("sales1", "select app.move_deal_stage($1,'Postponed',null,$2,'العميل يريد مراجعة الميزانية')", [deal, future(2000)]);
    expect((await run("sales1", "select * from follow_ups where deal_id = $1 and status = 'open'", [deal])).rowCount).toBe(1);
    await expect(run("sales1", "select app.move_deal_stage($1,'Financially Approved','x',null,null)", [deal])).rejects.toThrow(/Finance only/);
    await expect(run("sales1", "select app.move_deal_stage($1,'Lost','',null,null)", [deal])).rejects.toThrow(/reason required/);
    await run("sales1", "select app.move_deal_stage($1,'Signed / Finance Pending','تم التوقيع',null,null)", [deal]);
    const h = await run("sales1", "select count(*)::int n from deal_stage_history where deal_id = $1", [deal]);
    expect(h.rows[0].n).toBe(3); // history is kept, never overwritten
  });
  it("tele sales sees only the outcome of her own leads, without deal details", async () => {
    const r = await register("tele2", leadPayload({ name: "نتيجة", phone: "0544444441" }));
    const m = await run("tele2", "select app.book_meeting($1,$2,$3,null,null) id", [r.lead_id, ids.sales1, future()]);
    await admin.query("update meetings set scheduled_at = now() - interval '1 hour' where id = $1", [m.rows[0].id]);
    await run("sales1", "select app.set_meeting_status($1,'complete',null,null,null)", [m.rows[0].id]);
    const d = await admin.query("select id from deals where lead_id = $1", [r.lead_id]);
    await run("sales1", "select app.move_deal_stage($1,'Signed / Finance Pending','تم',null,null)", [d.rows[0].id]);
    const o = await run("tele2", "select * from app.my_lead_outcomes() where lead_id = $1", [r.lead_id]);
    expect(o.rows[0]).toMatchObject({ meeting_status: "Completed", deal_outcome: "won" });
    expect(Object.keys(o.rows[0]).sort()).toEqual(["deal_outcome", "lead_id", "meeting_status"]);
    const st = (await run("tele2", "select * from app.tele_stats($1, date_trunc('month', now())::date)", [ids.tele2])).rows[0];
    expect(st.contracts_generated).toBe(1);
  });
  it("another employee cannot read someone else's stats", async () => {
    await expect(run("tele2", "select * from app.tele_stats($1, now()::date)", [ids.tele1])).rejects.toThrow(/no access/);
  });
});

describe("audit & jobs", () => {
  it("sensitive actions are in the audit log with actor, old and new values", async () => {
    const a = await admin.query("select actor_id, action, old_value, new_value from audit_logs where entity_type = 'deals' and action = 'UPDATE' order by id desc limit 1");
    expect(a.rows[0].actor_id).toBe(ids.sales1);
    expect(a.rows[0].new_value.stage).toBeDefined();
    const u = await admin.query("select new_value from audit_logs where entity_type = 'users' limit 1");
    expect(JSON.stringify(u.rows[0].new_value)).not.toMatch(/password_hash|mfa_secret/);
  });
  it("daily job is idempotent and creates no duplicate notifications", async () => {
    await run("tele1", "select app.register_lead($1::jsonb)", [JSON.stringify({ ...leadPayload({ phone: "0566666661" }), next_followup_at: new Date(Date.now() - 3600000).toISOString(), followup_reason: "اتصال" })]);
    const { tx } = await import("../src/lib/db");
    const a = await tx(null, (c) => c.query("select app.job_daily('2026-10-10') r"));
    const b = await tx(null, (c) => c.query("select app.job_daily('2026-10-10') r"));
    expect(a.rows[0].r.status).toBe("done");
    expect(b.rows[0].r.status).toBe("skipped");
    await admin.query("delete from job_runs");
    await tx(null, (c) => c.query("select app.job_daily('2026-10-11') r"));
    const n = await admin.query("select count(*)::int n from notifications where kind = 'followup_overdue' and user_id = $1", [ids.tele1]);
    expect(n.rows[0].n).toBe(1);
  });
  it("job cannot be run by a signed-in user", async () => {
    await expect(run("tele1", "select app.job_daily('x')")).rejects.toThrow(/system job only/);
  });
});
