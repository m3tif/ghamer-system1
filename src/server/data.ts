import { tx } from "@/lib/db";
import { toLatinDigits } from "@/lib/normalize";

const esc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
export const PAGE_SIZE = 20;

export const PAGE_SIZES = [25, 50, 100];
export type LeadFilter = { q?: string; status?: string; page?: number; size?: number; offset?: number; month?: string; creator?: string; sales?: string; temp?: string; sort?: string; dir?: string; hidden?: string };
export type LeadRow = {
  id: string; client_id: string; name: string; business_name: string | null; phone: string | null; store_url: string | null;
  lead_status: string; lead_temperature: string | null; call_notes: string | null; next_followup_at: string | null; created_at: string;
  last_contact_at: string | null; original_creator_id: string; creator_name: string | null; assigned_sales_id: string | null; sales_name: string | null;
  handed_off: boolean; dup_attempts: number; total: number; hidden_at: string | null; hidden_by_name: string | null; hidden_reason: string | null;
  pos: number | null; colors: Record<string, string>;
};
export async function listLeads(uid: string, o: LeadFilter) {
  const size = PAGE_SIZES.includes(o.size ?? 0) ? o.size! : PAGE_SIZES[0];
  const page = Math.max(1, o.page ?? 1);
  const offset = o.offset ?? (page - 1) * size;
  const q = o.q?.trim() || null;
  // a query is treated as a phone number only when it is made of digits/separators (not when a name contains digits)
  const asDigits = q ? toLatinDigits(q) : "";
  const phone = q && /^[+\d\s().-]{3,}$/.test(asDigits) && asDigits.replace(/\D/g, "").length >= 3 ? asDigits.replace(/\D/g, "") : null;
  const r = await tx(uid, (c) => c.query(
    "select * from app.list_leads($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [phone ? null : q, phone, o.status || null, o.month || null, o.creator || null, o.sales || null, o.temp || null, o.sort || null, o.dir || null, size, offset, o.hidden || null]));
  const rows = r.rows as LeadRow[];
  return { rows, total: rows[0]?.total ?? 0, page, size };
}

/** How many leads a person added (all time / this month / handed to Sales / accepted / rejected). Counts the real records, not what is visible. */
export async function addedCounts(uid: string, emp?: string | null) {
  return (await tx(uid, (c) => c.query("select * from app.added_counts($1)", [emp ?? null]))).rows[0] as
    { total: number; this_month: number; handed_off: number; accepted: number; rejected: number };
}

export async function getLead(uid: string, id: string) {
  return tx(uid, async (c) => {
    const r = (await c.query(
      `select l.*, c.name, c.business_name, c.industry, c.country, c.city, c.contact_person, c.original_source, c.status client_status, c.is_legacy,
              app.emp_name(l.original_creator_id) creator, app.emp_name(l.current_owner_id) owner, app.emp_name(l.assigned_sales_id) sales,
        (select coalesce(json_agg(x), '[]') from (select * from client_contacts where client_id = l.client_id order by is_primary desc, created_at) x) contacts,
        (select coalesce(json_agg(x), '[]') from (select * from client_stores where client_id = l.client_id order by created_at) x) stores,
        (select coalesce(json_agg(x), '[]') from (select a.*, app.emp_name(a.created_by) by_name from lead_activities a where lead_id = l.id order by created_at desc limit 200) x) activities,
        (select coalesce(json_agg(x), '[]') from (select a.*, app.emp_name(a.from_employee_id) from_name, app.emp_name(a.to_employee_id) to_name, app.emp_name(a.assigned_by) by_name
            from lead_assignments a where lead_id = l.id order by created_at desc) x) assignments,
        (select coalesce(json_agg(x), '[]') from (select ${MCOLS}, app.meeting_link(m.id) meeting_url, app.emp_name(m.sales_rep_id) rep_name, app.emp_name(m.tele_sales_id) tele_name from meetings m where lead_id = l.id order by created_at desc) x) meetings,
        (select coalesce(json_agg(x), '[]') from (select f.*, app.emp_name(f.owner_id) owner_name from follow_ups f where lead_id = l.id order by due_at desc) x) follow_ups,
        (select row_to_json(x) from (select id, stage from deals where lead_id = l.id order by created_at desc limit 1) x) deal,
        (select row_to_json(x) from (select h.id, h.status, h.note, h.handed_at, h.assigned_at, h.decided_at, h.reject_reason, h.reject_note, app.emp_name(h.from_employee_id) from_name, app.emp_name(h.to_employee_id) to_name, app.emp_name(h.decided_by) decided_by_name, h.to_employee_id
            from lead_handoffs h where h.lead_id = l.id order by h.handed_at desc limit 1) x) handoff
       from leads l join clients c on c.id = l.client_id where l.id = $1`, [id])).rows[0];
    if (!r) return null;
    const { contacts, stores, activities, assignments, meetings, follow_ups, deal, handoff, ...lead } = r;
    return { lead, contacts, stores, activities, assignments, meetings, followUps: follow_ups, deal: deal ?? null, handoff: handoff ?? null };
  });
}

export const salesReps = (uid: string) => tx(uid, (c) => c.query("select * from app.sales_reps()")).then((r) => r.rows as { id: string; full_name: string }[]);
export const assignable = (uid: string) => tx(uid, (c) => c.query("select * from app.assignable_employees()")).then((r) => r.rows as { id: string; full_name: string; role_code: string }[]);

export const MCOLS = `m.id, m.lead_id, m.tele_sales_id, m.sales_rep_id, m.scheduled_at, m.booking_notes, m.status, m.reschedule_count, m.confirmed_at,
  m.completed_at, m.created_at, m.updated_at, m.title, m.meeting_type, m.outcome, m.result_notes, m.next_step, m.next_step_at, m.outcome_at`;
export type MeetingTab = "upcoming" | "awaiting" | "done" | "cancelled";
const ACTIVE = "m.status in ('Scheduled','Confirmed','Rescheduled')";
/** upcoming = active AND still in the future. awaiting = active but its time has passed (needs a result). */
const TAB_SQL: Record<MeetingTab, string> = {
  upcoming: `${ACTIVE} and m.scheduled_at >= now()`,
  awaiting: `${ACTIVE} and m.scheduled_at < now()`,
  done: "m.status in ('Completed','No Show')",
  cancelled: "m.status = 'Cancelled'",
};
export async function listMeetings(uid: string, tab: MeetingTab, limit = 200) {
  return (await tx(uid, (c) => c.query("select * from app.list_meetings($1,$2)", [tab, limit]))).rows;
}
export async function meetingCounts(uid: string) {
  return (await tx(uid, (c) => c.query("select * from app.meeting_counts()"))).rows[0] as Record<MeetingTab, number>;
}
export async function meetingEvents(uid: string, meetingId: string) {
  return (await tx(uid, (c) => c.query("select e.*, app.emp_name(e.by_employee) by_name from meeting_events e where meeting_id = $1 order by at desc", [meetingId]))).rows as any[];
}

/** Leads assigned to this Sales person: waiting for his decision, accepted, rejected (history). */
export async function assignedLeads(uid: string, tab: "pending" | "accepted" | "rejected") {
  return tx(uid, async (c) => {
    if (tab === "pending") {
      return (await c.query(
        `select h.id handoff_id, l.id lead_id, c.id client_id, c.name, c.business_name, l.lead_temperature, l.required_services, l.call_notes, l.lead_status, h.note, h.handed_at,
                app.emp_name(h.from_employee_id) from_name, c.original_source,
                (select cc.phone from client_contacts cc where cc.client_id = c.id and cc.phone is not null order by cc.is_primary desc limit 1) phone
         from lead_handoffs h join leads l on l.id = h.lead_id join clients c on c.id = l.client_id
         where h.to_employee_id = $1 and h.status = 'pending_review' order by h.handed_at`, [uid])).rows as any[];
    }
    if (tab === "accepted") {
      return (await c.query(
        `select l.id lead_id, c.id client_id, c.name, c.business_name, l.lead_temperature, l.lead_status, l.next_followup_at,
                (select h.decided_at from lead_handoffs h where h.lead_id = l.id and h.status = 'accepted' order by h.decided_at desc limit 1) decided_at,
                app.emp_name(l.original_creator_id) from_name,
                (select cc.phone from client_contacts cc where cc.client_id = c.id and cc.phone is not null order by cc.is_primary desc limit 1) phone
         from leads l join clients c on c.id = l.client_id
         where l.assigned_sales_id = $1 and l.lead_status <> 'Pending Sales Review' order by l.updated_at desc limit 300`, [uid])).rows as any[];
    }
    return (await c.query("select * from app.my_handoff_decisions() where status = 'rejected'")).rows as any[];
  });
}

/** Keeps only the rows whose client matches the search text (name / store / phone in any format). Runs after the permission-filtered query. */
export async function filterByClientSearch<T extends { client_id?: string; lead_id?: string }>(uid: string, rows: T[], q?: string | null): Promise<T[]> {
  const text = q?.trim(); if (!text || rows.length === 0) return rows;
  const byClient = rows.some((r) => r.client_id);
  const ids = rows.map((r) => (byClient ? r.client_id : r.lead_id)).filter(Boolean) as string[];
  const sql = byClient ? "select id from unnest($1::uuid[]) id where app.client_matches(id, $2)"
                       : "select lid id from unnest($1::uuid[]) lid join leads l on l.id = lid where app.client_matches(l.client_id, $2)";
  const ok = new Set((await tx(uid, (c) => c.query(sql, [ids, text]))).rows.map((r: any) => r.id));
  return rows.filter((r) => ok.has((byClient ? r.client_id : r.lead_id) as string));
}

export async function listDeals(uid: string) {
  const r = await tx(uid, (c) => c.query(
    `select d.id, d.client_id, d.stage, d.win_probability, d.expected_value, d.updated_at, d.created_at, d.lead_id, c.name client_name, c.business_name,
            app.emp_name(d.owner_sales_id) owner_name, d.owner_sales_id, l.lead_temperature,
            (select cc.phone from client_contacts cc where cc.client_id = c.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1) phone,
            (select min(f.due_at) from follow_ups f where f.deal_id = d.id and f.status = 'open') followup_at,
            (select count(*) from follow_ups f where f.deal_id = d.id and f.status = 'open' and f.due_at < now())::int overdue
     from deals d join clients c on c.id = d.client_id join leads l on l.id = d.lead_id where d.archived_at is null order by d.updated_at desc limit 500`));
  return r.rows;
}

export async function getDeal(uid: string, id: string) {
  return tx(uid, async (c) => {
    const deal = (await c.query(
      `select d.*, c.name client_name, c.business_name, app.emp_name(d.owner_sales_id) owner_name, l.id lead_id_ref
       from deals d join clients c on c.id = d.client_id join leads l on l.id = d.lead_id where d.id = $1`, [id])).rows[0];
    if (!deal) return null;
    const brief = await c.query("select * from deal_briefs where deal_id = $1", [id]);
    const hist = await c.query("select h.*, app.emp_name(h.by_employee) by_name from deal_stage_history h where deal_id = $1 order by at desc", [id]);
    const fups = await c.query("select * from follow_ups where deal_id = $1 order by due_at desc", [id]);
    return { deal, brief: brief.rows[0] ?? {}, history: hist.rows, followUps: fups.rows };
  });
}

export async function listFollowUps(uid: string, status: "open" | "done" = "open") {
  const r = await tx(uid, (c) => c.query(
    `select f.*, c.name client_name, l.id lead_id, app.emp_name(f.owner_id) owner_name, (f.due_at < now() and f.status = 'open') overdue
     from follow_ups f join leads l on l.id = f.lead_id join clients c on c.id = l.client_id
     where f.status = $1 order by f.due_at ${status === "open" ? "asc" : "desc"} limit 300`, [status]));
  return r.rows;
}

export async function listNotifications(uid: string) {
  const r = await tx(uid, (c) => c.query("select * from notifications order by created_at desc limit 100"));
  return r.rows;
}
export async function unreadCount(uid: string) {
  const r = await tx(uid, (c) => c.query("select count(*)::int n from notifications where read_at is null"));
  return r.rows[0].n as number;
}

export async function employeeList(uid: string) {
  const r = await tx(uid, (c) => c.query("select * from app.employee_list()"));
  return r.rows as any[];
}

export async function teleStats(uid: string, emp: string, month: string) {
  return (await tx(uid, (c) => c.query("select * from app.tele_stats($1,$2)", [emp, month]))).rows[0];
}
export async function salesStats(uid: string, emp: string, month: string) {
  return (await tx(uid, (c) => c.query("select * from app.sales_stats($1,$2)", [emp, month]))).rows[0];
}
export async function myOutcomes(uid: string) {
  return (await tx(uid, (c) => c.query("select * from app.my_lead_outcomes()"))).rows as any[];
}
export async function myProgress(uid: string, emp: string, month: string) {
  return (await tx(uid, (c) => c.query("select * from app.my_progress($1,$2)", [emp, month]))).rows[0] as
    { month_count: number; goal: string | null; handed_off: number; received: number; meetings_completed: number; achievements: { code: string; at: string }[] };
}
export async function archiveMonths(uid: string, emp: string | null) {
  return (await tx(uid, (c) => c.query("select * from app.archive_months($1)", [emp]))).rows as any[];
}
export async function archiveLeads(uid: string, o: { emp?: string | null; month?: string | null; status?: string | null; page?: number; q?: string | null }) {
  const page = Math.max(1, o.page ?? 1);
  const r = await tx(uid, (c) => c.query("select * from app.archive_leads($1,$2,$3,$4,$5,$6)", [o.emp ?? null, o.month ?? null, o.status ?? null, PAGE_SIZE, (page - 1) * PAGE_SIZE, o.q?.trim() || null]));
  return { rows: r.rows as any[], total: Number(r.rows[0]?.total ?? 0), page };
}
export async function pendingHandoffs(uid: string) {
  return (await tx(uid, (c) => c.query("select * from app.pending_handoffs()"))).rows as any[];
}
export async function incomingHandoffs(uid: string) {
  const r = await tx(uid, (c) => c.query(
    `select h.id, h.lead_id, h.handed_at, h.note, cl.name client_name, app.emp_name(h.from_employee_id) from_name
     from lead_handoffs h join leads l on l.id = h.lead_id join clients cl on cl.id = l.client_id
     where h.to_employee_id = $1 and h.status = 'assigned' order by h.handed_at`, [uid]));
  return r.rows as any[];
}

export async function listTargets(uid: string, month: string) {
  const r = await tx(uid, (c) => c.query(
    "select t.*, app.emp_name(t.employee_id) emp_name from targets t where period_month = $1 order by emp_name", [month]));
  return r.rows;
}

export async function duplicateReviews(uid: string) {
  return (await tx(uid, (c) => c.query("select * from app.duplicate_review_list()"))).rows as any[];
}

export async function auditList(uid: string, o: { entity?: string; actor?: string; page?: number }) {
  const page = Math.max(1, o.page ?? 1);
  const r = await tx(uid, (c) => c.query(
    `select a.*, app.emp_name(a.actor_id) actor_name, count(*) over()::int total from audit_logs a
     where ($1::text is null or a.entity_type = $1) and ($2::text is null or app.emp_name(a.actor_id) ilike $2)
     order by a.id desc limit ${PAGE_SIZE} offset $3`,
    [o.entity || null, o.actor ? `%${esc(o.actor)}%` : null, (page - 1) * PAGE_SIZE]));
  return { rows: r.rows, total: r.rows[0]?.total ?? 0, page };
}

export async function companyOverview(uid: string, month: string) {
  return tx(uid, async (c) => {
    const q = (sql: string, p: unknown[] = []) => c.query(sql, p).then((x) => x.rows);
    const win = `(date '${month}')`, end = `(date '${month}' + interval '1 month')`;
    const one = async (sql: string) => (await q(sql))[0].n as number;
    return {
      totalLeads: await one(`select count(*)::int n from leads`),
      leads: await one(`select count(*)::int n from leads where created_month = ${win}`),
      handoffs: await one(`select count(*)::int n from lead_handoffs where handed_at >= ${win} and handed_at < ${end}`),
      pendingDistribution: await one(`select count(*)::int n from lead_handoffs where status = 'pending_distribution'`),
      meetingsDone: await one(`select count(*)::int n from meetings where status='Completed' and completed_at >= ${win} and completed_at < ${end}`),
      meetingsUpcoming: await one(`select count(*)::int n from meetings where status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at >= now()`),
      meetingsMonth: await one(`select count(*)::int n from meetings where created_at >= ${win} and created_at < ${end}`),
      followUpsOpen: await one(`select count(*)::int n from follow_ups where status='open'`),
      overdue: await one(`select count(*)::int n from follow_ups where status='open' and due_at < now()`),
      openReviews: await one(`select count(*)::int n from duplicate_reviews where status='open'`),
      byStatus: await q(`select lead_status s, count(*)::int n from leads group by 1 order by 2 desc`),
      byTemperature: await q(`select coalesce(lead_temperature, 'none') t, count(*)::int n from leads group by 1 order by 2 desc`),
      handoffMonth: await q(`select status s, count(*)::int n from lead_handoffs where handed_at >= ${win} and handed_at < ${end} group by 1`),
      rejectedWaiting: await one(`select count(*)::int n from leads where lead_status = 'Rejected by Sales'`),
      bySource: await q(`select cl.original_source src, count(*)::int n from leads l join clients cl on cl.id = l.client_id where l.created_month = ${win} group by 1 order by 2 desc`),
      perEmployee: await q(`select e.id, e.full_name, e.role_name_ar role,
          (select count(*)::int from leads l where l.original_creator_id = e.id and l.created_month = ${win}) added,
          (select count(*)::int from leads l where l.current_owner_id = e.id and l.lead_status not in ('Not Interested','Invalid Contact')) active_owned,
          (select t.target_value from targets t where t.employee_id = e.id and t.period_month = ${win} and t.metric = 'new_leads') goal
        from app.employee_list() e where e.is_active and e.role_code in ('tele_sales','sales_rep','tele_sales_manager','sales_manager') order by e.role_code, e.full_name`),
    };
  });
}

export async function employeeLinks(uid: string) {
  const r = await tx(uid, (c) => c.query("select * from app.employee_link_counts()"));
  return new Map<string, any>(r.rows.map((x: any) => [x.id, x]));
}
export async function employeeNameHistory(uid: string, id: string) {
  return (await tx(uid, (c) => c.query("select * from app.employee_name_history($1)", [id]))).rows as { at: string; actor_name: string | null; old_name: string; new_name: string }[];
}

export type DailyRow = { emp_id: string; emp_name: string; family: "tele" | "sales"; added: number; contacted: number; handed: number; accepted: number; rejected: number; received: number; meetings_booked: number };
export async function dailyReport(uid: string, day?: string | null) {
  return (await tx(uid, (c) => c.query("select * from app.daily_report($1)", [day || null]))).rows as DailyRow[];
}
export async function hideOverview(uid: string, scope: "day" | "month", year: number, month: number, emp?: string | null) {
  return (await tx(uid, (c) => c.query("select to_char(period,'YYYY-MM-DD') period, total, hidden, rule_active from app.hide_overview($1,$2,$3,$4)", [scope, year, month, emp || null]))).rows as { period: string; total: number; hidden: number; rule_active: boolean }[];
}
export async function hideLog(uid: string) {
  return (await tx(uid, (c) => c.query("select * from app.hide_log(100)"))).rows as any[];
}

export async function importBatches(uid: string) { return (await tx(uid, (c) => c.query("select * from app.import_batches_list(50)"))).rows as any[]; }
export async function importBatch(uid: string, id: string) { return (await tx(uid, (c) => c.query("select * from app.import_get($1)", [id]))).rows[0] as any | undefined; }
export async function importRows(uid: string, id: string, status: string | null, page: number, size = 50) {
  const r = await tx(uid, (c) => c.query("select * from app.import_rows_page($1,$2,$3,$4)", [id, status, size, (page - 1) * size]));
  return { rows: r.rows as any[], total: Number(r.rows[0]?.total ?? 0) };
}

// ───── bulk distribution ─────
export async function distCandidates(uid: string) { return (await tx(uid, (c) => c.query("select * from app.dist_candidates()"))).rows as { id: string; full_name: string; open_leads: number }[]; }
export async function distList(uid: string) { return (await tx(uid, (c) => c.query("select * from app.dist_list(100)"))).rows as any[]; }
export async function distGet(uid: string, id: string) { return (await tx(uid, (c) => c.query("select * from app.dist_get($1)", [id]))).rows[0] as any | undefined; }
export async function distBreakdown(uid: string, id: string) { return (await tx(uid, (c) => c.query("select * from app.dist_breakdown($1)", [id]))).rows as any[]; }
export async function distRows(uid: string, id: string, status: string | null, page: number, size = 50) {
  const r = await tx(uid, (c) => c.query("select * from app.dist_rows_page($1,$2,$3,$4)", [id, status, size, (page - 1) * size]));
  return { rows: r.rows as any[], total: Number(r.rows[0]?.total ?? 0) };
}

/** Has this user ever arranged the leads by hand? (then "my order" becomes their default view) */
export async function hasManualOrder(uid: string): Promise<boolean> {
  return tx(uid, async (c) => (await c.query("select app.has_manual_order() as v")).rows[0]?.v === true);
}
