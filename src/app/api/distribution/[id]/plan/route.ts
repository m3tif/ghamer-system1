import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
import { mapError } from "@/lib/errors";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

/** Live preview: how many each selected employee would receive (also re-checks duplicates against the system right now). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return Response.json({ error: "انتهت الجلسة" }, { status: 401 });
  const { id } = await ctx.params; const emps = (new URL(req.url).searchParams.get("emps") ?? "").split(",").filter(Boolean);
  if (!UUID.test(id) || emps.length > 100 || !emps.every((e) => UUID.test(e))) return Response.json({ error: "طلب غير صالح" }, { status: 400 });
  try {
    const out = await tx(s.userId, async (c) => {
      const plan = (await c.query("select * from app.dist_plan($1,$2::uuid[])", [id, emps])).rows;
      const b = (await c.query("select c_new, c_duplicate, c_invalid, c_review, rows_total from app.dist_get($1)", [id])).rows[0];
      return { plan, b };
    });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: mapError(e) }, { status: 400 }); }
}
