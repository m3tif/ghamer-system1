import { getSession } from "@/lib/auth";
import { attachmentGet } from "@/server/data";

export const dynamic = "force-dynamic";

/** Download an uploaded file (signed contract, document). The database decides who may read it — the same rule as the contract itself. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || ((s.mfaRequired || s.mfaEnabled) && !s.mfaVerified) || s.mustChangePassword) return new Response("غير مصرح", { status: 401 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return new Response("غير موجود", { status: 404 });
  const f = await attachmentGet(s.userId, id).catch(() => undefined);
  if (!f) return new Response("غير موجود", { status: 404 });
  const inline = f.mime_type === "application/pdf" || f.mime_type.startsWith("image/");
  return new Response(new Uint8Array(f.content), {
    headers: {
      "Content-Type": f.mime_type,
      "Content-Length": String(f.content.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'none'; sandbox",
    },
  });
}
