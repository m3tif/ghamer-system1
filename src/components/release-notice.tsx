"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { dismissReleaseAction, replyBroadcastAction } from "@/server/actions";

/**
 * One-time pop-up (a "what's new" note or a message from the admin / a manager). Shown until the employee presses
 * «تمام» (then it is marked read for them only). A message that asks for replies also gets a box to write back.
 */
export function ReleaseNotice({ id, title, body, sender, broadcastId }: { id: string; title: string; body: string | null; sender?: string | null; broadcastId?: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // the same message can arrive from the page and from the live check: show it once
  useEffect(() => {
    const w = window as unknown as { __notices?: Set<string> }; w.__notices ??= new Set();
    if (w.__notices.has(id)) return; w.__notices.add(id);
    if (!ref.current?.open) ref.current?.showModal();
  }, [id]);
  // the live check sends the pop-ups still waiting: one that is gone (withdrawn by its sender) closes
  useEffect(() => {
    const on = (e: Event) => { const open = (e as CustomEvent<string[]>).detail; if (!sent && !open.includes(id) && ref.current?.open) ref.current.close(); };
    window.addEventListener("ghamer:open-notices", on);
    return () => window.removeEventListener("ghamer:open-notices", on);
  }, [id, sent]);
  const ok = () => start(async () => { await dismissReleaseAction(id); ref.current?.close(); });
  const send = () => start(async () => {
    setErr(null);
    const r = await replyBroadcastAction(broadcastId!, reply);
    if (r.error) { setErr(r.error); return; }
    setSent(true); setTimeout(() => ref.current?.close(), 1200);
  });
  return (
    <dialog ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); ok(); }}
      className="m-auto rounded-xl border border-line bg-white p-0 text-charcoal shadow-2xl backdrop:bg-black/45" style={{ width: "min(92vw, 32rem)" }}>
      <div className="p-5">
        <p className="mb-1 text-xs font-semibold text-burgundy-700">{/^تحديث جديد/.test(title) ? "🔔 تحديث جديد في السيستم" : sender ? `📣 رسالة من ${sender}` : "📣 رسالة من الإدارة"}</p>
        <h2 className="mb-2 text-lg font-bold">{title.replace(/^تحديث جديد:\s*/, "")}</h2>
        {body && <p className="whitespace-pre-wrap text-sm leading-7 text-charcoal">{body}</p>}
        {broadcastId ? (
          sent ? <p className="mt-4 rounded-md bg-ok/10 px-3 py-3 text-center text-sm font-semibold text-ok">✓ اتبعت ردك</p> : (
            <div className="mt-4 space-y-2">
              <label htmlFor={`reply-${id}`} className="block text-sm font-semibold">ردّك</label>
              <textarea id={`reply-${id}`} value={reply} onChange={(e) => setReply(e.target.value)} rows={4} maxLength={2000}
                placeholder="اكتب ردك هنا…" className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-burgundy-600 focus:outline-none" />
              {err && <p role="alert" className="text-sm text-bad">{err}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={send} disabled={pending || !reply.trim()} className="flex-1 rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700 disabled:opacity-50">ابعت الرد</button>
                <button type="button" onClick={ok} disabled={pending} className="rounded-md border border-line px-4 py-2 text-sm hover:bg-cream disabled:opacity-60">بعدين</button>
              </div>
              <p className="text-xs text-ink-500">لو دوست «بعدين» تقدر ترد من صفحة الإشعارات.</p>
            </div>)
        ) : (
          <button type="button" onClick={ok} disabled={pending} className="mt-4 w-full rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700 disabled:opacity-60">تمام، فهمت</button>
        )}
      </div>
    </dialog>
  );
}
