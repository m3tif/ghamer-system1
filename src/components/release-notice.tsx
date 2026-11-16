"use client";
import { useEffect, useRef, useTransition } from "react";
import { dismissReleaseAction } from "@/server/actions";

/** One-time "what's new" pop-up. Shown until the employee presses «تمام» (then it is marked read for them only). */
export function ReleaseNotice({ id, title, body, sender }: { id: string; title: string; body: string | null; sender?: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  // the same message can arrive from the page and from the live check: show it once
  useEffect(() => {
    const w = window as unknown as { __notices?: Set<string> }; w.__notices ??= new Set();
    if (w.__notices.has(id)) return; w.__notices.add(id);
    if (!ref.current?.open) ref.current?.showModal();
  }, [id]);
  const ok = () => start(async () => { await dismissReleaseAction(id); ref.current?.close(); });
  return (
    <dialog ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); ok(); }}
      className="m-auto rounded-xl border border-line bg-white p-0 text-charcoal shadow-2xl backdrop:bg-black/45" style={{ width: "min(92vw, 30rem)" }}>
      <div className="p-5">
        <p className="mb-1 text-xs font-semibold text-burgundy-700">{/^تحديث جديد/.test(title) ? "🔔 تحديث جديد في السيستم" : sender ? `📣 رسالة من ${sender}` : "📣 رسالة من الإدارة"}</p>
        <h2 className="mb-2 text-lg font-bold">{title.replace(/^تحديث جديد:\s*/, "")}</h2>
        {body && <p className="whitespace-pre-wrap text-sm leading-7 text-charcoal">{body}</p>}
        <button type="button" onClick={ok} disabled={pending} className="mt-4 w-full rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700 disabled:opacity-60">تمام، فهمت</button>
      </div>
    </dialog>
  );
}
