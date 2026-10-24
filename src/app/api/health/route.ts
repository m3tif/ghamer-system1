import { tx } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await tx(null, (c) => c.query("select 1")); return Response.json({ ok: true, role: "restricted" }); }
  catch (e) {
    const unsafe = e instanceof Error && e.message.includes("UNSAFE_DB_ROLE");
    return Response.json({ ok: false, error: unsafe ? "unsafe_db_role: DATABASE_URL must use the ghamer_app user" : "database_unreachable" }, { status: 503 });
  }
}
