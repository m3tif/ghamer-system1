import type { Session } from "@/lib/auth";

/** UI hint only — the database function re-checks every rule. */
export function allowedMeetingActions(m: { status: string; sales_rep_id: string; tele_sales_id: string | null; scheduled_at: string }, s: Session, managed: Set<string>): string[] {
  if (!["Scheduled", "Confirmed", "Rescheduled"].includes(m.status)) return [];
  if (!s.perms.has("meetings.manage")) return [];
  const isMgr = s.role === "super_admin" || managed.has(m.sales_rep_id) || (m.tele_sales_id ? managed.has(m.tele_sales_id) : false);
  const isRep = m.sales_rep_id === s.userId;
  const out: string[] = [];
  if (m.status !== "Confirmed") out.push("confirm");
  out.push("reschedule", "cancel");
  const started = new Date(m.scheduled_at).getTime() <= Date.now() + 30 * 60000;
  if ((isRep || isMgr) && started) out.push("complete", "no_show");
  if (isRep || isMgr || m.tele_sales_id === s.userId) out.push("reassign");
  return out;
}
