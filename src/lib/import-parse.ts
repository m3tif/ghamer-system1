import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { normalizeStoreUrl, parsePhoneAny, toLatinDigits } from "@/lib/normalize";

export const MAX_FILE_BYTES = 4 * 1024 * 1024;       // Vercel request bodies are limited to ~4.5MB
export const MAX_ROWS = 20000, MAX_COLS = 40;

export type FieldKey = "hunter" | "name" | "phone" | "alt_phone" | "business_name" | "store_url" | "source" | "status" | "notes" | "added_date";
export const FIELDS: { key: FieldKey; label: string; required?: boolean; hint: string; names: string[]; distOnly?: boolean }[] = [
  { key: "hunter", label: "اسم Hunter", hint: "اختياري: من جمع العميل في الملف (يُحفظ كما هو)", distOnly: true, names: ["hunter", "hunter name", "hunt by", "hunted by", "اسم hunter", "هنتر", "الهنتر", "اسم الهنتر", "hunter (أضافه)"] },
  { key: "name", label: "اسم العميل", required: true, hint: "اسم العميل أو صاحب النشاط", names: ["name", "client", "client name", "customer", "الاسم", "اسم العميل", "العميل", "اسم"] },
  { key: "phone", label: "رقم الهاتف", required: true, hint: "محلي أو دولي (+20 / +966 / +971 …)", names: ["phone", "mobile", "tel", "telephone", "number", "cell", "الهاتف", "رقم الهاتف", "الجوال", "رقم الجوال", "رقم", "موبايل", "تليفون", "رقم التليفون"] },
  { key: "alt_phone", label: "رقم بديل", hint: "اختياري", names: ["alt phone", "alt", "phone 2", "mobile 2", "whatsapp", "رقم بديل", "واتساب", "رقم ثاني", "الرقم الاحتياطي"] },
  { key: "business_name", label: "اسم النشاط التجاري", hint: "اختياري", names: ["business", "business name", "company", "brand", "النشاط", "اسم النشاط", "اسم النشاط التجاري", "الشركة", "المتجر", "اسم المتجر"] },
  { key: "store_url", label: "رابط المتجر", hint: "اختياري، لا يمنع الإضافة", names: ["url", "store", "store url", "website", "link", "رابط", "رابط المتجر", "الموقع", "الرابط", "لينك"] },
  { key: "source", label: "المصدر", hint: "اختياري", names: ["source", "المصدر"] },
  { key: "status", label: "الحالة", hint: "اختياري: New Lead / Contacted / Interested …", names: ["status", "lead status", "الحالة", "حالة العميل"] },
  { key: "notes", label: "ملاحظات", hint: "اختياري", names: ["notes", "note", "comment", "comments", "ملاحظات", "ملاحظة", "تعليق"] },
  { key: "added_date", label: "تاريخ الإضافة الأصلي", hint: "اختياري: 2025-03-14 أو 14/03/2025. إن تُرك فارغًا لا يُخترع تاريخ", names: ["date", "added", "created", "added date", "created at", "التاريخ", "تاريخ الإضافة", "تاريخ", "تاريخ التسجيل"] },
];
export type Mapping = Partial<Record<FieldKey, string>> & { default_country?: string };
export type Table = { headers: string[]; rows: string[][] };

const norm = (s: string) => toLatinDigits(s).toLowerCase().replace(/[\s_\-.:/\\]+/g, " ").trim();
export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {}; const used = new Set<string>();
  // pass 1: exact names for every field (so «رابط المتجر» is not grabbed by «المتجر» of another field); pass 2: partial names for what is still unmapped
  for (const pass of [0, 1]) for (const f of FIELDS) {
    if (m[f.key]) continue;
    const hit = pass === 0 ? headers.find((h) => !used.has(h) && f.names.some((n) => norm(h) === norm(n)))
      : headers.find((h) => !used.has(h) && f.names.some((n) => norm(h).includes(norm(n)) && norm(n).length >= 3));
    if (hit) { m[f.key] = hit; used.add(hit); }
  }
  return m;
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "object") {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join("");
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
    if ("error" in o) return "";
    if ("hyperlink" in o) return String(o.hyperlink);
  }
  return String(v);
}

function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; if (rows.length > MAX_ROWS + 5) break; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Validates type + size + content, then reads the first sheet / the CSV into a plain table. Throws Error(arabic message). */
export async function readTable(buf: Buffer, fileName: string): Promise<{ kind: "xlsx" | "csv"; table: Table }> {
  if (buf.length === 0) throw new Error("الملف فارغ");
  if (buf.length > MAX_FILE_BYTES) throw new Error("حجم الملف أكبر من 4 ميجابايت. قسّمه إلى ملفين");
  const ext = fileName.toLowerCase().split(".").pop();
  let grid: string[][]; let kind: "xlsx" | "csv";
  if (ext === "xlsx") {
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error("الملف ليس بصيغة Excel (xlsx) صحيحة");
    kind = "xlsx";
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as any); } catch { throw new Error("تعذّرت قراءة ملف Excel. تأكد أنه غير تالف وغير محمي بكلمة مرور"); }
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("لا توجد أوراق في الملف");
    grid = [];
    const lastCol = Math.min(ws.columnCount || 0, MAX_COLS), lastRow = Math.min(ws.rowCount || 0, MAX_ROWS + 1);
    for (let r = 1; r <= lastRow; r++) { const row = ws.getRow(r); const cells: string[] = []; for (let c = 1; c <= lastCol; c++) cells.push(cellText(row.getCell(c).value).trim()); grid.push(cells); }
  } else if (ext === "csv" || ext === "txt") {
    if (buf.includes(0)) throw new Error("الملف ليس CSV نصيًا صحيحًا");
    kind = "csv";
    grid = parseCsv(new TextDecoder("utf-8").decode(buf)).map((r) => r.slice(0, MAX_COLS).map((x) => x.trim()));
  } else throw new Error("نوع الملف غير مدعوم. استخدم xlsx أو csv");
  grid = grid.filter((r) => r.some((x) => x !== ""));
  if (grid.length < 2) throw new Error("الملف لا يحتوي على بيانات (يلزم صف عناوين وصف بيانات على الأقل)");
  if (grid.length - 1 > MAX_ROWS) throw new Error(`عدد الصفوف أكبر من ${MAX_ROWS}. قسّم الملف`);
  const seen = new Map<string, number>();
  const headers = grid[0].map((h, i) => { let n = h || `عمود ${i + 1}`; const k = seen.get(n) ?? 0; seen.set(n, k + 1); return k ? `${n} (${k + 1})` : n; });
  return { kind, table: { headers, rows: grid.slice(1) } };
}

/** Excel serial / ISO / d/m/y (day first, the Arabic convention). Anything else → null: an unknown date is never invented. */
export function parseDate(raw: string): string | null {
  const s = toLatinDigits(raw ?? "").trim(); if (!s) return null;
  let y: number, m: number, d: number, x: RegExpMatchArray | null;
  if ((x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/))) { d = +x[1]; m = +x[2]; y = +x[3]; if (m > 12 && d <= 12) [d, m] = [m, d]; }
  else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 70000) { const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  else return null;
  if (y < 2000 || y > new Date().getFullYear() + 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d)); if (t.getUTCMonth() !== m - 1) return null;
  if (t.getTime() > Date.now() + 86400000) return null;          // a future "added" date is a typo, not data
  return t.toISOString().slice(0, 10);
}

/** Turns the raw table into the rows the database stages. All phone parsing happens here with the same library as the rest of the app. */
export function buildRows(table: Table, map: Mapping, defaultCountry: string) {
  const idx = (k: FieldKey) => (map[k] ? table.headers.indexOf(map[k]!) : -1);
  const I = Object.fromEntries(FIELDS.map((f) => [f.key, idx(f.key)])) as Record<FieldKey, number>;
  void defaultCountry;
  const get = (r: string[], k: FieldKey) => (I[k] >= 0 ? (r[I[k]] ?? "").trim() : "");
  return table.rows.map((r, i) => {
    const phoneRaw = get(r, "phone"), alt = get(r, "alt_phone"), store = get(r, "store_url"), dateRaw = get(r, "added_date");
    const pp = phoneRaw ? parsePhoneAny(phoneRaw) : null;
    const pa = alt ? parsePhoneAny(alt) : null;
    const sk = store ? normalizeStoreUrl(store) : null;
    const raw: Record<string, string> = {}; table.headers.forEach((h, j) => { if (r[j]) raw[h] = r[j]; });
    return {
      row_no: i + 2, raw, hunter: get(r, "hunter"), name: get(r, "name"), business_name: get(r, "business_name"),
      phone_raw: phoneRaw, phone_e164: pp?.value ?? null, phone_country: pp?.country ?? null, phone_valid: !!pp?.value,
      alt_e164: pa?.value ?? null, alt_country: pa?.country ?? null,
      store_url: store, store_key: sk?.key ?? null, source: get(r, "source"), status_text: get(r, "status"), notes: get(r, "notes"),
      original_added: parseDate(dateRaw), date_text: dateRaw || null,
    };
  });
}

/** Spreadsheet-formula injection guard for anything we export. */
export const csvSafe = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The reference sheet may have title rows above the headers: look at the first 10 rows and use the one that matches the most known column names. */
export function detectHeaderRow(headers: string[], rows: string[][]): Table {
  const grid = [headers, ...rows];
  const score = (h: string[]) => FIELDS.filter((f) => h.some((c) => f.names.some((n) => norm(c) === norm(n)))).length;
  let best = 0, bs = score(grid[0]);
  for (let i = 1; i < Math.min(10, grid.length); i++) { const sc = score(grid[i]); if (sc > bs) { bs = sc; best = i; } }
  if (best === 0) return { headers, rows };
  const seen = new Map<string, number>();
  const hs = grid[best].map((h, i) => { const n = h || `عمود ${i + 1}`; const k = seen.get(n) ?? 0; seen.set(n, k + 1); return k ? `${n} (${k + 1})` : n; });
  return { headers: hs, rows: grid.slice(best + 1).filter((r) => r.some((x) => x !== "")) };
}
