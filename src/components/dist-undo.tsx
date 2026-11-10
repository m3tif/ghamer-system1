"use client";
import { useRef, useState } from "react";
import { ActionForm } from "@/components/forms";
import { inputCls } from "@/components/forms";
import { distUndoAction, distUndoPreviewAction } from "@/server/actions";

type Preview = { file_name: string; status: string; total: number; touched: number; can_undo: boolean;
  per_employee: { employee: string; count: number }[]; blocking: { lead_id: string; name: string; employee: string; reason: string }[] };

/** «التراجع عن التوزيع»: shows what will be undone first, refuses (with the reasons) if employees already worked on the data. */
export function UndoDistribution({ batch }: { batch: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [p, setP] = useState<Preview | null>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const open = async () => {
    ref.current?.showModal(); setP(null); setErr(null); setLoading(true);
    const r = await distUndoPreviewAction(batch).catch(() => ({ ok: false, error: "تعذّر تحميل المعاينة" } as const));
    setLoading(false); if (r.ok) setP(r.data); else setErr(r.error ?? "تعذّر تحميل المعاينة");
  };
  return (
    <>
      <button type="button" onClick={open} className="rounded-md border border-bad/40 bg-white px-2 py-1 text-xs font-medium text-bad hover:bg-bad/5">التراجع عن التوزيع</button>
      <dialog ref={ref} aria-label="التراجع عن التوزيع" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
        className="m-auto max-h-[90vh] overflow-hidden rounded-xl border border-line bg-white p-0 text-charcoal shadow-2xl backdrop:bg-black/45" style={{ width: "min(94vw, 38rem)" }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-bold">التراجع عن التوزيع</h2>
          <button type="button" aria-label="إغلاق" onClick={() => ref.current?.close()} className="rounded-md px-2 py-1 text-xl leading-none text-ink-500 hover:bg-cream">×</button>
        </div>
        <div className="max-h-[calc(90vh-4rem)] space-y-3 overflow-y-auto p-5 text-sm">
          {loading && <p role="status">جارٍ حساب المعاينة…</p>}
          {err && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-bad">{err}</p>}
          {p && (<>
            <p>الملف: <b>{p.file_name}</b> — سيتم التراجع عن <b>{p.total}</b> عميل وُزّعوا في هذه العملية بالذات (ولن يتأثر أي عميل قديم في النظام).</p>
            <ul className="list-disc space-y-0.5 ps-5">{p.per_employee.map((e) => <li key={e.employee}>{e.employee}: {e.count} عميل سيُسحبون منه</li>)}</ul>
            {p.touched > 0 ? (
              <div role="alert" className="rounded-md border border-bad/40 bg-bad/5 p-3 text-bad">
                <p className="font-semibold">لا يمكن التراجع الآن: {p.touched} عميل اتعمل عليهم شغل بعد التوزيع، والتراجع هيضيّع شغل الموظفين.</p>
                <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[13px]">{p.blocking.map((b) => <li key={b.lead_id}>{b.name} ({b.employee}): {b.reason}</li>)}</ul>
                <p className="mt-1 text-[13px]">عالج هذه الحالات أولًا (مثلًا اطلب من الموظف إنهاءها أو انقلها بشكل آمن)، ثم ارجع للتراجع.</p>
              </div>
            ) : p.can_undo ? (
              <ActionForm action={distUndoAction} submit="تأكيد التراجع" tone="primary" hiddenOnOk>
                <input type="hidden" name="id" value={batch} />
                <p className="text-ink-500">العملاء لن يُحذفوا: هيتأرشفوا ويختفوا عن الموظفين، وأرقامهم تتحرر عشان تعيد إرسال الملف مصحّحًا. العملية بتتسجل في سجل التدقيق ولا يمكن التراجع عنها مرتين.</p>
                <label className="block">سبب التراجع<input name="reason" required className={inputCls + " mt-1"} placeholder="مثال: الملف كان فيه بيانات غلط" /></label>
                <label className="block">اكتب «تراجع» للتأكيد<input name="confirm" required autoComplete="off" className={inputCls + " mt-1"} /></label>
              </ActionForm>
            ) : <p className="text-ink-500">هذه العملية لا يمكن التراجع عنها (تم التراجع عنها من قبل أو ليست مكتملة).</p>}
          </>)}
        </div>
      </dialog>
    </>
  );
}
