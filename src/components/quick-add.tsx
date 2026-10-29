"use client";
import { PhoneField } from "@/components/phone-field";
import { useActionState, useEffect, useRef, useState } from "react";
import { createLeadAction } from "@/server/actions";
import { Toast } from "@/components/lead-form";
import { inputCls } from "@/components/forms";
import { LEAD_STATUS, SOURCES, TEMPERATURE } from "@/lib/labels";
import type { FormState } from "@/lib/form";

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000");
const STATUSES = ["New Lead", "Contacted", "No Answer", "Interested", "Not Interested", "Qualified Lead"];

/** One-line add form above the leads table. Only name + phone are required; the date/time and the employee are stamped by the server. */
export function QuickAdd({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createLeadAction, {} as FormState);
  const [rid, setRid] = useState(uuid);
  const [key, setKey] = useState(0);
  const [more, setMore] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state.toast) { setRid(uuid()); setKey((k) => k + 1); } }, [state]);
  useEffect(() => { if (key > 0) nameRef.current?.focus(); }, [key]);
  const v = state.values ?? {};
  return (
    <section className="mb-4 rounded-lg border border-line bg-white p-3" aria-label="إضافة عميل سريعة">
      {state.toast && <div className="mb-3"><Toast t={state.toast} /></div>}
      {state.error && <p role="alert" className="mb-3 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.dup && (
        <p role="alert" className="mb-3 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
          <span className="font-semibold text-warn">هذا الرقم مسجل بالفعل{state.dup.existing_name ? ` باسم «${state.dup.existing_name}»` : ""}{state.dup.owner_name ? ` لدى ${state.dup.owner_name}` : ""}{state.dup.existing_status ? ` (الحالة: ${LEAD_STATUS[state.dup.existing_status] ?? state.dup.existing_status})` : ""}.</span> لم يُنشأ سجل جديد، وسُجلت محاولتك. لو تراه يخصك افتح «تسجيل عميل جديد» واطلب مراجعة من المدير.
        </p>)}
      <form key={key} action={action} className="grid grid-cols-2 items-end gap-2 lg:grid-cols-[1.3fr_1fr_1.3fr_auto]">
        <input type="hidden" name="request_id" value={rid} suppressHydrationWarning />
        <label className="col-span-2 lg:col-span-1"><span className="mb-1 block text-xs font-medium">اسم العميل (اختياري)</span>
          <input ref={nameRef} name="name" autoComplete="off" defaultValue={v.name ?? ""} className={inputCls} placeholder="اسم العميل" /></label>
        <label className="col-span-2 lg:col-span-1"><span className="mb-1 block text-xs font-medium">رقم الجوال <b className="text-burgundy-600">*</b></span>
          <PhoneField name="phone" required compact defaultValue={v.phone ?? ""} /></label>
        <label className="col-span-2 lg:col-span-1"><span className="mb-1 block text-xs font-medium">رابط المتجر (اختياري)</span>
          <input name="store_url" dir="ltr" autoComplete="off" defaultValue={v.store_url ?? ""} className={inputCls} placeholder="https://" /></label>
        <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
          <button disabled={pending} className="flex-1 rounded-md bg-burgundy-600 px-5 py-2 text-sm font-semibold text-white hover:bg-burgundy-700 disabled:opacity-60">{pending ? "جارٍ الحفظ…" : "+ إضافة"}</button>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-cream">{more ? "أقل" : "المزيد"}</button>
        </div>
        <div className={`${more ? "grid" : "hidden"} col-span-2 grid-cols-2 gap-2 lg:col-span-4 lg:grid-cols-4`}>
          <label><span className="mb-1 block text-xs font-medium">الحالة</span>
            <select name="lead_status" defaultValue={v.lead_status ?? "New Lead"} className={inputCls}>{STATUSES.map((k) => <option key={k} value={k}>{LEAD_STATUS[k]}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-medium">الدرجة</span>
            <select name="lead_temperature" defaultValue={v.lead_temperature ?? ""} className={inputCls}><option value="">غير مصنّف</option>{Object.entries(TEMPERATURE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-medium">المصدر</span>
            <select name="source" defaultValue={v.source ?? "cold_call"} className={inputCls}>{Object.entries(SOURCES).filter(([k]) => k !== "legacy" && k !== "unknown").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-medium">ملاحظة</span>
            <input name="call_notes" autoComplete="off" defaultValue={v.call_notes ?? ""} className={inputCls} /></label>
        </div>
      </form>
      <p className="mt-2 text-xs text-ink-500">تاريخ ووقت التسجيل واسمك بيتسجلوا تلقائيًا ({today}). الرقم هو المطلوب الوحيد، ويتفحص التكرار قبل الحفظ.</p>
    </section>
  );
}
