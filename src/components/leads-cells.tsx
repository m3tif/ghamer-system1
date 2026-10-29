"use client";
import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { ReturnTo } from "@/components/flash";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { deleteLeadAction, deleteMonthAction, handoffAction, hideLeadAction, hideMonthAction, quickEditAction } from "@/server/actions";
import { LEAD_STATUS, TEMPERATURE } from "@/lib/labels";

const EDIT_STATUS = ["New Lead", "Contacted", "No Answer", "Interested", "Not Interested", "Follow-up Required", "Qualified Lead", "Invalid Contact"];

export function CopyPhone({ phone }: { phone: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={`tel:${phone}`} dir="ltr" className="font-mono text-[13px] text-charcoal hover:text-burgundy-600 hover:underline">{phone}</a>
      <button type="button" aria-label="نسخ رقم الهاتف" title="نسخ الرقم"
        onClick={() => { navigator.clipboard?.writeText(phone).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}
        className="rounded border border-line px-1.5 text-[11px] text-ink-500 hover:bg-cream">{done ? "تم ✓" : "نسخ"}</button>
    </span>
  );
}

export type EditableLead = { id: string; name: string; lead_status: string; lead_temperature: string | null; call_notes: string | null; next_followup_at: string | null; handed_off: boolean };

export function QuickEdit({ lead, children, className = "", followupLabel }: { lead: EditableLead; children: React.ReactNode; className?: string; followupLabel?: string }) {
  const locked = ["Pending Sales Review", "Accepted by Sales", "Meeting Scheduled", "Meeting Completed", "Rejected by Sales"].includes(lead.lead_status);
  return (
    <Dialog trigger={children} title={`تعديل: ${lead.name}`} triggerClass={className} tone="quiet">
      <ActionForm action={quickEditAction} submit="حفظ" className="grid gap-4 md:grid-cols-2">
        <Hidden name="lead_id" value={lead.id} />
        {locked
          ? <div><p className="mb-1 text-sm font-medium">الحالة</p><p className="rounded-md bg-cream px-3 py-2 text-sm">{LEAD_STATUS[lead.lead_status]} <span className="text-xs text-ink-500">(يديرها مسار السيلز)</span></p></div>
          : <SelectField label="الحالة" name="status" defaultValue={lead.lead_status} options={EDIT_STATUS.map((k) => ({ value: k, label: LEAD_STATUS[k] }))} />}
        <SelectField label="درجة العميل" name="temperature" defaultValue={lead.lead_temperature ?? ""} empty="غير مصنّف" options={Object.entries(TEMPERATURE).map(([value, label]) => ({ value, label }))} />
        <div className="md:col-span-2"><TextArea label="الملاحظات" name="notes" rows={4} defaultValue={lead.call_notes ?? ""} /></div>
        <Field label="موعد متابعة جديد (اختياري)" name="next_followup" type="datetime-local" hint={followupLabel ? `الحالي: ${followupLabel}` : "مطلوب مع «يحتاج متابعة»"} />
        <Field label="سبب المتابعة" name="followup_reason" />
      </ActionForm>
    </Dialog>
  );
}

export function SendToSales({ leadId, name, currentStatus, reps, className = "" }: {
  leadId: string; name: string; currentStatus: string; reps: { id: string; full_name: string }[]; className?: string;
}) {
  const needsStatus = !["Interested", "Qualified Lead", "Rejected by Sales"].includes(currentStatus);
  return (
    <Dialog trigger="إرسال للسيلز" title={`إرسال إلى السيلز: ${name}`} tone="primary" triggerClass={className}>
      <ActionForm action={handoffAction} submit="إرسال العميل" className="grid gap-4">
        <Hidden name="lead_id" value={leadId} />
        {needsStatus && <SelectField label="تقييم العميل قبل الإرسال" name="status" required defaultValue="Interested"
          options={[{ value: "Interested", label: LEAD_STATUS["Interested"] }, { value: "Qualified Lead", label: LEAD_STATUS["Qualified Lead"] }]}
          hint={`الحالة الحالية: ${LEAD_STATUS[currentStatus] ?? currentStatus}. ستُحدَّث وتُسجَّل في سجل العميل.`} />}
        <SelectField label="المستلم" name="to" required defaultValue="admin" options={[{ value: "admin", label: "إرسال للإدارة لتوزيعه" }, ...reps.map((r) => ({ value: r.id, label: r.full_name }))]} />
        <TextArea label="ملاحظة للسيلز" name="note" rows={3} placeholder="مثال: العميل مهتم بإدارة السوشيال ميديا ويفضل التواصل مساءً" />
        <p className="text-xs text-ink-500">لا يُعتبر العميل مقبولًا بمجرد الإرسال. القرار (قبول أو رفض) عند السيلز، وتتابع النتيجة من «تم تحويلها إلى السيلز».</p>
      </ActionForm>
    </Dialog>
  );
}

export function HideLead({ leadId, name, hidden, className = "" }: { leadId: string; name: string; hidden: boolean; className?: string }) {
  return (
    <Dialog trigger={hidden ? "إظهار" : "إخفاء"} title={`${hidden ? "إظهار" : "إخفاء"}: ${name}`} triggerClass={className} tone={hidden ? "quiet" : "danger"}>
      <ActionForm action={hideLeadAction} submit={hidden ? "إظهار العميل للموظفين" : "إخفاء العميل عن الموظفين"} className="grid gap-4">
        <Hidden name="lead_id" value={leadId} /><ReturnTo /><Hidden name="hide" value={hidden ? "0" : "1"} />
        <p className="text-sm text-ink-500">{hidden ? "سيظهر العميل من جديد عند الموظف." : "لن يظهر العميل ولا صفقته واجتماعاته عند الموظفين. لا يُحذف شيء، وتقدر تُظهره في أي وقت، وتبقى المدير والإدارة تشوفه."}</p>
        {!hidden && <TextArea label="السبب (اختياري)" name="reason" rows={2} />}
      </ActionForm>
    </Dialog>
  );
}

export function HideMonth({ emp, empName, month, hide, count }: { emp: string; empName: string; month: string; hide: boolean; count: number }) {
  return (
    <Dialog trigger={hide ? `إخفاء عملاء ${empName} لشهر ${month}` : `إظهار عملاء ${empName} لشهر ${month}`} title={hide ? "إخفاء شهر كامل" : "إظهار شهر كامل"} tone={hide ? "danger" : "quiet"}>
      <ActionForm action={hideMonthAction} submit={hide ? "إخفاء كل عملاء هذا الشهر" : "إظهار كل عملاء هذا الشهر"} className="grid gap-4">
        <Hidden name="emp" value={emp} /><Hidden name="month" value={month} /><Hidden name="hide" value={hide ? "1" : "0"} />
        <p className="text-sm">{hide ? `سيُخفى عن ${empName} كل ما أضافه في ${month}` : `سيُظهر لـ ${empName} كل ما أُخفي من إضافاته في ${month}`}{count ? ` (${count} في القائمة الحالية)` : ""}. لا يُحذف شيء ويمكن التراجع.</p>
        {hide && <TextArea label="السبب (اختياري)" name="reason" rows={2} />}
      </ActionForm>
    </Dialog>
  );
}

export function DeleteLead({ clientId, name, className = "" }: { clientId: string; name: string; className?: string }) {
  return (
    <Dialog trigger="حذف" title={`حذف نهائي: ${name}`} triggerClass={className} tone="danger">
      <ActionForm action={deleteLeadAction} submit="حذف العميل نهائيًا" className="grid gap-4">
        <Hidden name="client_id" value={clientId} /><ReturnTo />
        <p className="text-sm text-bad">سيُحذف العميل وكل ما يخصه (النشاطات، المتابعات، الاجتماعات، الصفقة، التحويلات) ولا يمكن التراجع. الرقم يتحرر ويمكن تسجيله من جديد. العملية تُسجَّل في سجل التدقيق.</p>
        <TextArea label="السبب" name="reason" rows={2} required />
        <Field label="اكتب كلمة «حذف» للتأكيد" name="confirm" required />
      </ActionForm>
    </Dialog>
  );
}

export function DeleteMonth({ emp, empName, month, count }: { emp: string; empName: string; month: string; count: number }) {
  return (
    <Dialog trigger={`حذف نهائي لعملاء ${empName} لشهر ${month}`} title="حذف شهر كامل نهائيًا" tone="danger">
      <ActionForm action={deleteMonthAction} submit="حذف كل عملاء هذا الشهر نهائيًا" className="grid gap-4">
        <Hidden name="emp" value={emp} /><Hidden name="month" value={month} /><ReturnTo />
        <p className="text-sm text-bad">سيُحذف نهائيًا كل ما أضافه {empName} في {month}{count ? ` (${count} في القائمة الحالية)` : ""} مع كل ما يخصه، ولا يمكن التراجع.</p>
        <TextArea label="السبب" name="reason" rows={2} required />
        <Field label="اكتب كلمة «حذف» للتأكيد" name="confirm" required />
      </ActionForm>
    </Dialog>
  );
}
