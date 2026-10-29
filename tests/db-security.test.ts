import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, ids, admin, future, sendAccepted, bookAs, pastMeeting } from "./helpers";

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
  it("blocks the same phone in another format by another employee and reveals only the owner, status and name — nothing else", async () => {
    const d = await register("tele2", leadPayload({ name: "اسم مختلف", phone: "+966501234567" }));
    expect(d.status).toBe("duplicate");
    expect(d.owner_name).toBe("سارة");
    expect(Object.keys(d).sort()).toEqual(["ambiguous", "existing_added_at", "existing_client_id", "existing_name", "existing_status", "matched_kinds", "owner_name", "status"]);
  });
  it("a store link alone never blocks (only the phone number is the duplicate rule)", async () => {
    const d = await register("sales1", leadPayload({ name: "x", phone: "0559999999", store: "ROSES.com.sa/products?fbclid=9" }));
    expect(d.status).toBe("created");
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

describe("meetings (managed by Sales), targets and attribution", () => {
  let lead: string; let meeting: string;
  const month = new Date().toISOString().slice(0, 7) + "-01";
  it("Tele Sales cannot create meetings; Sales cannot before accepting; after accepting he can", async () => {
    const r = await register("tele1", leadPayload({ name: "عميل الاجتماع", phone: "0511111111", status: "Interested" }));
    lead = r.lead_id;
    await expect(run("tele1", "select app.book_meeting($1,$2,'x','online',null,null,null)", [lead, future()])).rejects.toThrow(/not allowed/);
    await run("tele1", "select app.handoff_lead($1,$2,'جاهز')", [lead, ids.sales1]);
    await expect(run("sales1", "select app.book_meeting($1,$2,'x','online',null,null,null)", [lead, future()])).rejects.toThrow(/not accepted by sales yet/);
    await run("sales1", "select app.accept_handoff($1)", [lead]);
    meeting = await bookAs("sales1", lead, 120, "https://meet.google.com/abc-defg-hij");
    expect((await run("sales1", "select id from deals where lead_id = $1", [lead])).rowCount).toBe(1);
    expect((await run("sales2", "select id from deals where lead_id = $1", [lead])).rowCount).toBe(0);
    expect((await run("sales2", "select id from meetings")).rowCount).toBe(0);
    expect((await run("tele2", "select id from meetings")).rowCount).toBe(0);
  });
  it("the meeting link is visible to its Sales owner and admin only, never to Tele Sales (even by direct SQL)", async () => {
    expect((await run("sales1", "select app.meeting_link($1) l", [meeting])).rows[0].l).toBe("https://meet.google.com/abc-defg-hij");
    expect((await run("super", "select app.meeting_link($1) l", [meeting])).rows[0].l).toBe("https://meet.google.com/abc-defg-hij");
    expect((await run("tele1", "select app.meeting_link($1) l", [meeting])).rows[0].l).toBeNull();
    expect((await run("sales2", "select app.meeting_link($1) l", [meeting])).rows[0].l).toBeNull();
    await expect(run("tele1", "select meeting_url from meetings")).rejects.toThrow(/permission denied/);
    await expect(run("sales1", "select * from meetings")).rejects.toThrow(/permission denied/);
    const own = await run("tele1", "select id, status from meetings where id = $1", [meeting]);
    expect(own.rowCount).toBe(1); // she can still see that her lead's meeting exists and its status
    await expect(run("tele1", "update meetings set meeting_url = 'https://x.example.com' where id = $1", [meeting])).rejects.toThrow(/permission denied/);
    const ev = await admin.query("select new_value from meeting_events where meeting_id = $1", [meeting]);
    expect(JSON.stringify(ev.rows)).not.toMatch(/meet\.google/); // the link is never written to the event log
  });
  it("Tele Sales still sees her meeting in the list (name, time, status) but never the link or the private notes", async () => {
    const tl = (await run("tele1", "select * from app.list_meetings('upcoming', 50)")).rows.find((r: any) => r.id === meeting);
    expect(tl).toBeTruthy();
    expect(tl.meeting_url).toBeNull(); expect(tl.booking_notes).toBeNull(); expect(tl.can_open_lead).toBe(false); expect(tl.client_name).toBe("عميل الاجتماع");
    const sl = (await run("sales1", "select * from app.list_meetings('upcoming', 50)")).rows.find((r: any) => r.id === meeting);
    expect(sl.meeting_url).toBe("https://meet.google.com/abc-defg-hij"); expect(sl.can_open_lead).toBe(true);
    expect((await run("sales2", "select * from app.list_meetings('all', 50)")).rows.find((r: any) => r.id === meeting)).toBeUndefined();
    expect((await run("tele2", "select * from app.list_meetings('all', 50)")).rows.find((r: any) => r.id === meeting)).toBeUndefined();
    expect((await run("salesmgr", "select * from app.list_meetings('upcoming', 50)")).rows.find((r: any) => r.id === meeting)?.meeting_url).toBe("https://meet.google.com/abc-defg-hij");
    expect((await run("telemgr", "select * from app.list_meetings('upcoming', 50)")).rows.find((r: any) => r.id === meeting)?.meeting_url).toBeNull();
    expect((await run("tele1", "select * from app.meeting_counts()")).rows[0].upcoming).toBeGreaterThanOrEqual(1);
  });
  it("the link is validated and optional", async () => {
    const l2 = await sendAccepted("tele1", "sales1", leadPayload({ name: "رابط", phone: "0512222222", status: "Interested" }));
    for (const bad of ["javascript:alert(1)", "ftp://files.example.com/x", "http://", "not a url", "https://a b.com"])
      await expect(run("sales1", "select app.book_meeting($1,$2,'x','online',$3,null,null)", [l2, future(), bad])).rejects.toThrow(/invalid meeting link/);
    const id = await bookAs("sales1", l2, 90, null);
    expect((await run("sales1", "select app.meeting_link($1) l", [id])).rows[0].l).toBeNull(); // no default link is invented
  });
  it("double submit with the same request id creates one meeting; a second active meeting is refused", async () => {
    const l3 = await sendAccepted("tele2", "sales2", leadPayload({ name: "ضغط مزدوج", phone: "0513333333", status: "Interested" }));
    const rid = "22222222-2222-2222-2222-222222222222";
    const ids3 = await Promise.all([1, 2, 3, 4].map(() => bookAs("sales2", l3, 150, null, rid)));
    expect(new Set(ids3).size).toBe(1);
    await expect(bookAs("sales2", l3, 400)).rejects.toThrow(/already has an active meeting/);
  });
  it("editing: other fields never change the time; a time change needs a reason and marks it rescheduled; Tele Sales cannot edit", async () => {
    const before = (await admin.query("select scheduled_at, meeting_url from meetings where id = $1", [meeting])).rows[0];
    await run("sales1", "select app.update_meeting($1,'عنوان جديد',$2,'online','https://meet.google.com/abc-defg-hij','ملاحظة جديدة',null)", [meeting, before.scheduled_at]);
    const same = (await admin.query("select scheduled_at, status, reschedule_count, title from meetings where id = $1", [meeting])).rows[0];
    expect(new Date(same.scheduled_at).getTime()).toBe(new Date(before.scheduled_at).getTime());
    expect(same.reschedule_count).toBe(0); expect(same.title).toBe("عنوان جديد");
    await expect(run("sales1", "select app.update_meeting($1,'x',$2,'online',null,null,null)", [meeting, future(500)])).rejects.toThrow(/reason required/);
    await run("sales1", "select app.update_meeting($1,'عنوان جديد',$2,'online','https://meet.google.com/abc-defg-hij',null,'العميل طلب تأجيلًا')", [meeting, future(500)]);
    const moved = (await admin.query("select status, reschedule_count from meetings where id = $1", [meeting])).rows[0];
    expect(moved).toEqual({ status: "Rescheduled", reschedule_count: 1 });
    await expect(run("tele1", "select app.update_meeting($1,'x',$2,'online','https://evil.example.com',null,'x')", [meeting, future(600)])).rejects.toThrow(/not allowed/);
    await expect(run("sales2", "select app.update_meeting($1,'x',$2,'online',null,null,'x')", [meeting, future(600)])).rejects.toThrow(/no access/);
    expect((await admin.query("select count(*)::int n from meetings where lead_id = $1", [lead])).rows[0].n).toBe(1);
  });
  it("cancel needs a reason, keeps the record, and the cancelled meeting is not 'upcoming'", async () => {
    const l4 = await sendAccepted("tele1", "sales1", leadPayload({ name: "إلغاء", phone: "0514444444", status: "Interested" }));
    const m = await bookAs("sales1", l4, 200);
    await expect(run("sales1", "select app.set_meeting_status($1,'cancel','',null,null)", [m])).rejects.toThrow(/reason required/);
    await expect(run("tele1", "select app.set_meeting_status($1,'cancel','x',null,null)", [m])).rejects.toThrow(/not allowed/);
    await run("sales1", "select app.set_meeting_status($1,'cancel','العميل اعتذر',null,null)", [m]);
    const { listMeetings } = await import("../src/server/data");
    expect((await listMeetings(ids.sales1, "upcoming")).map((x: any) => x.id)).not.toContain(m);
    expect((await listMeetings(ids.sales1, "cancelled")).map((x: any) => x.id)).toContain(m);
    await expect(run("sales1", "select app.set_meeting_status($1,'confirm',null,null,null)", [m])).rejects.toThrow(/already closed/);
    expect((await admin.query("select count(*)::int n from meeting_events where meeting_id = $1 and event = 'cancelled'", [m])).rows[0].n).toBe(1);
  });
  it("a meeting whose time passed is not shown as upcoming; it waits for its result", async () => {
    const l5 = await sendAccepted("tele2", "sales1", leadPayload({ name: "انتهى وقته", phone: "0515555555", status: "Interested" }));
    const m = await bookAs("sales1", l5, 100);
    const { listMeetings, meetingCounts } = await import("../src/server/data");
    expect((await listMeetings(ids.sales1, "upcoming")).map((x: any) => x.id)).toContain(m);
    await pastMeeting(m);
    expect((await listMeetings(ids.sales1, "upcoming")).map((x: any) => x.id)).not.toContain(m);
    expect((await listMeetings(ids.sales1, "awaiting")).map((x: any) => x.id)).toContain(m);
    expect((await meetingCounts(ids.sales1)).awaiting).toBeGreaterThanOrEqual(1);
    await expect(run("sales1", "select app.update_meeting($1,'x',$2,'online',null,null,'x')", [m, future(300)])).rejects.toThrow(/before its time/);
    await run("sales1", "select app.complete_meeting($1,'needs_followup','ناقشنا الأسعار','إرسال العرض',$2)", [m, future(2880)]);
    expect((await listMeetings(ids.sales1, "done")).map((x: any) => x.id)).toContain(m);
    expect((await run("sales1", "select count(*)::int n from follow_ups where lead_id = $1 and status = 'open'", [l5])).rows[0].n).toBe(1);
    await expect(run("sales1", "select app.complete_meeting($1,'positive',null,null,null)", [m])).rejects.toThrow(/already closed/);
  });
  it("result: outcome required, not before the time, only by the Sales owner (not Tele Sales)", async () => {
    await expect(run("sales1", "select app.complete_meeting($1,'positive',null,null,null)", [meeting])).rejects.toThrow(/not arrived/);
    await pastMeeting(meeting);
    await expect(run("sales1", "select app.complete_meeting($1,null,null,null,null)", [meeting])).rejects.toThrow(/outcome required/);
    await expect(run("tele1", "select app.complete_meeting($1,'positive',null,null,null)", [meeting])).rejects.toThrow(/not allowed/);
    await expect(run("sales2", "select app.complete_meeting($1,'positive',null,null,null)", [meeting])).rejects.toThrow(/no access/);
    await run("sales1", "select app.complete_meeting($1,'positive','تم الاتفاق',null,null)", [meeting]);
    const m = (await admin.query("select status, outcome, completed_at, outcome_by from meetings where id = $1", [meeting])).rows[0];
    expect(m.status).toBe("Completed"); expect(m.outcome).toBe("positive"); expect(m.outcome_by).toBe(ids.sales1); expect(m.completed_at).not.toBeNull();
  });
  it("target counts completed meetings once, credited to the Tele Sales who added the lead", async () => {
    await run("telemgr", "insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'completed_meetings',10,$3)", [ids.tele1, month, ids.telemgr]);
    const s1 = (await run("tele1", "select * from app.tele_stats($1,$2)", [ids.tele1, month])).rows[0];
    expect(s1.meetings_completed).toBe(1);
    expect(s1.meetings_cancelled).toBe(1);
    expect(Number(s1.target)).toBe(10);
  });
  it("original tele sales stays attributed after the Sales owner is changed", async () => {
    await run("salesmgr", "select app.transfer_lead($1,$2,'sales','تغيير توزيع')", [lead, ids.sales2]);
    const l = await admin.query("select original_creator_id, assigned_sales_id from leads where id = $1", [lead]);
    expect(l.rows[0].original_creator_id).toBe(ids.tele1);
    expect(l.rows[0].assigned_sales_id).toBe(ids.sales2);
    expect((await run("sales2", "select id from deals where lead_id = $1", [lead])).rowCount).toBe(1);
    expect((await run("sales1", "select id from deals where lead_id = $1", [lead])).rowCount).toBe(0);
  });
  it("a manager can only set targets for their own team", async () => {
    await expect(run("telemgr", "insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'deals_won',5,$3)", [ids.sales1, month, ids.telemgr])).rejects.toThrow(/row-level security/);
    await expect(run("tele1", "insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'deals_won',5,$1)", [ids.tele1, month])).rejects.toThrow(/row-level security/);
  });
});

describe("sales pipeline", () => {
  let deal: string;
  it("sales registers a lead directly and gets a deal; he can book a meeting for it without a hand-off", async () => {
    const r = await register("sales1", leadPayload({ name: "مباشر", phone: "0533333331" }));
    expect(r.status).toBe("created");
    const d = await run("sales1", "select id, stage from deals where lead_id = $1", [r.lead_id]);
    expect(d.rows[0].stage).toBe("New Lead");
    deal = d.rows[0].id;
    expect(await bookAs("sales1", r.lead_id, 60)).toBeTruthy();
  });
  it("Postponed requires date and reason; Lost requires reason; finance approval is blocked for sales", async () => {
    await expect(run("sales1", "select app.move_deal_stage($1,'Postponed',null,null,null)", [deal])).rejects.toThrow(/follow-up date and reason/);
    await run("sales1", "select app.move_deal_stage($1,'Postponed',null,$2,'العميل يريد مراجعة الميزانية')", [deal, future(2000)]);
    expect((await run("sales1", "select id from follow_ups where deal_id = $1 and status = 'open'", [deal])).rowCount).toBe(1);
    await expect(run("sales1", "select app.move_deal_stage($1,'Financially Approved','x',null,null)", [deal])).rejects.toThrow(/Finance only/);
    await expect(run("sales1", "select app.move_deal_stage($1,'Lost','',null,null)", [deal])).rejects.toThrow(/reason required/);
    await run("sales1", "select app.move_deal_stage($1,'Signed / Finance Pending','تم التوقيع',null,null)", [deal]);
    const h = await run("sales1", "select count(*)::int n from deal_stage_history where deal_id = $1", [deal]);
    expect(h.rows[0].n).toBeGreaterThanOrEqual(3); // history is kept, never overwritten
  });
  it("tele sales sees only the outcome of her own leads, without deal details", async () => {
    const l = await sendAccepted("tele2", "sales1", leadPayload({ name: "نتيجة", phone: "0544444441", status: "Interested" }));
    const m = await bookAs("sales1", l, 60); await pastMeeting(m);
    await run("sales1", "select app.complete_meeting($1,'positive',null,null,null)", [m]);
    const d = await admin.query("select id from deals where lead_id = $1", [l]);
    await run("sales1", "select app.move_deal_stage($1,'Signed / Finance Pending','تم',null,null)", [d.rows[0].id]);
    const o = await run("tele2", "select * from app.my_lead_outcomes() where lead_id = $1", [l]);
    expect(o.rows[0]).toMatchObject({ meeting_status: "Completed", deal_outcome: "won", handoff_status: "accepted" });
    expect(Object.keys(o.rows[0]).sort()).toEqual(["business_name", "client_name", "deal_outcome", "decided_at", "handed_off_at", "handoff_status", "lead_id",
      "lead_status", "meeting_status", "to_name"]);
    expect((await run("tele2", "select id from leads where id = $1", [l])).rowCount).toBe(0);
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
