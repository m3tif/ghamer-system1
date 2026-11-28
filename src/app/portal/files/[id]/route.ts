import { getPortalSession } from "@/lib/portal-auth";
import { portalFile } from "@/server/portal-data";

export const dynamic = "force-dynamic";

/** A project file for the signed-in client — the database decides: shown to him, or his own upload, in his own project. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getPortalSession();
  if (!s || s.mustChangePassword) return new Response("غير مصرح", { status: 401 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return new Response("غير موجود", { status: 404 });
  const f = await portalFile(s.accountId, id).catch(() => undefined);
  if (!f) return new Response("غير موجود", { status: 404 });
  const inline = f.mime_type === "application/pdf" || f.mime_type.startsWith("image/");
  return new Response(new Uint8Array(f.content), {
    headers: {
      "Content-Type": f.mime_type, "Content-Length": String(f.content.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'none'; sandbox",
    },
  });
}
