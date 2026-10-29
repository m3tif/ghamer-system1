import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
import { mapError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One chunk (≤200 rows) per call. The page calls it again until `done`. A second call while one runs waits on the batch row lock, so nothing is imported twice. */
export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return Response.json({ error: "انتهت الجلسة" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "معرّف غير صالح" }, { status: 400 });
  try {
    const r = (await tx(s.userId, (c) => c.query("select app.import_run($1, 200) r", [id]))).rows[0].r;
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: mapError(e) }, { status: 400 }); }
}
