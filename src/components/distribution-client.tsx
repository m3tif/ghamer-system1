"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls } from "@/components/forms";

export function DistributionUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/distribution/upload", { method: "POST", body: new FormData(e.currentTarget) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) { setErr(j.error ?? "فشل قراءة الجدول"); lock.current = false; setBusy(false); return; }
      router.push(`/bulk-distribution/${j.id}`);
    } catch { setErr("تعذّر الاتصال بالخادم. حاول مرة أخرى"); lock.current = false; setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="grid gap-4" encType="multipart/form-data">
      {err && <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{err}</p>}
      <label className="block"><span className="mb-1 block text-sm font-medium">رابط Google Sheets</span>
        <input name="url" dir="ltr" autoComplete="off" placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…" className={inputCls} /></label>
      <p className="-mt-2 text-xs text-ink-500">لازم يكون الجدول مشاركًا «أي شخص لديه الرابط ← مُشاهد». ولا تحتاج مشاركة أي كلمة مرور أو بيانات حساب.</p>
      <div className="text-center text-xs text-ink-500">— أو —</div>
      <label className="block"><span className="mb-1 block text-sm font-medium">ملف Excel / CSV (لو الجدول خاص)</span>
        <input type="file" name="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={inputCls} /></label>
      <div><button disabled={busy} className="rounded-md bg-burgundy-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "جارٍ قراءة الجدول وفحص التكرار…" : "قراءة الجدول ومعاينته"}</button>
        <span className="ms-3 text-xs text-ink-500">لن يُضاف أي عميل قبل أن تحدد الموظفين وتضغط «تأكيد».</span></div>
    </form>
  );
}

type Plan = { employee_id: string; employee_name: string; open_leads: number; planned: number };
type Counts = { c_new: number; c_duplicate: number; c_invalid: number; c_review: number; rows_total: number };

export function DistributionPanel({ id, candidates, initial }: { id: string; candidates: { id: string; full_name: string; open_leads: number }[]; initial: Counts }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan[]>([]); const [counts, setCounts] = useState<Counts>(initial);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [confirming, setConfirming] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const ids = [...sel];
    if (ids.length === 0) { setPlan([]); return; }
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/distribution/${id}/plan?emps=${ids.join(",")}`, { signal: ctl.signal, cache: "no-store" });
        const j = await r.json(); if (r.ok) { setPlan(j.plan); setCounts(j.b); setErr(null); } else setErr(j.error ?? "تعذّر حساب المعاينة");
      } catch { /* aborted */ }
    }, 250);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [sel, id]);
  const toggle = (k: string) => setSel((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  async function confirm() {
    if (lock.current) return;                                   // double-click guard (the database also serialises the batch)
    lock.current = true; setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/distribution/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employees: [...sel] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "فشل التنفيذ. لم يُضف أي شيء"); lock.current = false; setBusy(false); setConfirming(false); router.refresh(); return; }
      router.refresh();
    } catch { setErr("انقطع الاتصال. لم يُضف شيء إلا إذا اكتملت العملية — افتح قائمة العمليات للتأكد"); lock.current = false; setBusy(false); }
  }
  const total = counts.c_new;
  return (
    <div className="space-y-4">
      {err && <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{err}</p>}
      {candidates.length === 0 ? <p className="text-sm text-bad">لا يوجد موظفو Tele Sales نشطون.</p> : (
        <fieldset>
          <legend className="mb-2 flex items-center gap-3 text-sm font-medium">اختر موظفي Tele Sales
            <button type="button" className="text-xs text-burgundy-600 underline" onClick={() => setSel(new Set(candidates.map((c) => c.id)))}>تحديد الكل</button>
            <button type="button" className="text-xs text-burgundy-600 underline" onClick={() => setSel(new Set())}>مسح</button></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {candidates.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-cream">
                <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} data-emp={c.full_name} className="h-4 w-4 accent-burgundy-600" />
                <span className="flex-1">{c.full_name}</span><span className="text-xs text-ink-500">{c.open_leads} عميل حاليًا</span>
              </label>))}
          </div>
        </fieldset>)}
      <div aria-live="polite" data-testid="dist-preview" className="rounded-lg border border-line bg-white p-3 text-sm">
        <p className="mb-2 font-semibold">معاينة التوزيع</p>
        <ul className="mb-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <li>إجمالي العملاء في الملف: <b>{counts.rows_total}</b></li>
          <li>الجدد القابلون للإضافة: <b className="text-ok">{counts.c_new}</b></li>
          <li>المكررون المستبعدون: <b>{counts.c_duplicate}</b></li>
          <li>غير صالح / للمراجعة (مستبعد): <b>{counts.c_invalid + counts.c_review}</b></li>
          <li>عدد الموظفين المحددين: <b>{sel.size}</b></li>
        </ul>
        {sel.size === 0 ? <p className="text-ink-500">حدّد موظفًا واحدًا على الأقل لتظهر حصة كل موظف.</p> : (
          <table className="w-full text-sm"><thead><tr className="text-start text-xs text-ink-500"><th className="py-1 text-start">الموظف</th><th className="text-start">لديه الآن</th><th className="text-start">سيحصل على</th></tr></thead>
            <tbody>{plan.map((p) => <tr key={p.employee_id} className="border-t border-line"><td className="py-1">{p.employee_name}</td><td>{p.open_leads}</td><td><b data-planned>{p.planned}</b></td></tr>)}</tbody></table>)}
      </div>
      {!confirming ? (
        <button type="button" disabled={sel.size === 0 || total === 0} onClick={() => setConfirming(true)} className="rounded-md bg-burgundy-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">تأكيد الاستيراد والتوزيع ({total} عميل)</button>
      ) : (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
          <p className="mb-3">سيُضاف <b>{total}</b> عميل جديد ويُوزَّع على <b>{sel.size}</b> موظف دفعة واحدة. لا يمكن تكرار العملية بعد التنفيذ.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={confirm} className="rounded-md bg-burgundy-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "جارٍ الاستيراد والتوزيع… لا تغلق الصفحة" : "نعم، نفّذ الآن"}</button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-line bg-white px-4 py-2 text-sm">رجوع</button>
          </div>
        </div>)}
    </div>
  );
}
