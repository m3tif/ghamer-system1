import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { contractGet } from "@/server/data";
import { Badge, Card, PageHeader, Table, td, btnQuiet } from "@/components/ui";
import { ActionForm, Alert, Hidden, TextArea, inputCls } from "@/components/forms";
import { returnContractAction, submitContractAction, uploadContractFileAction } from "@/server/actions";
import { fmtDate, fmtDateTime, fmtSar } from "@/lib/format";
import { CONTRACT_STATUS, CONTRACT_STATUS_TONE, FILE_KIND, INSTALLMENT_KIND, PACKAGE, PAYMENT_METHOD } from "@/lib/labels";

export const dynamic = "force-dynamic";
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} ميجا` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const s = await requireSession(); await requirePerm(s, "contracts.view");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await contractGet(s.userId, id);
  if (!data) notFound();
  const { contract: c, items, installments, files } = data;
  const open = ["draft", "returned"].includes(c.status);
  const canWrite = c.can_write && open;
  const signed = files.filter((f: any) => f.kind === "signed_contract");
  const isFinance = can(s, "finance.verify") || can(s, "finance.approve");
  const canAddDoc = c.status !== "cancelled" && (c.can_write || can(s, "finance.record"));
  return (
    <>
      <PageHeader title={`عقد ${c.contract_no}`} sub={`${c.client_name}${c.business_name ? " · " + c.business_name : ""}`}
        actions={<><Badge tone={CONTRACT_STATUS_TONE[c.status]}>{CONTRACT_STATUS[c.status]}</Badge>
          {canWrite && <Link href={`/contracts/${id}/edit`} className={btnQuiet}>تعديل العقد</Link>}
          {can(s, "deals.view") && <Link href={`/deals/${c.deal_id}`} className={btnQuiet}>الصفقة</Link>}</>} />
      {sp.saved && open && <div className="mb-4"><Alert kind="ok">تم حفظ العقد. {signed.length === 0 ? "الخطوة الجاية: ارفع العقد الموقّع وابعته للمالية." : "تقدر تبعته للمالية دلوقتي."}</Alert></div>}
      {c.status === "returned" && <div className="mb-4"><Alert kind="error">المالية رجّعت العقد للتعديل: {c.return_reason} — {c.returned_by_name} · {fmtDateTime(c.returned_at)}</Alert></div>}
      {c.status === "submitted" && <div className="mb-4 rounded-md border border-line bg-cream px-4 py-3 text-sm">العقد عند المالية من {fmtDateTime(c.submitted_at)} (أرسله {c.submitted_by_name}). مينفعش يتعدّل لحد ما المالية تراجعه.</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="الخدمات المتعاقد عليها">
            <Table head={["الخدمة", "الوصف", "السعر النهائي"]}>
              {items.map((i: any, k: number) => (<tr key={k}><td className={td + " font-medium"}>{i.service_name}</td><td className={td + " text-ink-500"}>{i.description || "—"}</td><td className={td + " whitespace-nowrap tabular-nums"}>{fmtSar(i.amount)}</td></tr>))}
            </Table>
            <dl className="mt-4 max-w-md space-y-1 text-sm">
              {Number(c.discount_amount) > 0 && <div className="flex justify-between"><dt>الخصم</dt><dd className="tabular-nums">− {fmtSar(c.discount_amount)}</dd></div>}
              <div className="flex justify-between text-base font-bold"><dt>الإجمالي النهائي (شامل الضريبة)</dt><dd className="tabular-nums">{fmtSar(c.total_amount)}</dd></div>
              <div className="flex justify-between text-ink-500"><dt>قيمة الخدمات قبل الضريبة</dt><dd className="tabular-nums">{fmtSar(c.net_amount)}</dd></div>
              <div className="flex justify-between text-ink-500"><dt>ضريبة القيمة المضافة ({Math.round(Number(c.vat_rate) * 100)}%)</dt><dd className="tabular-nums">{fmtSar(c.vat_amount)}</dd></div>
            </dl>
          </Card>
          <Card title="جدول الدفعات">
            {installments.length === 0 ? <p className="text-sm text-ink-500">مفيش أقساط مكتوبة. عند الإرسال للمالية هيتسجل دفعة واحدة كاملة بتاريخ البداية.</p> : (
              <Table head={["#", "النوع", "تاريخ الاستحقاق", "المبلغ", "ملاحظة"]}>
                {installments.map((i: any) => (<tr key={i.seq}><td className={td}>{i.seq}</td><td className={td}>{INSTALLMENT_KIND[i.kind]}</td><td className={td + " whitespace-nowrap"}>{fmtDate(i.due_date)}</td>
                  <td className={td + " whitespace-nowrap tabular-nums"}>{fmtSar(i.amount)}</td><td className={td + " text-ink-500"}>{i.note || "—"}</td></tr>))}
              </Table>)}
            <p className="mt-3 text-xs text-ink-500">تسجيل الدفعات الفعلية واعتمادها بيتم من المالية (الخطوة الجاية في السيستم).</p>
          </Card>
          <Card title="الملفات">
            {files.length === 0 ? <p className="text-sm text-ink-500">مفيش ملفات مرفوعة لسه.</p> : (
              <ul className="divide-y divide-line text-sm">{files.map((f: any) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Badge tone={f.kind === "signed_contract" ? "ok" : "neutral"}>{FILE_KIND[f.kind] ?? f.kind}</Badge> <a href={`/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="ms-1 font-medium text-burgundy-700 underline">{f.filename}</a></span>
                  <span className="text-xs text-ink-500">{kb(Number(f.size_bytes))} · {f.uploaded_by} · {fmtDateTime(f.created_at)}</span></li>))}</ul>)}
            {(canWrite || canAddDoc) && (
              <div className="mt-4 border-t border-line pt-4">
                <ActionForm action={uploadContractFileAction} submit="رفع الملف" className="grid gap-3 md:grid-cols-[12rem_1fr_auto] md:items-end">
                  <Hidden name="contract_id" value={id} />
                  <div><label htmlFor="kind" className="mb-1 block text-sm font-medium">نوع الملف</label>
                    <select id="kind" name="kind" className={inputCls} defaultValue={canWrite ? "signed_contract" : "other"}>
                      {canWrite && <option value="signed_contract">العقد الموقّع</option>}<option value="other">مستند آخر</option></select></div>
                  <div><label htmlFor="file" className="mb-1 block text-sm font-medium">الملف</label>
                    <input id="file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={inputCls + " file:me-3 file:rounded file:border-0 file:bg-cream file:px-3 file:py-1 file:text-sm"} />
                    <p className="mt-1 text-xs text-ink-500">PDF أو صورة (JPG / PNG / WEBP) — لحد 4 ميجا. الملفات مبتتمسحش بعد الرفع.</p></div>
                </ActionForm>
              </div>)}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="بيانات العقد">
            <dl className="space-y-2 text-sm">
              {([["العميل", c.client_name], ["النشاط", c.business_name], ["رقم الجوال", c.phone], ["المتجر", c.store_url], ["السيلز", c.sales_name], ["التلي سيلز (مصدر العميل)", c.tele_name],
                ["الباقة", PACKAGE[c.package]], ["المدة", c.duration_months ? `${c.duration_months} شهر` : null], ["تاريخ البداية", c.start_date ? fmtDate(c.start_date) : null], ["تاريخ النهاية", c.end_date ? fmtDate(c.end_date) : null],
                ["تاريخ الاتفاق", c.agreed_at ? fmtDate(c.agreed_at) : null], ["طريقة الدفع", c.payment_method ? PAYMENT_METHOD[c.payment_method] : null], ["شروط الدفع", c.payment_terms], ["ملاحظات", c.notes],
                ["أنشأه", `${c.created_by_name} · ${fmtDateTime(c.created_at)}`]] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="shrink-0 text-ink-500">{k}</dt><dd className="break-words text-end" dir="auto">{v || "—"}</dd></div>))}
            </dl>
          </Card>
          {canWrite && (
            <Card title="إرسال للمالية">
              {signed.length === 0 ? <p className="text-sm text-warn">ارفع ملف العقد الموقّع الأول من «الملفات».</p> : (
                <ActionForm action={submitContractAction} submit="إرسال العقد للمالية" hiddenOnOk>
                  <Hidden name="contract_id" value={id} />
                  <p className="text-sm text-ink-500">بعد الإرسال الصفقة هتتنقل لـ«تم الاتفاق / التوقيع»، والعقد مش هيتعدّل غير لو المالية رجّعته.</p>
                </ActionForm>)}
            </Card>)}
          {isFinance && c.status === "submitted" && (
            <Card title="مراجعة المالية">
              <ActionForm action={returnContractAction} submit="إرجاع العقد للسيلز للتعديل" tone="quiet" hiddenOnOk>
                <Hidden name="contract_id" value={id} />
                <TextArea label="سبب الإرجاع" name="reason" rows={2} required />
              </ActionForm>
              <p className="mt-3 text-xs text-ink-500">تسجيل الدفعات والاعتماد المالي بيتضافوا في الخطوة الجاية.</p>
            </Card>)}
        </div>
      </div>
    </>
  );
}
