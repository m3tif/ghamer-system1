import { tx } from "@/lib/db";
import { normalizePhone } from "@/lib/normalize";

const esc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
export const PAGE_SIZE = 20;

export async function listLeads(uid: string, o: { q?: string; status?: string; page?: number }) {
  const page = Math.max(1, o.page ?? 1);
  const q = o.q?.trim() || null;
  const phone = q ? (normalizePhone(q) ?? q.replace(/\D/g, "")) : null;
  const r = await tx(uid, (c) => c.query(
    `select l.id, c.name, c.business_name, l.lead_status, l.next_followup_at, l.created_at, l.last_contact_at,
            app.emp_name(l.original_creator_id) creator, app.emp_name(l.current_owner_id) owner, app.emp_name(l.assigned_sales_id) sales,
            (select cc.phone from client_contacts cc where cc.client_id = c.id and cc.phone is not null order by cc.is_primary desc, cc.created_at limit 1) phone,
            count(*) over()::int total
     from leads l join clients c on c.id = l.client_id
     where ($1::text is null or c.name ilike $1 or c.business_name ilike $1
            or ($2::text is not null and length($2) >= 4 and exists (select 1 from client_contacts cc where cc.client_id = c.id and cc.phone like $2)))
       and ($3::text is null or l.lead_status = $3)
     order by l.created_at desc limit ${PAGE_SIZE} offset $4`,
    [q ? `%${esc(q)}%` : null, phone ? `%${esc(phone)}%` : null, o.status || null, (page - 1) * PAGE_SIZE]));
  return { rows: r.rows, total: r.rows[0]?.total ?? 0, page };
}

export async function getLead(uid: string, id: string) {
  return tx(uid, async (c) => {
    const lead = (await c.query(
      `select l.*, c.name, c.business_name, c.industry, c.country, c.city, c.contact_person, c.original_source, c.status client_status,
              c.is_legacy, app.emp_name(l.original_creator_id) creator, app.emp_name(l.current_owner_id) owner, app.emp_name(l.assigned_sales_id) sales
       from leads l join clients c on c.id = l.client_id where l.id = $1`, [id])).rows[0];
    if (!lead) return null;
    const contacts = await c.query("select * from client_contacts where client_id = $1 order by is_primary desc, created_at", [lead.client_id]);
    const stores = await c.query("select * from client_stores where client_id = $1 order by created_at", [lead.client_id]);
    const acts = await c.query("select a.*, app.emp_name(a.created_by) by_name from lead_activities a where lead_id = $1 order by created_at desc", [id]);
    const assigns = await c.query(`select a.*, app.emp_name(a.from_employee_id) from_name, app.emp_name(a.to_employee_id) to_name, app.emp_name(a.assigned_by) by_name
               from lead_assignments a where lead_id = $1 order by created_at desc`, [id]);
    const meetings = await c.query(`select m.*, app.emp_name(m.sales_rep_id) rep_name, app.emp_name(m.tele_sales_id) tele_name from meetings m where lead_id = $1 order by created_at desc`, [id]);
    const fups = await c.query("select f.*, app.emp_name(f.owner_id) owner_name from follow_ups f where lead_id = $1 order by due_at desc", [id]);
    const deal = await c.query("select id, stage from deals where lead_id = $1 order by created_at desc limit 1", [id]);
    return { lead, contacts: contacts.rows, stores: stores.rows, activities: acts.rows, assignments: assigns.rows,
             meetings: meetings.rows, followUps: fups.rows, deal: deal.rows[0] ?? null };
  });
}

export const salesReps = (uid: string) => tx(uid, (c) => c.query("select * from app.sales_reps()")).then((r) => r.rows as { id: string; full_name: string }[]);
export const assignable = (uid: string) => tx(uid, (c) => c.query("select * from app.assignable_employees()")).then((r) => r.rows as { id: string; full_name: string; role_code: string }[]);

export async function listMeetings(uid: string, scope: "upcoming" | "past" | "all") {
  const where = scope === "upcoming" ? "m.status in ('Scheduled','Confirmed','Rescheduled')" : scope === "past" ? "m.status in ('Completed','Cancelled','No Show')" : "true";
  const r = await tx(uid, (c) => c.query(
    `select m.*, c.name client_name, c.business_name, app.emp_name(m.sales_rep_id) rep_name, app.emp_name(m.tele_sales_id) tele_name,
            (select count(*) from meetings x where x.id = m.id)::int one
     from meetings m join leads l on l.id = m.lead_id join clients c on c.id = l.client_id
     where ${where} order by case when m.status in ('Scheduled','Confirmed','Rescheduled') then m.scheduled_at end asc nulls last, m.scheduled_at desc limit 200`));
  return r.rows;
}

export async function listDeals(uid: string) {
  const r = await tx(uid, (c) => c.query(
    `select d.id, d.stage, d.win_probability, d.expected_value, d.updated_at, c.name client_name, c.business_name,
            app.emp_name(d.owner_sales_id) owner_name, d.owner_sales_id,
            (select count(*) from follow_ups f where f.deal_id = d.id and f.status = 'open' and f.due_at < now())::int overdue
     from deals d join clients c on c.id = d.client_id where d.archived_at is null order by d.updated_at desc limit 500`));
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
  const r = await tx(uid, (c) => c.query("select * from app.my_lead_outcomes()"));
  return new Map<string, { meeting_status: string | null; deal_outcome: string | null }>(r.rows.map((x: any) => [x.lead_id, x]));
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
  const r = await tx(uid, async (c) => {
    const q = (sql: string, p: unknown[] = []) => c.query(sql, p).then((x) => x.rows[0]);
    const s = month, e = `(date '${month}' + interval '1 month')`;
    return {
      leads: (await q(`select count(*)::int n from leads where created_at >= $1 and created_at < ${e}`, [s])).n,
      meetingsDone: (await q(`select count(*)::int n from meetings where status='Completed' and completed_at >= $1 and completed_at < ${e}`, [s])).n,
      meetingsUpcoming: (await q(`select count(*)::int n from meetings where status in ('Scheduled','Confirmed','Rescheduled') and scheduled_at >= now()`)).n,
      openDeals: (await q(`select count(*)::int n from deals where stage not in ('Lost','Signed / Finance Pending','Financially Approved')`)).n,
      won: (await q(`select count(distinct deal_id)::int n from deal_stage_history where to_stage = 'Signed / Finance Pending' and at >= $1 and at < ${e}`, [s])).n,
      lost: (await q(`select count(distinct deal_id)::int n from deal_stage_history where to_stage = 'Lost' and at >= $1 and at < ${e}`, [s])).n,
      overdue: (await q(`select count(*)::int n from follow_ups where status='open' and due_at < now()`)).n,
      openReviews: (await q(`select count(*)::int n from duplicate_reviews where status='open'`)).n,
      bySource: (await c.query(`select cl.original_source src, count(*)::int n from leads l join clients cl on cl.id = l.client_id
                                where l.created_at >= $1 and l.created_at < ${e} group by 1 order by 2 desc`, [s])).rows,
    };
  });
  return r;
}
