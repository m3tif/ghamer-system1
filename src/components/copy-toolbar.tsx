"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Field = "phone" | "store" | "name" | "status" | "notes" | "creator" | "date";
const FIELDS: { key: Field; label: string }[] = [
  { key: "phone", label: "أرقام الهواتف" }, { key: "store", label: "روابط المتاجر" }, { key: "name", label: "الأسماء" },
  { key: "status", label: "الحالات" }, { key: "notes", label: "الملاحظات" }, { key: "creator", label: "اسم الـ Hunter" }, { key: "date", label: "تاريخ الـ Hunt" },
];
const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();

async function writeClipboard(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
  } catch { return false; }
}

/**
 * Copies only what is needed from the rows on the current page. It works on the rows the page already rendered for this user
 * (so it can never expose more than the user can see): the selected rows, or the whole page when nothing is selected.
 * Rows are marked in the table with data-row / data-* attributes and a checkbox.row-sel.
 */
export function CopyToolbar({ tableId = "leads-table", total: grand = 0 }: { tableId?: string; total?: number }) {
  const [sel, setSel] = useState(0);
  const [total, setTotal] = useState(0);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const boxes = useCallback(() => Array.from(document.querySelectorAll<HTMLInputElement>(`#${tableId} input.row-sel`)), [tableId]);
  const refresh = useCallback(() => { const b = boxes(); setTotal(b.length); setSel(b.filter((x) => x.checked).length); }, [boxes]);
  useEffect(() => {
    refresh();
    const el = document.getElementById(tableId);
    el?.addEventListener("change", refresh);
    window.addEventListener("leads:rows", refresh);
    return () => { el?.removeEventListener("change", refresh); window.removeEventListener("leads:rows", refresh); };
  }, [refresh, tableId]);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 3500); };
  const rows = () => {
    const all = Array.from(document.querySelectorAll<HTMLElement>(`#${tableId} tr[data-row]`));
    const chosen = all.filter((r) => r.querySelector<HTMLInputElement>("input.row-sel")?.checked);
    return chosen.length ? chosen : all;
  };
  const setAll = (v: boolean) => { boxes().forEach((b) => { b.checked = v; }); refresh(); };
  const selectRange = () => {
    const a = parseInt(from, 10), b = parseInt(to || from, 10);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > total) { flash(false, `اكتب نطاقًا صحيحًا من 1 إلى ${total}`); return; }
    boxes().forEach((x, i) => { x.checked = i + 1 >= a && i + 1 <= b; }); refresh();
  };
  const copy = async (text: string, what: string, n: number) => {
    if (!text) { flash(false, `لا يوجد ${what} في الصفوف المختارة`); return; }
    if (await writeClipboard(text)) { setManual(null); flash(true, `تم نسخ ${n} ${what}`); }
    else { setManual(text); flash(false, "تعذّر الوصول للحافظة — انسخ النص من المربع أدناه"); }
  };
  const copyField = (f: Field, label: string) => {
    const vals = rows().map((r) => clean(r.dataset[f] ?? "")).filter(Boolean);
    void copy(vals.join("\n"), label, vals.length);
  };
  const copyRows = () => {
    const rs = rows();
    void copy(rs.map((r) => ["name", "phone", "store", "status", "notes", "creator", "date"].map((k) => clean(r.dataset[k] ?? "")).join("\t")).join("\n"), "صف كامل", rs.length);
  };
  const scope = sel ? `${sel} محدد` : `كل المحمّل (${total})`;
  const partial = grand > total;
  const b = "rounded-md border border-line bg-white px-2.5 py-1 text-xs hover:bg-cream";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs" aria-label="أدوات التحديد والنسخ">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">تحديد:</span>
        <button type="button" onClick={() => setAll(true)} className={b}>الكل</button>
        <button type="button" onClick={() => setAll(false)} className={b} disabled={!sel}>لا شيء</button>
        <span className="text-ink-500">من</span>
        <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" dir="ltr" aria-label="من صف" className="w-12 rounded-md border border-line px-1.5 py-1 text-center" />
        <span className="text-ink-500">إلى</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" dir="ltr" aria-label="إلى صف" className="w-12 rounded-md border border-line px-1.5 py-1 text-center" />
        <button type="button" onClick={selectRange} className={b}>حدّد النطاق</button>
        {partial && <button type="button" onClick={() => window.dispatchEvent(new Event("leads:load-all"))} className={b}>تحميل كل العملاء ({grand})</button>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">نسخ ({scope}):</span>
        {FIELDS.map((f) => <button key={f.key} type="button" onClick={() => copyField(f.key, f.label)} className={b}>{f.label}</button>)}
        <button type="button" onClick={copyRows} className={b + " font-semibold"}>نسخ الصفوف المحددة كاملة</button>
      </div>
      {msg && <span role="status" className={`rounded-md px-2 py-1 ${msg.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>{msg.text}</span>}
      {manual !== null && (
        <textarea readOnly value={manual} onFocus={(e) => e.currentTarget.select()} dir="ltr" rows={4} className="w-full rounded-md border border-line p-2 font-mono text-xs" aria-label="النص المراد نسخه" />)}
    </div>
  );
}
