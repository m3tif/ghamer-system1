import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
import { mapError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** Confirms the distribution: one database transaction (all or nothing), serialised on the batch row so a double click cannot import twice. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return Response.json({ error: "انتهت الجلسة" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { employees?: string[] };
  const emps = Array.isArray(body.employees) ? body.employees : [];
  if (!UUID.test(id) || emps.length === 0 || emps.length > 100 || !emps.every((e) => typeof e === "string" && UUID.test(e))) return Response.json({ error: "اختر موظفًا واحدًا على الأقل" }, { status: 400 });
  try {
    const r = (await tx(s.userId, (c) => c.query("select app.dist_confirm($1,$2::uuid[]) r", [id, emps]))).rows[0].r;
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: mapError(e) }, { status: 400 }); }
}
