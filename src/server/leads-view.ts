import { can } from "@/lib/auth";
import type { Session } from "@/lib/auth";
import { LEAD_STATUS } from "@/lib/labels";

export type LeadQuery = { q?: string; status?: string; month?: string; creator?: string; sales?: string; temp?: string; sort?: string; dir?: string; hidden?: string; tab?: string };
const UUID = /^[0-9a-f-]{36}$/;
export const LEAD_SORTS = ["name", "created", "status", "temperature", "followup", "manual"];

/** One place that decides what the leads list filters mean for this user (used by the page and by the "load more" action). */
export function normalizeLeadQuery(s: Session, sp: LeadQuery, hasManualOrder: boolean) {
  const employee = ["tele_sales", "sales_rep"].includes(s.role);
  const wide = !employee && can(s, "employees.view");
  const canHide = ["super_admin", "general_manager", "tele_sales_manager", "sales_manager"].includes(s.role);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : undefined;
  const sort = LEAD_SORTS.includes(sp.sort ?? "") ? sp.sort! : hasManualOrder ? "manual" : "created";
  return {
    employee, wide, canHide, month,
    q: sp.q?.slice(0, 200) || undefined,
    status: sp.status && LEAD_STATUS[sp.status] ? sp.status : undefined,
    creator: wide && UUID.test(sp.creator ?? "") ? sp.creator : undefined,
    sales: wide && UUID.test(sp.sales ?? "") ? sp.sales : undefined,
    temp: ["cold", "warm", "hot"].includes(sp.temp ?? "") ? sp.temp : undefined,
    sort, dir: sp.dir === "asc" ? "asc" : "desc",
    // Tele Sales keep what they added themselves apart from the data that was distributed to them
    // ... but a search always looks through everything she is allowed to see (added, received, handed over), not only the open tab
    scope: s.role === "tele_sales" && !sp.q?.trim() ? (sp.tab === "received" ? "received" : sp.tab === "handed" ? undefined : "added") : undefined,
    hidden: canHide && ["hidden", "all"].includes(sp.hidden ?? "") ? sp.hidden : undefined,
  };
}
