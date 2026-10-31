"use client";
import { PhoneField } from "@/components/phone-field";
import { useActionState, useEffect, useRef, useState } from "react";
import { createLeadAction } from "@/server/actions";
import { Toast } from "@/components/lead-form";
import { inputCls } from "@/components/forms";
import { LEAD_STATUS, SOURCES, TEMPERATURE } from "@/lib/labels";
import type { FormState } from "@/lib/form";
import Link from "next/link";

type DupHit = { exists: boolean; visible: boolean; lead_id?: string; name?: string; status?: string; owner?: string };
type DupResult = { phone?: DupHit; store?: DupHit };

/** Debounced live duplicate check (same normalisation + same database as saving). Read-only; shows only what the user may see. */
function useDupCheck(phone: string, store: string) {
  const [res, setRes] = useState<DupResult>({});
  useEffect(() => {
    const p = phone.trim(), s = store.trim();
    if (p.length < 6 && s.length < 4) { setRes({}); return; }
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/dupcheck?${new URLSearchParams({ phone: p, store: s })}`, { signal: ctl.signal, cache: "no-store" });
        const j = await r.json(); if (j.ok) setRes(j.result ?? {});
      } catch { /* offline / aborted: the server still checks on save */ }
    }, 450);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [phone, store]);
  return res;
}
function DupNote({ hit, what }: { hit?: DupHit; what: string }) {
  if (!hit?.exists) return null;
  return (
    <p role="status" data-dup={what} className="mt-1 rounded border border-warn/40 bg-warn/5 px-2 py-1 text-[11px] leading-4 text-warn">
      ⚠ {what} مسجل بالفعل{hit.visible && hit.name ? <> باسم «{hit.name}»{hit.owner ? ` لدى ${hit.owner}` : ""}{hit.lead_id && <> — <Link href={`/leads/${hit.lead_id}`} className="underline">فتح</Link></>}</> : null}.
    </p>);
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000");
const STATUSES = ["New Lead", "Contacted", "No Answer", "Interested", "Not Interested", "Qualified Lead"];

/** One-line add form above the leads table. Only name + phone are required; the date/time and the employee are stamped by the server. */
export function QuickAdd({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createLeadAction, {} as FormState);
  const [rid, setRid] = useState(uuid);
  const [key, setKey] = useState(0);
  const [more, setMore] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [phoneVal, setPhoneVal] = useState(""); const [storeVal, setStoreVal] = useState("");
  const dup = useDupCheck(phoneVal, storeVal);
  useEffect(() => { if (state.toast) { setRid(uuid()); setKey((k) => k + 1); setPhoneVal(""); setStoreVal(""); } }, [state]);
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
          <PhoneField name="phone" required compact defaultValue={v.phone ?? ""} onValue={setPhoneVal} /><DupNote hit={dup.phone} what="الرقم" /></label>
        <label className="col-span-2 lg:col-span-1"><span className="mb-1 block text-xs font-medium">رابط المتجر (اختياري)</span>
          <input name="store_url" dir="ltr" autoComplete="off" defaultValue={v.store_url ?? ""} onChange={(e) => setStoreVal(e.target.value)} className={inputCls} placeholder="https://" /><DupNote hit={dup.store} what="الرابط" /></label>
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
