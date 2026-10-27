import type { Session } from "@/lib/auth";

export type MeetingFlags = { canEdit: boolean; canCancel: boolean; canConfirm: boolean; canResult: boolean; canNoShow: boolean; canReassign: boolean };
/** UI hints only — the database functions re-check every rule (owner, time, status). */
export function meetingFlags(m: { status: string; sales_rep_id: string; scheduled_at: string }, s: Session, managed: Set<string>): MeetingFlags {
  const none = { canEdit: false, canCancel: false, canConfirm: false, canResult: false, canNoShow: false, canReassign: false };
  const active = ["Scheduled", "Confirmed", "Rescheduled"].includes(m.status);
  const actor = s.perms.has("meetings.manage") && (m.sales_rep_id === s.userId || s.role === "super_admin" || (s.role === "sales_manager" && managed.has(m.sales_rep_id)));
  if (!active || !actor) return none;
  const t = new Date(m.scheduled_at).getTime();
  const future = t > Date.now();
  const arrived = t <= Date.now() + 30 * 60000;
  return { canEdit: future, canCancel: true, canConfirm: future && m.status !== "Confirmed", canResult: arrived, canNoShow: arrived, canReassign: s.role !== "sales_rep" };
}
