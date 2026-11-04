import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
import { mapError } from "@/lib/errors";
import { MAX_FILE_BYTES, autoMap, buildRows, detectHeaderRow, readTable, sha256 } from "@/lib/import-parse";
import { fetchSheetCsv } from "@/lib/gsheet";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const J = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });

/** Stages a sheet (Google Sheets link or an uploaded xlsx/csv). Nothing is added to the clients until the manager confirms the distribution. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return J({ error: "انتهت الجلسة" }, 401);
  if (!s.perms.has("leads.bulk_distribute")) return J({ error: "غير مصرح لك بهذه الميزة" }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 200_000) return J({ error: "حجم الملف أكبر من 4 ميجابايت" }, 413);
  let fd: FormData;
  try { fd = await req.formData(); } catch { return J({ error: "تعذّر قراءة الطلب" }, 400); }
  try {
    const link = String(fd.get("url") ?? "").trim(); const f = fd.get("file");
    let buf: Buffer, name: string, sourceUrl: string | null = null;
    if (link) { const g = await fetchSheetCsv(link); buf = g.buf; name = `Google Sheet ${g.id.slice(0, 8)} (gid ${g.gid}).csv`; sourceUrl = link; }
    else if (f instanceof File && f.size > 0) { buf = Buffer.from(await f.arrayBuffer()); name = f.name; }
    else return J({ error: "ضع رابط Google Sheets أو اختر ملفًا" }, 400);
    const read = await readTable(buf, name);
    const table = detectHeaderRow(read.table.headers, read.table.rows);
    if (table.rows.length === 0) throw new Error("لم أجد صفوف بيانات تحت صف العناوين");
    const map = autoMap(table.headers);
    if (!map.phone) throw new Error("لم أتعرف على عمود رقم الهاتف. تأكد أن الصف الأول فيه عناوين الأعمدة (مثل: رقم الهاتف)");
    const rows = buildRows(table, map, "SA");
    const header = { file_name: name, file_hash: sha256(buf), file_size: buf.length, file_kind: read.kind, source_url: sourceUrl, mapping: { ...map, headers: table.headers } };
    const id = (await tx(s.userId, (c) => c.query("select app.dist_create($1::jsonb,$2::jsonb) id", [JSON.stringify(header), JSON.stringify(rows)]))).rows[0].id as string;
    return J({ id });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/[؀-ۿ]/.test(m)) return J({ error: m }, 400);
    return J({ error: mapError(e) }, 400);
  }
}
