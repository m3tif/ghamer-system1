"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MARK_COLORS, MARK_COLS } from "@/lib/marks";
import { reorderLeadsAction, resetLeadOrderAction, setCellColorsAction } from "@/server/actions";

const TABLE = "#leads-table";
const rowsOf = () => Array.from(document.querySelectorAll<HTMLTableRowElement>(`${TABLE} tbody tr[data-lead]`));

/**
 * Colour brush + drag & drop ordering for the leads table. Everything is per user (saved for the person who did it).
 * Works directly on the rows the server rendered: it changes the DOM at once, then saves in the background.
 */
export function LeadsMarks({ manualActive }: { manualActive: boolean }) {
  const router = useRouter(), pathname = usePathname(), sp = useSearchParams();
  const [brush, setBrush] = useState<string | null>(null);        // colour key, "erase", or null (off)
  const [scope, setScope] = useState<"cell" | "row">("cell");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [manual, setManual] = useState(manualActive);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setManual(manualActive), [manualActive]);

  const say = useCallback((ok: boolean, text: string) => { setMsg({ ok, text }); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 2500); }, []);
  const enqueue = useCallback((fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) => {
    queue.current = queue.current.then(async () => { try { const r = await fn(); if (!r.ok) say(false, r.error ?? "تعذّر الحفظ"); else if (okText) say(true, okText); } catch { say(false, "تعذّر الحفظ. تأكد من الاتصال"); } });
  }, [say]);

  // ───── paint ─────
  useEffect(() => {
    const t = document.querySelector<HTMLElement>(TABLE); if (!t) return;
    t.classList.toggle("paint-mode", brush !== null);
    if (brush === null) return;
    const onClick = (e: MouseEvent) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>("td[data-col]"); const tr = td?.closest<HTMLElement>("tr[data-lead]");
      if (!td || !tr) return;
      e.preventDefault(); e.stopPropagation();
      const lead = tr.dataset.lead!;
      const cols = scope === "row" ? MARK_COLS.filter((c) => tr.querySelector(`td[data-col="${c}"]`)) : [td.dataset.col!];
      const color = brush === "erase" ? null : brush;
      const toggleOff = scope === "cell" && color !== null && td.dataset.color === color;     // painting a cell with its own colour clears it
      const final = toggleOff ? null : color;
      for (const c of cols) { const cell = tr.querySelector<HTMLElement>(`td[data-col="${c}"]`); if (!cell) continue; if (final) cell.dataset.color = final; else delete cell.dataset.color; }
      enqueue(() => setCellColorsAction(lead, [...cols], final));
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBrush(null); };
    t.addEventListener("click", onClick, true); window.addEventListener("keydown", onKey);
    return () => { t.removeEventListener("click", onClick, true); window.removeEventListener("keydown", onKey); t.classList.remove("paint-mode"); };
  }, [brush, scope, enqueue]);

  // ───── order (drag & drop + ▲▼) ─────
  const restripe = useCallback(() => {
    rowsOf().forEach((tr, i) => {
      const idx = tr.querySelector("[data-idx]"); if (idx) idx.textContent = String(i + 1);
      if (tr.className.includes("bg-bad/5")) return;
      const want = i % 2 ? "bg-cream/40" : "bg-white", other = i % 2 ? "bg-white" : "bg-cream/40";
      for (const el of [tr, tr.querySelector<HTMLElement>("td")]) { el?.classList.remove(other); el?.classList.add(want); }
    });
  }, []);
  const persistOrder = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const ids = rowsOf().map((r) => r.dataset.lead!).slice(0, 2000);
      enqueue(() => reorderLeadsAction(ids), "تم حفظ ترتيبك");
      setManual(true);
      const p = new URLSearchParams(window.location.search); if (p.get("sort") !== "manual") { p.set("sort", "manual"); p.delete("dir"); window.history.replaceState(null, "", `${pathname}?${p}`); }
    }, 350);
  }, [enqueue, pathname]);

  useEffect(() => {
    const t = document.querySelector<HTMLElement>(TABLE); if (!t) return;
    let drag: HTMLTableRowElement | null = null; let over: HTMLTableRowElement | null = null;
    const clear = () => { t.querySelectorAll(".dnd-over-top,.dnd-over-bottom").forEach((x) => x.classList.remove("dnd-over-top", "dnd-over-bottom")); };
    const onStart = (e: DragEvent) => {
      const h = (e.target as HTMLElement).closest("[data-drag-handle]"); if (!h || !e.dataTransfer) return;
      drag = h.closest("tr[data-lead]"); if (!drag) return;
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", drag.dataset.lead ?? "");
      e.dataTransfer.setDragImage(drag, 24, 12); drag.classList.add("dnd-dragging");
    };
    const onOver = (e: DragEvent) => {
      if (!drag) return; const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-lead]"); if (!tr || tr === drag) return;
      e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const r = tr.getBoundingClientRect(); const top = e.clientY < r.top + r.height / 2;
      clear(); tr.classList.add(top ? "dnd-over-top" : "dnd-over-bottom"); over = tr;
    };
    const onDrop = (e: DragEvent) => {
      if (!drag || !over) return; e.preventDefault();
      const top = over.classList.contains("dnd-over-top");
      over.parentElement!.insertBefore(drag, top ? over : over.nextSibling);
      clear(); restripe(); persistOrder();
    };
    const onEnd = () => { drag?.classList.remove("dnd-dragging"); clear(); drag = null; over = null; };
    const onClickMove = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-move]"); if (!b) return;
      const tr = b.closest<HTMLTableRowElement>("tr[data-lead]"); if (!tr) return;
      const sib = b.dataset.move === "up" ? tr.previousElementSibling : tr.nextElementSibling;
      if (!sib || !(sib as HTMLElement).dataset.lead) return;
      tr.parentElement!.insertBefore(tr, b.dataset.move === "up" ? sib : sib.nextSibling);
      restripe(); persistOrder(); b.focus();
    };
    t.addEventListener("dragstart", onStart); t.addEventListener("dragover", onOver); t.addEventListener("drop", onDrop); t.addEventListener("dragend", onEnd); t.addEventListener("click", onClickMove);
    return () => { t.removeEventListener("dragstart", onStart); t.removeEventListener("dragover", onOver); t.removeEventListener("drop", onDrop); t.removeEventListener("dragend", onEnd); t.removeEventListener("click", onClickMove); };
  }, [persistOrder, restripe]);

  const manualHref = (() => { const p = new URLSearchParams(sp.toString()); p.set("sort", "manual"); p.delete("dir"); return `${pathname}?${p}`; })();
  const chip = "h-6 w-6 rounded-full border border-black/10 outline-offset-2 hover:scale-110";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs" aria-label="أدوات التلوين والترتيب">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">🎨 تلوين:</span>
        {MARK_COLORS.map((c) => (
          <button key={c.key} type="button" title={c.label} aria-label={`تلوين ${c.label}`} aria-pressed={brush === c.key} onClick={() => setBrush(brush === c.key ? null : c.key)}
            className={`${chip} ${brush === c.key ? "ring-2 ring-burgundy-600" : ""}`} style={{ background: c.hex }} />))}
        <button type="button" aria-pressed={brush === "erase"} onClick={() => setBrush(brush === "erase" ? null : "erase")} className={`rounded-md border px-2 py-0.5 ${brush === "erase" ? "border-burgundy-600 bg-burgundy-50 font-semibold" : "border-line bg-white hover:bg-cream"}`}>مسح اللون</button>
        <span className="mx-1 text-ink-300">|</span>
        <label className="flex items-center gap-1"><input type="radio" name="paint-scope" checked={scope === "cell"} onChange={() => setScope("cell")} />الخانة</label>
        <label className="flex items-center gap-1"><input type="radio" name="paint-scope" checked={scope === "row"} onChange={() => setScope("row")} />الصف كامل</label>
        {brush !== null && <button type="button" onClick={() => setBrush(null)} className="rounded-md bg-burgundy-600 px-2 py-0.5 font-semibold text-white">إيقاف التلوين (Esc)</button>}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">↕ الترتيب:</span>
        <span className="text-ink-500">اسحب ⠿ أو استخدم ▲▼ لتحريك أي عميل.</span>
        {manual ? (
          <button type="button" className="rounded-md border border-line bg-white px-2 py-0.5 hover:bg-cream" onClick={async () => { await resetLeadOrderAction(); const p = new URLSearchParams(window.location.search); p.set("sort", "created"); router.push(`${pathname}?${p}`); router.refresh(); }}>رجوع للترتيب الافتراضي</button>
        ) : <a href={manualHref} className="rounded-md border border-line bg-white px-2 py-0.5 hover:bg-cream">عرض ترتيبي</a>}
      </div>
      {brush !== null && <span role="status" className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">وضع التلوين شغّال: اضغط على أي خانة ({scope === "row" ? "سيُلوَّن الصف كامل" : brush === "erase" ? "لمسح لونها" : "لتلوينها، وإعادة الضغط بنفس اللون تمسحه"}).</span>}
      {msg && <span role="status" className={`rounded-md px-2 py-1 ${msg.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>{msg.text}</span>}
    </div>
  );
}
