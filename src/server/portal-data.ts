import { ptx } from "@/lib/db";

/** Reads for the client portal — always as the signed-in client (app.portal_id). */
const one = async (acc: string, sql: string, params: unknown[] = []) => (await ptx(acc, (c) => c.query(sql, params))).rows[0];
const all = async (acc: string, sql: string, params: unknown[] = []) => (await ptx(acc, (c) => c.query(sql, params))).rows;

export type PortalProject = { ops_id: string; title: string; progress: number; stage: string | null };
export const portalProjects = (acc: string) => all(acc, "select * from app.portal_projects()") as Promise<PortalProject[]>;
export const portalProject = async (acc: string, ops: string) => (await one(acc, "select app.portal_project_get($1) j", [ops]))?.j as any | null;
export const portalTickets = (acc: string) => all(acc, "select * from app.portal_tickets()");
export const portalTicket = async (acc: string, id: string) => (await one(acc, "select app.portal_ticket_get($1) j", [id]))?.j as any | null;
export const portalNotifications = (acc: string) => all(acc, "select * from app.portal_notifications()");
export const portalProfile = async (acc: string) => (await one(acc, "select app.portal_profile() j"))?.j as any;
export const portalFile = (acc: string, id: string) => one(acc, "select * from app.portal_file_get($1)", [id]) as Promise<{ filename: string; mime_type: string; content: Buffer } | undefined>;

/** The project the page is about: ?p= when it is one of his, otherwise his first. */
export async function pickProject(acc: string, p?: string) {
  const list = await portalProjects(acc);
  const cur = list.find((x) => x.ops_id === p) ?? list[0] ?? null;
  return { list, cur, project: cur ? await portalProject(acc, cur.ops_id) : null };
}
