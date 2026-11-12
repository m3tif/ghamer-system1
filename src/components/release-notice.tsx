"use client";
import { useEffect, useRef, useTransition } from "react";
import { dismissReleaseAction } from "@/server/actions";

/** One-time "what's new" pop-up. Shown until the employee presses «تمام» (then it is marked read for them only). */
export function ReleaseNotice({ id, title, body }: { id: string; title: string; body: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); }, []);
  const ok = () => start(async () => { await dismissReleaseAction(id); ref.current?.close(); });
  return (
    <dialog ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); ok(); }}
      className="m-auto rounded-xl border border-line bg-white p-0 text-charcoal shadow-2xl backdrop:bg-black/45" style={{ width: "min(92vw, 30rem)" }}>
      <div className="p-5">
        <p className="mb-1 text-xs font-semibold text-burgundy-700">{/^تحديث جديد/.test(title) ? "🔔 تحديث جديد في السيستم" : "📣 رسالة من الإدارة"}</p>
        <h2 className="mb-2 text-lg font-bold">{title.replace(/^تحديث جديد:\s*/, "")}</h2>
        {body && <p className="whitespace-pre-wrap text-sm leading-7 text-charcoal">{body}</p>}
        <button type="button" onClick={ok} disabled={pending} className="mt-4 w-full rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700 disabled:opacity-60">تسلم يابشمهندس عاطف</button>
      </div>
    </dialog>
  );
}
