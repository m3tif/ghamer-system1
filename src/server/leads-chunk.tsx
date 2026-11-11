"use server";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { listLeads, salesReps } from "@/server/data";
import { LeadRows } from "@/components/leads-table";
import { normalizeLeadQuery, type LeadQuery } from "@/server/leads-view";

const CHUNK = 40;

/** Next batch of rows for the continuous leads list. Same filters + same permission checks as the page (the database enforces who can see what). */
export async function loadLeadsChunk(query: LeadQuery, offset: number) {
  const s = await requireSession(); await requirePerm(s, "leads.view");
  const off = Number.isInteger(offset) && offset >= 0 && offset < 100000 ? offset : 0;
  const f = normalizeLeadQuery(s, query ?? {}, true);
  const [list, reps] = await Promise.all([
    listLeads(s.userId, { q: f.q, status: f.status, month: f.month, creator: f.creator, sales: f.sales, temp: f.temp, sort: f.sort, dir: f.dir, hidden: f.hidden, scope: f.scope, size: CHUNK, offset: off }),
    can(s, "leads.handoff") ? salesReps(s.userId) : [],
  ]);
  const q = { q: f.q, status: f.status, month: query?.month, creator: f.creator, sales: f.sales, temp: f.temp, sort: query?.sort, dir: query?.dir, hidden: f.hidden, tab: query?.tab };
  return {
    count: list.rows.length, total: list.total,
    node: <LeadRows rows={list.rows} startIndex={off} q={q} canEdit={can(s, "leads.edit")} canSend={can(s, "leads.handoff")} reps={reps} wide={f.wide} canHide={f.canHide} canDelete={s.role === "super_admin"} me={s.userId} />,
  };
}
