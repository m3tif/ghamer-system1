"use client";
import { useActionState, useCallback, useEffect, useState } from "react";
import { deleteNoteAction, leadNotesAction, type LeadNote } from "@/server/actions";
import { inputCls } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";

const SOURCE: Record<string, string> = { call: "مكالمة", register: "عند الإضافة", import: "من الملف", distribution: "من التوزيع", history: "من السجل القديم", current: "من السجل القديم", note: "" };

/** Full notes history of a lead (newest first). Every note keeps who wrote it and when; nothing is overwritten. */
export function NotesHistory({ leadId, max }: { leadId: string; max?: number }) {
  const [data, setData] = useState<{ notes: LeadNote[]; canDelete: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const load = useCallback(async () => {
    const r = await leadNotesAction(leadId);
    if ("error" in r) setErr(r.error); else { setErr(null); setData(r); }
  }, [leadId]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <p role="alert" className="text-sm text-bad">{err}</p>;
  if (!data) return <p className="text-sm text-ink-500">جارٍ تحميل الملاحظات…</p>;
  if (data.notes.length === 0) return <p className="text-sm text-ink-500">لا توجد ملاحظات بعد.</p>;
  const shown = max && !all ? data.notes.slice(0, max) : data.notes;
  return (
    <div>
      <ol className="max-h-72 space-y-2 overflow-y-auto" aria-label="سجل الملاحظات">
        {shown.map((n) => (
          <li key={n.id} className={`rounded-md border border-line px-3 py-2 text-sm ${n.deleted_at ? "bg-bad/5 opacity-70" : "bg-cream/40"}`}>
            <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
              <span className="font-semibold text-charcoal">{n.by_name ?? "النظام"}</span>
              <span className="tabular-nums">{fmtDateTime(n.created_at)}</span>
              {SOURCE[n.source] && <span className="rounded bg-white px-1.5">{SOURCE[n.source]}</span>}
              {n.deleted_at && <span className="text-bad">محذوفة بواسطة {n.deleted_by_name} — {n.delete_reason}</span>}
            </div>
            <p className={`whitespace-pre-wrap break-words ${n.deleted_at ? "line-through" : ""}`}>{n.body}</p>
            {data.canDelete && !n.deleted_at && <DeleteNote id={n.id} leadId={leadId} onDone={load} />}
          </li>))}
      </ol>
      {max && data.notes.length > max && !all && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 text-xs font-semibold text-burgundy-700 hover:underline">عرض كل الملاحظات ({data.notes.length})</button>)}
    </div>
  );
}

function DeleteNote({ id, leadId, onDone }: { id: string; leadId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(deleteNoteAction, {} as { ok?: string; error?: string });
  useEffect(() => { if (state.ok) onDone(); }, [state, onDone]);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs text-bad hover:underline">حذف</button>;
  return (
    <div className="mt-2 grid gap-2 rounded-md border border-bad/30 bg-white p-2">
      {state.error && <p role="alert" className="text-xs text-bad">{state.error}</p>}
      <form id={`del-${id}`} action={act} className="grid gap-2">
        <input type="hidden" name="note_id" value={id} /><input type="hidden" name="lead_id" value={leadId} />
        <input name="reason" placeholder="سبب الحذف" required className={inputCls} />
        <input name="confirm" placeholder="اكتب «حذف» للتأكيد" required className={inputCls} />
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="rounded-md bg-bad px-3 py-1 text-xs font-semibold text-white disabled:opacity-60">تأكيد الحذف</button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-1 text-xs">إلغاء</button>
        </div>
      </form>
    </div>
  );
}
