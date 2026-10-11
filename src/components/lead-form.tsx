"use client";
import { useActionState } from "react";
import { createLeadAction, requestReviewAction } from "@/server/actions";
import { ActionForm, Alert, CheckGroup, Field, Hidden, SelectField, SubmitButton, TextArea, inputCls } from "./forms";
import { CALL_STATUSES, LEAD_STATUS, SERVICES, SOURCES } from "@/lib/labels";
import type { FormState } from "@/lib/form";

const KIND_AR: Record<string, string> = { phone: "رقم الجوال", store: "المتجر" };

export function LeadForm({ canPickStatus = true, legacy = false }: { canPickStatus?: boolean; legacy?: boolean }) {
  const [state, action, pending] = useActionState(createLeadAction, {} as FormState);
  const v = state.values ?? {};
  const d = (k: string) => v[k] ?? "";
  return (
    <div className="space-y-5">
      {state.dup && (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn/5 p-4">
          <p className="font-semibold text-warn">
            تنبيه: هذا العميل مسجل بالفعل{state.dup.owner_name ? <> لدى <span className="underline">{state.dup.owner_name}</span></> : null}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            التطابق في: {state.dup.matched_kinds.map((k) => KIND_AR[k] ?? k).join("، ")}. لم يتم إنشاء سجل جديد.
            {state.dup.ambiguous && " تم العثور على أكثر من عميل مطابق، يلزم مراجعة المدير."}
          </p>
          <div className="mt-3 border-t border-warn/20 pt-3">
            <p className="mb-2 text-sm font-medium">ترى أن العميل يخصك؟ اطلب مراجعة من المدير:</p>
            <ActionForm action={requestReviewAction} submit="إرسال طلب المراجعة" tone="quiet" hiddenOnOk>
              <Hidden name="existing_client_id" value={state.dup.existing_client_id} />
              <Hidden name="attempted" value={JSON.stringify(state.dup.attempted)} />
              <Field label="سبب الطلب" name="reason" required placeholder="مثال: تواصلت مع العميل بتاريخ …" />
            </ActionForm>
          </div>
        </div>
      )}
      <form action={action} className="space-y-5">
        {state.error && <Alert kind="error">{state.error}</Alert>}
        {legacy && <input type="hidden" name="mode" value="existing" />}
        <section className="grid gap-4 rounded-lg border border-line bg-white p-5 md:grid-cols-2">
          <h2 className="md:col-span-2 text-base font-bold">بيانات العميل</h2>
          <Field label="اسم العميل" name="name" required defaultValue={d("name")} />
          <Field label="اسم النشاط التجاري" name="business_name" defaultValue={d("business_name")} />
          <Field label="رقم الجوال" name="phone" required dir="ltr" placeholder="05xxxxxxxx" defaultValue={d("phone")}
            hint="يُوحَّد تلقائيًا للصيغة الدولية لكشف التكرار" />
          <Field label="رقم بديل" name="alt_phone" dir="ltr" defaultValue={d("alt_phone")} />
          <Field label="واتساب" name="whatsapp" dir="ltr" defaultValue={d("whatsapp")} />
          <Field label="رابط المتجر" name="store_url" dir="ltr" placeholder="https://" defaultValue={d("store_url")} hint="يمكن إدخال أكثر من رابط، كل رابط في سطر أو مفصول بفاصلة" />
          <Field label="النشاط" name="industry" defaultValue={d("industry")} />
          <Field label="الشخص المسؤول" name="contact_person" defaultValue={d("contact_person")} />
          <Field label="الدولة" name="country" defaultValue={d("country") || "SA"} dir="ltr" />
          <Field label="المدينة" name="city" defaultValue={d("city")} />
        </section>
        {!legacy && (
          <section className="grid gap-4 rounded-lg border border-line bg-white p-5 md:grid-cols-2">
            <h2 className="md:col-span-2 text-base font-bold">التواصل</h2>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">مصدر العميل <span className="text-burgundy-600">*</span></span>
              <select name="source" required defaultValue={d("source")} className={inputCls}>
                <option value="">اختر المصدر</option>
                {Object.entries(SOURCES).filter(([k]) => k !== "legacy" && k !== "unknown").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <span className="mt-1 block text-xs text-ink-500">لا يمكن تغيير المصدر بعد التسجيل إلا بصلاحية إدارية وسبب مكتوب</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">الحالة</span>
              <select name="lead_status" defaultValue={d("lead_status") || "New"} className={inputCls}>
                {["New", ...CALL_STATUSES].map((k) => <option key={k} value={k}>{LEAD_STATUS[k]}</option>)}
              </select>
            </label>
            <div className="md:col-span-2"><CheckGroup label="الخدمات المطلوبة" name="services" options={Object.entries(SERVICES).map(([value, label]) => ({ value, label }))} /></div>
            <div className="md:col-span-2"><label className="mb-1 block text-sm font-medium" htmlFor="call_notes">ملاحظات المكالمة</label>
              <textarea id="call_notes" name="call_notes" rows={3} defaultValue={d("call_notes")} className={inputCls} /></div>
            <label className="block"><span className="mb-1 block text-sm font-medium">موعد المتابعة</span>
              <input type="datetime-local" name="next_followup" defaultValue={d("next_followup")} className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium">سبب المتابعة</span>
              <input name="followup_reason" defaultValue={d("followup_reason")} className={inputCls} /></label>
          </section>
        )}
        <SubmitButton pending={pending}>{legacy ? "إضافة العميل القائم" : "تسجيل العميل"}</SubmitButton>
      </form>
    </div>
  );
}
