"use client";
import { PhoneField } from "@/components/phone-field";
import { useActionState, useEffect, useRef, useState } from "react";
import { createLeadAction, requestReviewAction } from "@/server/actions";
import { ActionForm, Alert, CheckGroup, Field, Hidden, SelectField, TextArea, inputCls } from "./forms";
import { Progress } from "./ui";
import { CALL_STATUSES, LEAD_STATUS, NEEDS_FOLLOWUP, SERVICES, SOURCES, TEMPERATURE } from "@/lib/labels";
import type { FormState } from "@/lib/form";

const KIND_AR: Record<string, string> = { phone: "رقم الجوال", store: "المتجر" };
const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000");

export function Toast({ t }: { t: NonNullable<FormState["toast"]> }) {
  const tone = t.level === "great" ? "border-burgundy-600 bg-burgundy-600 text-white" : t.level === "good" ? "border-ok/40 bg-ok/10" : "border-line bg-white";
  const target = t.goal ?? t.next;
  return (
    <div role="status" aria-live="polite" className={`rounded-lg border p-4 ${tone}`}>
      <p className={`font-bold ${t.level === "great" ? "text-lg" : ""}`}>{t.title}</p>
      <p className={`text-sm ${t.level === "great" ? "text-burgundy-100" : "text-ink-500"}`}>{t.text}</p>
      {t.achievements.length > 0 && <p className="mt-1 flex flex-wrap gap-1.5">{t.achievements.map((a) => <span key={a} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-burgundy-700">★ {a}</span>)}</p>}
      <div className="mt-3"><Progress value={t.count} max={target} />
        <p className={`mt-1 text-xs ${t.level === "great" ? "text-burgundy-100" : "text-ink-500"}`}>{t.count} / {target} {t.goal ? "(هدفك الشهري)" : "(الإنجاز القادم)"}</p></div>
    </div>
  );
}

export function LeadForm({ legacy = false, tz = "" }: { legacy?: boolean; tz?: string }) {
  const [state, action, pending] = useActionState(createLeadAction, {} as FormState);
  const [rid, setRid] = useState(uuid);
  const [status, setStatus] = useState("New Lead");
  const [formKey, setFormKey] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.toast) { setRid(uuid()); setStatus("New Lead"); setFormKey((k) => k + 1); }
  }, [state]);
  useEffect(() => { nameRef.current?.focus(); }, [formKey]);
  const v = state.values ?? {};
  const d = (k: string) => v[k] ?? "";
  const needsFollow = NEEDS_FOLLOWUP.includes(status);

  return (
    <div className="space-y-4">
      {state.toast && <Toast t={state.toast} />}
      {state.dup && (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn/5 p-4">
          <p className="font-semibold text-warn">
            تنبيه: هذا العميل مسجل بالفعل{state.dup.owner_name ? <> لدى <span className="underline">{state.dup.owner_name}</span></> : null}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {state.dup.existing_name && <>العميل المسجل: <b>{state.dup.existing_name}</b>{state.dup.existing_status ? <> · الحالة: {LEAD_STATUS[state.dup.existing_status] ?? state.dup.existing_status}</> : null}{state.dup.existing_added_at ? <> · أضيف {String(state.dup.existing_added_at).slice(0, 10)}</> : null}. </>}
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
      <form key={formKey} action={action} className="space-y-4">
        {state.error && <Alert kind="error">{state.error}</Alert>}
        <input type="hidden" name="request_id" value={rid} suppressHydrationWarning />
        {legacy && <input type="hidden" name="mode" value="existing" />}
        <section className="grid gap-4 rounded-lg border border-line bg-white p-5 md:grid-cols-2 xl:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">اسم العميل (اختياري)</span>
            <input ref={nameRef} name="name" autoFocus autoComplete="off" defaultValue={d("name")} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">رقم الجوال <span className="text-burgundy-600">*</span></span>
            <PhoneField name="phone" required defaultValue={d("phone")} />
          </label>
          {!legacy && (<>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">المصدر <span className="text-burgundy-600">*</span></span>
              <select name="source" required defaultValue={d("source") || "cold_call"} className={inputCls}>
                {Object.entries(SOURCES).filter(([k]) => k !== "legacy" && k !== "unknown").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">الحالة</span>
              <select name="lead_status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                {["New Lead", ...CALL_STATUSES].map((k) => <option key={k} value={k}>{LEAD_STATUS[k]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">درجة التواصل</span>
              <select name="lead_temperature" defaultValue={d("lead_temperature")} className={inputCls}>
                <option value="">غير مصنّف</option>
                {Object.entries(TEMPERATURE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            {needsFollow && (<>
              <label className="block"><span className="mb-1 block text-sm font-medium">موعد المتابعة {tz && `— ${tz}`} <span className="text-burgundy-600">*</span></span>
                <input type="datetime-local" name="next_followup" required defaultValue={d("next_followup")} className={inputCls} /></label>
              <label className="block"><span className="mb-1 block text-sm font-medium">سبب المتابعة <span className="text-burgundy-600">*</span></span>
                <input name="followup_reason" required defaultValue={d("followup_reason")} className={inputCls} /></label>
            </>)}
            <div className="md:col-span-2 xl:col-span-3"><label className="mb-1 block text-sm font-medium" htmlFor="call_notes">ملاحظة سريعة</label>
              <input id="call_notes" name="call_notes" autoComplete="off" defaultValue={d("call_notes")} className={inputCls} /></div>
          </>)}
        </section>
        <details className="rounded-lg border border-line bg-white" open={Boolean(d("store_url") || d("business_name") || d("alt_phone"))}>
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">تفاصيل إضافية (اختياري، يمكن استكمالها لاحقًا)</summary>
          <div className="grid gap-4 border-t border-line p-5 md:grid-cols-2 xl:grid-cols-3">
            <Field label="اسم النشاط التجاري" name="business_name" defaultValue={d("business_name")} />
            <Field label="رابط المتجر" name="store_url" dir="ltr" placeholder="https://" defaultValue={d("store_url")} hint="يمكن إدخال أكثر من رابط. تُفحص الروابط لمنع التكرار." />
            <label className="block"><span className="mb-1 block text-sm font-medium">رقم بديل</span><PhoneField name="alt_phone" defaultValue={d("alt_phone")} /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium">واتساب</span><PhoneField name="whatsapp" defaultValue={d("whatsapp")} /></label>
            <Field label="النشاط" name="industry" defaultValue={d("industry")} />
            <Field label="الشخص المسؤول" name="contact_person" defaultValue={d("contact_person")} />
            <Field label="المدينة" name="city" defaultValue={d("city")} />
            <Field label="الدولة" name="country" defaultValue={d("country") || "SA"} dir="ltr" />
            {!legacy && <div className="md:col-span-2 xl:col-span-3"><CheckGroup label="الخدمات المطلوبة" name="services" options={Object.entries(SERVICES).map(([value, label]) => ({ value, label }))} /></div>}
            {!needsFollow && !legacy && (<>
              <Field label={`موعد المتابعة${tz ? ` — ${tz}` : ""} — اختياري`} name="next_followup" type="datetime-local" defaultValue={d("next_followup")} />
              <Field label="سبب المتابعة" name="followup_reason" defaultValue={d("followup_reason")} />
            </>)}
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" name="intent" value="again" disabled={pending}
            className="rounded-md bg-burgundy-600 px-5 py-2 text-sm font-semibold text-white hover:bg-burgundy-700 disabled:opacity-60">
            {pending ? "جارٍ الحفظ…" : legacy ? "إضافة العميل القائم" : "حفظ وإضافة عميل آخر"}
          </button>
          {!legacy && <button type="submit" name="intent" value="open" disabled={pending}
            className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-cream disabled:opacity-60">حفظ وفتح الملف</button>}
          <span className="text-xs text-ink-500">يُسجَّل اسمك ووقت التسجيل تلقائيًا · المصدر لا يتغير بعد الحفظ</span>
        </div>
      </form>
    </div>
  );
}
