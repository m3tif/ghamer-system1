import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
import { mapError } from "@/lib/errors";
import { MAX_FILE_BYTES, autoMap, buildRows, readTable, sha256 } from "@/lib/import-parse";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const J = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return J({ error: "انتهت الجلسة" }, 401);
  if (!s.perms.has("import.own") && !s.perms.has("import.any")) return J({ error: "غير مصرح لك بالاستيراد" }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 200_000) return J({ error: "حجم الملف أكبر من 4 ميجابايت. قسّمه إلى ملفين" }, 413);
  let fd: FormData;
  try { fd = await req.formData(); } catch { return J({ error: "تعذّر قراءة الطلب" }, 400); }
  const f = fd.get("file");
  if (!(f instanceof File)) return J({ error: "اختر ملفًا" }, 400);
  const owner = s.perms.has("import.any") ? String(fd.get("data_owner_id") || s.userId) : s.userId;
  if (!/^[0-9a-f-]{36}$/i.test(owner)) return J({ error: "اختر صاحب البيانات" }, 400);
  try {
    const buf = Buffer.from(await f.arrayBuffer());
    const { kind, table } = await readTable(buf, f.name);
    const country = "SA";
    const map = autoMap(table.headers);
    const rows = buildRows(table, map, country);
    const header = {
      file_name: f.name, file_hash: sha256(buf), file_size: buf.length, file_kind: kind, data_owner_id: owner,
      original_employee_name: String(fd.get("original_employee_name") ?? ""), default_country: country,
      mapping: { ...map, headers: table.headers, default_country: country },
    };
    const id = (await tx(s.userId, (c) => c.query("select app.import_create($1::jsonb,$2::jsonb) id", [JSON.stringify(header), JSON.stringify(rows)]))).rows[0].id as string;
    return J({ id });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/[؀-ۿ]/.test(m)) return J({ error: m }, 400);          // our own Arabic validation messages
    return J({ error: mapError(e) }, 400);
  }
}
