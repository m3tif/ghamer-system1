"use client";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

export const DialogCtx = createContext<{ close: () => void } | null>(null);
export const useDialog = () => useContext(DialogCtx);

/** Modal dialog sized for the screen (max 92vw / 90vh, scrolls inside). Closes on backdrop click, Esc, or after a successful form. */
export function Dialog({ trigger, title, children, wide = false, triggerClass = "", tone = "quiet" }: {
  trigger: ReactNode; title: string; children: ReactNode; wide?: boolean; triggerClass?: string; tone?: "quiet" | "primary" | "danger";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [gen, setGen] = useState(0);   // every opening starts a fresh form, so it always shows the latest saved values and a clean state
  const base = tone === "primary" ? "bg-burgundy-600 text-white hover:bg-burgundy-700 border-transparent"
    : tone === "danger" ? "border-bad/40 bg-white text-bad hover:bg-bad/5" : "border-line bg-white hover:bg-cream";
  return (
    <>
      <button type="button" onClick={() => { setGen((g) => g + 1); ref.current?.showModal(); }}
        className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium ${base} ${triggerClass}`}>{trigger}</button>
      <dialog ref={ref} aria-label={title}
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
        className={`m-auto max-h-[90vh] overflow-hidden rounded-xl border border-line bg-white p-0 text-charcoal shadow-2xl backdrop:bg-black/45`}
        style={{ width: `min(94vw, ${wide ? "48rem" : "36rem"})` }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" aria-label="إغلاق" onClick={() => ref.current?.close()} className="rounded-md px-2 py-1 text-xl leading-none text-ink-500 hover:bg-cream">×</button>
        </div>
        <div className="max-h-[calc(90vh-4rem)] overflow-y-auto p-5">
          {gen > 0 && <DialogCtx.Provider key={gen} value={{ close: () => ref.current?.close() }}>{children}</DialogCtx.Provider>}
        </div>
      </dialog>
    </>
  );
}
