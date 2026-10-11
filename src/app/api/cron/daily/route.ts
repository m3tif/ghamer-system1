import { timingSafeEqual } from "node:crypto";
import { tx } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const ok = secret.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const runKey = new Date().toISOString().slice(0, 10); // one run per day, repeated calls are skipped
  const r = await tx(null, (c) => c.query("select app.job_daily($1) r", [runKey]));
  return Response.json(r.rows[0].r);
}
