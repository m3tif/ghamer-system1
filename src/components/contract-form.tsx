"use client";
import { useActionState, useMemo, useState } from "react";
import { saveContractAction } from "@/server/actions";
import { Alert, SubmitButton, inputCls } from "@/components/forms";
import { INSTALLMENT_KIND, PACKAGE, PACKAGE_MONTHS, PAYMENT_METHOD } from "@/lib/labels";
import type { FormState } from "@/lib/form";

type Item = { service: string; description: string; amount: string };
type Inst = { kind: string; due_date: string; amount: string; note: string };
export type ContractInitial = { package: string; duration_months: string; start_date: string; end_date: string; agreed_at: string; discount: string;
  payment_method: string; payment_terms: string; notes: string; items: Item[]; installments: Inst[] };

const num = (v: string) => { const n = Number(String(v).replace(/[,٬\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const sar = (n: number) => new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " ريال";
const addMonths = (d: string, m: number) => { const [y, mo, da] = d.split("-").map(Number); const t = new Date(Date.UTC(y, mo - 1 + m, da)); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const lbl = "mb-1 block text-sm font-medium";

/** The contract form. Prices are FINAL prices (VAT inside); the summary shows how the total splits into value + VAT. */
export function ContractForm({ dealId, services, vat, initial }: { dealId: string; services: { code: string; name_ar: string }[]; vat: number; initial: ContractInitial }) {
  const [state, action, pending] = useActionState(saveContractAction, {} as FormState);
  const [f, setF] = useState(initial);
  const set = <K extends keyof ContractInitial>(k: K, v: ContractInitial[K]) => setF((o) => ({ ...o, [k]: v }));
  const setItem = (i: number, p: Partial<Item>) => set("items", f.items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setInst = (i: number, p: Partial<Inst>) => set("installments", f.installments.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const sum = r2(f.items.reduce((a, x) => a + num(x.amount), 0));
  const total = r2(sum - num(f.discount));
  const net = r2(total / (1 + vat)), vatAmt = r2(total - net);
  const instSum = r2(f.installments.reduce((a, x) => a + num(x.amount), 0));
  const instOff = f.installments.length > 0 && instSum !== total;
  const payload = useMemo(() => JSON.stringify(f), [f]);

  const pickPackage = (p: string) => {
    const m = PACKAGE_MONTHS[p];
    setF((o) => ({ ...o, package: p, duration_months: m ? String(m) : o.duration_months, end_date: m && o.start_date ? addMonths(o.start_date, m) : o.end_date }));
  };
  const pickStart = (d: string) => setF((o) => ({ ...o, start_date: d, end_date: d && num(o.duration_months) > 0 ? addMonths(d, num(o.duration_months)) : o.end_date }));
  const pickMonths = (m: string) => setF((o) => ({ ...o, duration_months: m, end_date: o.start_date && num(m) > 0 ? addMonths(o.start_date, num(m)) : o.end_date }));
  const split = (n: number) => {   // n equal instalments, one month apart, the last one takes the rounding difference
    if (!(total > 0)) return;
    const start = f.start_date || new Date().toISOString().slice(0, 10), each = Math.floor((total / n) * 100) / 100;
    set("installments", Array.from({ length: n }, (_, i) => {
      const [y, mo, da] = start.split("-").map(Number); const due = new Date(Date.UTC(y, mo - 1 + i, da)).toISOString().slice(0, 10);
      return { kind: n === 1 ? "full" : i === 0 ? "down_payment" : "installment", due_date: due, amount: String(i === n - 1 ? r2(total - each * (n - 1)) : each), note: "" };
    }));
  };

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="deal_id" value={dealId} /><input type="hidden" name="payload" value={payload} />
      {state.error && <Alert kind="error">{state.error}</Alert>}

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="mb-1 font-bold">الخدمات والأسعار</h2>
        <p className="mb-3 text-xs text-ink-500">اكتب <b>السعر النهائي</b> لكل خدمة (شامل ضريبة القيمة المضافة). السيستم بيطلّع الضريبة من جواه لوحده.</p>
        <div className="space-y-2">
          {f.items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line/70 p-2 md:grid-cols-[14rem_1fr_10rem_auto] md:border-0 md:p-0">
              <select aria-label={`الخدمة ${i + 1}`} value={it.service} onChange={(e) => setItem(i, { service: e.target.value })} className={inputCls} required>
                <option value="">اختر الخدمة</option>{services.map((s) => <option key={s.code} value={s.code}>{s.name_ar}</option>)}</select>
              <input aria-label={`وصف الخدمة ${i + 1}`} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="وصف مختصر (اختياري)" maxLength={500} className={inputCls} />
              <input aria-label={`سعر الخدمة ${i + 1}`} value={it.amount} onChange={(e) => setItem(i, { amount: e.target.value })} inputMode="decimal" dir="ltr" placeholder="السعر النهائي" className={inputCls + " tabular-nums"} required />
              <button type="button" onClick={() => set("items", f.items.filter((_, j) => j !== i))} disabled={f.items.length === 1}
                className="rounded-md border border-line px-3 py-2 text-sm text-bad hover:bg-bad/5 disabled:opacity-40">حذف</button>
            </div>))}
        </div>
        <button type="button" onClick={() => set("items", [...f.items, { service: "", description: "", amount: "" }])} className="mt-3 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">+ إضافة خدمة</button>
        <div className="mt-4 grid gap-3 md:grid-cols-[12rem_1fr]">
          <div><label className={lbl} htmlFor="discount">خصم (ريال)</label>
            <input id="discount" value={f.discount} onChange={(e) => set("discount", e.target.value)} inputMode="decimal" dir="ltr" className={inputCls + " tabular-nums"} placeholder="0" /></div>
          <dl className="rounded-md bg-cream/60 p-3 text-sm" aria-live="polite">
            <div className="flex justify-between"><dt>مجموع الخدمات</dt><dd className="tabular-nums">{sar(sum)}</dd></div>
            {num(f.discount) > 0 && <div className="flex justify-between"><dt>الخصم</dt><dd className="tabular-nums">− {sar(num(f.discount))}</dd></div>}
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-base font-bold"><dt>الإجمالي النهائي (اللي العميل هيدفعه)</dt><dd className="tabular-nums">{sar(total)}</dd></div>
            <div className="mt-1 flex justify-between text-xs text-ink-500"><dt>منه قيمة الخدمات قبل الضريبة</dt><dd className="tabular-nums">{sar(net)}</dd></div>
            <div className="flex justify-between text-xs text-ink-500"><dt>ومنه ضريبة القيمة المضافة ({Math.round(vat * 100)}%)</dt><dd className="tabular-nums">{sar(vatAmt)}</dd></div>
          </dl>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="mb-3 font-bold">مدة العقد</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <div><label className={lbl} htmlFor="package">الباقة</label>
            <select id="package" value={f.package} onChange={(e) => pickPackage(e.target.value)} className={inputCls}>{Object.entries(PACKAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className={lbl} htmlFor="months">المدة بالشهور</label>
            <input id="months" type="number" min={1} max={120} value={f.duration_months} onChange={(e) => pickMonths(e.target.value)} className={inputCls} /></div>
          <div><label className={lbl} htmlFor="start">تاريخ البداية <span className="text-burgundy-600">*</span></label>
            <input id="start" type="date" value={f.start_date} onChange={(e) => pickStart(e.target.value)} className={inputCls} required /></div>
          <div><label className={lbl} htmlFor="end">تاريخ النهاية <span className="text-burgundy-600">*</span></label>
            <input id="end" type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} className={inputCls} required /></div>
          <div><label className={lbl} htmlFor="agreed">تاريخ الاتفاق</label>
            <input id="agreed" type="date" value={f.agreed_at} onChange={(e) => set("agreed_at", e.target.value)} className={inputCls} /></div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="mb-1 font-bold">الدفع</h2>
        <p className="mb-3 text-xs text-ink-500">لو مكتبتش أقساط، العقد هيتسجل دفعة واحدة كاملة بتاريخ البداية.</p>
        <div className="mb-3 grid gap-3 md:grid-cols-[14rem_1fr]">
          <div><label className={lbl} htmlFor="method">طريقة الدفع</label>
            <select id="method" value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)} className={inputCls}><option value="">—</option>{Object.entries(PAYMENT_METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className={lbl} htmlFor="terms">شروط الدفع</label>
            <input id="terms" value={f.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} maxLength={2000} className={inputCls} placeholder="مثال: 50% مقدم والباقي بعد شهر" /></div>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><span className="text-ink-500">تقسيم سريع:</span>
          {[1, 2, 3, 4, 6, 12].map((n) => <button key={n} type="button" onClick={() => split(n)} className="rounded-md border border-line bg-white px-2.5 py-1 hover:bg-cream">{n === 1 ? "دفعة واحدة" : `${n} دفعات`}</button>)}</div>
        <div className="space-y-2">
          {f.installments.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line/70 p-2 md:grid-cols-[9rem_11rem_10rem_1fr_auto] md:border-0 md:p-0">
              <select aria-label={`نوع الدفعة ${i + 1}`} value={it.kind} onChange={(e) => setInst(i, { kind: e.target.value })} className={inputCls}>{Object.entries(INSTALLMENT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input aria-label={`تاريخ استحقاق الدفعة ${i + 1}`} type="date" value={it.due_date} onChange={(e) => setInst(i, { due_date: e.target.value })} className={inputCls} required />
              <input aria-label={`مبلغ الدفعة ${i + 1}`} value={it.amount} onChange={(e) => setInst(i, { amount: e.target.value })} inputMode="decimal" dir="ltr" placeholder="المبلغ" className={inputCls + " tabular-nums"} required />
              <input aria-label={`ملاحظة الدفعة ${i + 1}`} value={it.note} onChange={(e) => setInst(i, { note: e.target.value })} placeholder="ملاحظة (اختياري)" maxLength={300} className={inputCls} />
              <button type="button" onClick={() => set("installments", f.installments.filter((_, j) => j !== i))} className="rounded-md border border-line px-3 py-2 text-sm text-bad hover:bg-bad/5">حذف</button>
            </div>))}
        </div>
        <button type="button" onClick={() => set("installments", [...f.installments, { kind: f.installments.length ? "installment" : "down_payment", due_date: f.start_date, amount: "", note: "" }])}
          className="mt-3 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">+ إضافة دفعة</button>
        {f.installments.length > 0 && (
          <p className={`mt-3 text-sm ${instOff ? "font-semibold text-bad" : "text-ok"}`} role={instOff ? "alert" : undefined}>
            مجموع الدفعات {sar(instSum)} {instOff ? `— لازم يساوي الإجمالي ${sar(total)} (الفرق ${sar(r2(total - instSum))})` : "= إجمالي العقد ✓"}</p>)}
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <label className={lbl} htmlFor="notes">ملاحظات على العقد</label>
        <textarea id="notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={4000} className={inputCls} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending}>حفظ العقد</SubmitButton>
        <span className="text-xs text-ink-500">بعد الحفظ هترفع العقد الموقّع وتبعته للمالية من صفحة العقد.</span>
      </div>
    </form>
  );
}
