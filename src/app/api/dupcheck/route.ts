import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
import { normalizeStoreUrl, parsePhoneAny } from "@/lib/normalize";
export const dynamic = "force-dynamic";

/** Live duplicate check while typing. Uses the same normalisation as saving; read-only; the database decides what the caller may see. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const u = new URL(req.url);
  const phone = parsePhoneAny(u.searchParams.get("phone") ?? "").value;
  const store = normalizeStoreUrl(u.searchParams.get("store") ?? "")?.key ?? null;
  if (!phone && !store) return Response.json({ ok: true, result: {} }, { headers: { "Cache-Control": "no-store" } });
  try {
    const r = (await tx(s.userId, (c) => c.query("select app.check_duplicate($1,$2) r", [phone, store]))).rows[0].r;
    return Response.json({ ok: true, result: r }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
