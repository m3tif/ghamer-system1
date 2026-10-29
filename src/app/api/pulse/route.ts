import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
export const dynamic = "force-dynamic";

/** Cheap "did anything I can see change?" check used by the auto-refresh. One small query, permission-filtered by the database. */
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const p = (await tx(s.userId, (c) => c.query("select app.pulse() p"))).rows[0].p as Record<string, unknown>;
    const { now, ...rest } = p;
    return Response.json({ ok: true, rev: JSON.stringify(rest), at: now }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
