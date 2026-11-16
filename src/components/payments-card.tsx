import { Badge, Card } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { decidePaymentAction, recordPaymentAction } from "@/server/actions";
import type { Payment } from "@/server/data";
import { fmtDate, fmtDateTime, fmtSar, toLocalInput } from "@/lib/format";
import { INSTALLMENT_KIND, PAYMENT_METHOD, PAYMENT_STATUS, PAYMENT_STATUS_TONE } from "@/lib/labels";

/** Money that actually arrived for this contract. Finance records it; the Finance Manager confirms or rejects it. */
export function PaymentsCard({ contractId, total, method, payments, installments, receipts, canRecord, canVerify, open }: {
  contractId: string; total: number; method: string | null; payments: Payment[]; installments: { seq: number; kind: string; due_date: string; amount: string }[];
  receipts: { id: string; filename: string }[]; canRecord: boolean; canVerify: boolean; open: boolean }) {
  const paid = payments.filter((p) => p.status === "verified").reduce((a, p) => a + Number(p.amount), 0);
  const pending = payments.filter((p) => p.status === "pending").reduce((a, p) => a + Number(p.amount), 0);
  const left = Math.max(0, total - paid), pct = total ? Math.min(100, (paid / total) * 100) : 0;
  return (
    <Card title="الدفعات المستلمة فعلًا">
      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-lg bg-ok/5 p-2"><p className="text-xs text-ink-500">اتحصل واتأكد</p><p className="font-extrabold tabular-nums text-ok">{fmtSar(paid)}</p></div>
        <div className="rounded-lg bg-warn/5 p-2"><p className="text-xs text-ink-500">مستني تأكيد</p><p className="font-extrabold tabular-nums text-warn">{fmtSar(pending)}</p></div>
        <div className="rounded-lg bg-burgundy-600/5 p-2"><p className="text-xs text-ink-500">باقي على العميل</p><p className="font-extrabold tabular-nums text-burgundy-700">{fmtSar(left)}</p></div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-dark/70"><div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} /></div>
      {payments.length === 0 ? <p className="mt-4 text-sm text-ink-500">مفيش دفعات متسجلة لسه.</p> : (
        <ul className="mt-4 divide-y divide-line text-sm">{payments.map((p) => (
          <li key={p.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold tabular-nums">{fmtSar(p.amount)} <span className="font-normal text-ink-500">· {fmtDate(p.paid_at)} · {PAYMENT_METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}{p.installment_seq ? ` · الدفعة ${p.installment_seq}` : ""}</span></span>
              <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS[p.status]}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-ink-500">سجّلها {p.recorded_by} · {fmtDateTime(p.recorded_at)}{p.verified_by ? ` · ${p.status === "verified" ? "أكدها" : "رفضها"} ${p.verified_by} · ${fmtDateTime(p.verified_at)}` : ""}
              {p.receipt_id && <> · <a href={`/files/${p.receipt_id}`} target="_blank" rel="noopener noreferrer" className="underline">الوصل</a></>}</p>
            {p.note && <p className="mt-1 text-xs">{p.note}</p>}
            {p.reject_reason && <p className="mt-1 text-xs text-bad">سبب الرفض: {p.reject_reason}</p>}
            {canVerify && p.status === "pending" && (
              <div className="mt-2 flex flex-wrap items-start gap-2">
                <ActionForm action={decidePaymentAction} submit="تأكيد إن الفلوس وصلت ✓" className="" hiddenOnOk><Hidden name="contract_id" value={contractId} /><Hidden name="payment_id" value={p.id} /><Hidden name="ok" value="1" /></ActionForm>
                <details className="text-sm"><summary className="cursor-pointer rounded-md border border-line px-3 py-2 font-medium">رفض</summary>
                  <div className="mt-2 w-72"><ActionForm action={decidePaymentAction} submit="رفض الدفعة" tone="quiet" hiddenOnOk><Hidden name="contract_id" value={contractId} /><Hidden name="payment_id" value={p.id} /><Hidden name="ok" value="0" />
                    <TextArea label="السبب" name="reason" rows={2} required /></ActionForm></div></details>
              </div>)}
          </li>))}</ul>)}
      {canRecord && open && left > 0 && (
        <details className="mt-4 border-t border-line pt-4" open={payments.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-burgundy-700">+ تسجيل دفعة وصلت</summary>
          <div className="mt-3"><ActionForm action={recordPaymentAction} submit="تسجيل الدفعة" className="grid gap-3 sm:grid-cols-2">
            <Hidden name="contract_id" value={contractId} /><Hidden name="request_id" value={crypto.randomUUID()} />
            <Field label="المبلغ (ريال)" name="amount" required dir="ltr" placeholder={String(left)} />
            <Field label="تاريخ وصول الفلوس" name="paid_at" type="date" required defaultValue={toLocalInput(new Date()).slice(0, 10)} />
            <SelectField label="طريقة الدفع" name="method" required defaultValue={method ?? ""} empty="اختار" options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))} />
            <Field label="رقم العملية / المرجع" name="reference" dir="ltr" />
            {installments.length > 0 && <SelectField label="تبع أنهي دفعة في الجدول (اختياري)" name="installment_seq" empty="—" options={installments.map((i) => ({ value: String(i.seq), label: `${i.seq}. ${INSTALLMENT_KIND[i.kind] ?? i.kind} — ${fmtDate(i.due_date)} — ${fmtSar(i.amount)}` }))} />}
            {receipts.length > 0 && <SelectField label="الوصل (من ملفات العقد)" name="receipt_id" empty="—" options={receipts.map((r) => ({ value: r.id, label: r.filename }))} />}
            <TextArea label="ملاحظة (اختياري)" name="note" rows={2} className="sm:col-span-2" />
            {canVerify && <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" name="verify" value="1" className="h-4 w-4 accent-burgundy-600" />اتأكدت إن الفلوس وصلت (سجّلها مؤكدة على طول)</label>}
          </ActionForm></div>
        </details>)}
      {canRecord && !open && <p className="mt-4 text-xs text-ink-500">تسجيل الدفعات بيتفتح بعد ما العقد يتبعت للمالية.</p>}
    </Card>
  );
}
