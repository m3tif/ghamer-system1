import { MAX_FILE_BYTES } from "@/lib/import-parse";

/** Accepts a normal Google Sheets link and returns the sheet id + tab (gid). Only docs.google.com/spreadsheets links are accepted. */
export function parseSheetUrl(raw: string): { id: string; gid: string } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  const m = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/);
  if (!m) return null;
  const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  return { id: m[1], gid: /^\d{1,12}$/.test(gid) ? gid : "0" };
}

/**
 * Downloads one tab of a link-shared Google Sheet as CSV. No Google account / password is ever requested: the sheet must be shared as
 * "Anyone with the link can view" (otherwise Google returns a sign-in page and we say so). The URL is built by us from the sheet id only.
 */
export async function fetchSheetCsv(raw: string, fetcher: typeof fetch = fetch): Promise<{ buf: Buffer; id: string; gid: string }> {
  const p = parseSheetUrl(raw);
  if (!p) throw new Error("الرابط ليس رابط Google Sheets صحيحًا (يجب أن يبدأ بـ https://docs.google.com/spreadsheets/d/…)");
  const url = `https://docs.google.com/spreadsheets/d/${p.id}/export?format=csv&gid=${p.gid}`;
  let res: Response;
  try { res = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { Accept: "text/csv" } }); }
  catch { throw new Error("تعذّر الوصول إلى Google Sheets. تأكد من الرابط والاتصال، أو ارفع الملف مباشرة"); }
  const host = new URL(res.url || url).hostname;
  if (!(host === "docs.google.com" || host.endsWith(".google.com") || host.endsWith(".googleusercontent.com"))) throw new Error("استجابة غير متوقعة من الرابط");
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403 || res.status === 404 || /text\/html/i.test(type) || /accounts\.google\.com/.test(res.url)) {
    throw new Error("الجدول غير متاح للقراءة. افتحه في Google Sheets ← مشاركة ← «أي شخص لديه الرابط» بصلاحية «مُشاهد»، ثم أعد المحاولة. أو نزّله كملف CSV/Excel وارفعه هنا (لا تشارك بيانات حسابك أبدًا)");
  }
  if (!res.ok) throw new Error(`تعذّر تنزيل الجدول (رمز ${res.status})`);
  const reader = res.body?.getReader(); if (!reader) throw new Error("استجابة فارغة");
  const chunks: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX_FILE_BYTES) { await reader.cancel(); throw new Error("الجدول أكبر من 4 ميجابايت. قسّمه إلى جدولين"); } chunks.push(value); }
  return { buf: Buffer.concat(chunks), id: p.id, gid: p.gid };
}
