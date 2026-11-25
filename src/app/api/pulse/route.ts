import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
export const dynamic = "force-dynamic";

/** Cheap "did anything I can see change?" check used by the auto-refresh. One small query, permission-filtered by the database. */
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const [p, notice, open] = await tx(s.userId, async (c) => [
      (await c.query("select app.pulse() p")).rows[0].p as Record<string, unknown>,
      (await c.query("select id, title, body, sender, broadcast_id, allow_reply from app.my_pending_notice()")).rows[0] ?? null,
      (await c.query("select app.my_open_notices() ids")).rows[0].ids as string[]]);
    const { now, ...rest } = p;
    // a new pop-up message travels with the pulse, so it shows up without reloading the page
    return Response.json({ ok: true, rev: JSON.stringify(rest), at: now, notice, open }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
