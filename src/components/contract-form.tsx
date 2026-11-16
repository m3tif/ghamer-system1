"use client";
import { useActionState, useMemo, useState } from "react";
import { saveContractAction } from "@/server/actions";
import { Alert, SubmitButton, inputCls } from "@/components/forms";
import { PAYMENT_METHOD } from "@/lib/labels";
import type { FormState } from "@/lib/form";

type Item = { service: string; description: string; amount: string };
type Inst = { kind: string; due_date: string; amount: string; note: string };
export type ContractInitial = { total: string; package: string; duration_months: string; start_date: string; end_date: string; agreed_at: string; discount: string;
  payment_method: string; payment_terms: string; notes: string; items: Item[]; installments: Inst[] };

const num = (v: string) => { const n = Number(String(v).replace(/[,٬\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const sar = (n: number) => new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " ريال";
const addMonths = (d: string, m: number) => { const [y, mo, da] = d.split("-").map(Number); const t = new Date(Date.UTC(y, mo - 1 + m, da)); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const lbl = "mb-1 block text-sm font-medium";

/** The contract form. Packages are tick boxes; no discount and no VAT: the contract value is the sum of the ticked packages. */
export function ContractForm({ dealId, services, initial }: { dealId: string; services: { code: string; name_ar: string }[]; initial: ContractInitial }) {
  const [state, action, pending] = useActionState(saveContractAction, {} as FormState);
  const [f, setF] = useState(initial);
  const set = <K extends keyof ContractInitial>(k: K, v: ContractInitial[K]) => setF((o) => ({ ...o, [k]: v }));
  const setInst = (i: number, p: Partial<Inst>) => set("installments", f.installments.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const total = r2(num(f.total));
  const instSum = r2(f.installments.reduce((a, x) => a + num(x.amount), 0));
  const instOff = f.installments.length > 0 && instSum !== total;
  const payload = useMemo(() => JSON.stringify(f), [f]);

  const pickStart = (d: string) => setF((o) => ({ ...o, start_date: d, end_date: d && num(o.duration_months) > 0 ? addMonths(d, num(o.duration_months)) : o.end_date,
    installments: o.installments.map((x, i) => (i === 0 && (!x.due_date || x.due_date === o.start_date || x.due_date > d) ? { ...x, due_date: d } : x)) }));
  const pickMonths = (m: string) => setF((o) => ({ ...o, duration_months: m, end_date: o.start_date && num(m) > 0 ? addMonths(o.start_date, num(m)) : o.end_date }));

  // packages are tick boxes: ticking one adds it to the contract and opens its price box
  const picked = (code: string) => f.items.findIndex((x) => x.service === code);
  const toggle = (code: string, on: boolean) => set("items", on ? [...f.items, { service: code, description: "", amount: "" }] : f.items.filter((x) => x.service !== code));

  // number of payments: choosing N opens N rows (amount + date), split equally, one month apart, starting on the start date
  const count = Math.max(1, f.installments.length);
  const plusMonths = (d: string, m: number) => { if (!d) return ""; const [y, mo, da] = d.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + m, da)).toISOString().slice(0, 10); };
  const makeRows = (n: number, keepDates = true): Inst[] => {
    const each = total > 0 ? Math.floor((total / n) * 100) / 100 : 0;
    return Array.from({ length: n }, (_, i) => ({ kind: n === 1 ? "full" : i === 0 ? "down_payment" : "installment",
      due_date: (keepDates && f.installments[i]?.due_date) || plusMonths(f.start_date, i),
      amount: total > 0 ? String(i === n - 1 ? r2(total - each * (n - 1)) : each) : "", note: "" }));
  };
  const pickCount = (n: number) => set("installments", n <= 1 ? [] : makeRows(n, false));
  const firstLate = f.installments.length > 0 && !!f.start_date && !!f.installments[0].due_date && f.installments[0].due_date > f.start_date;

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="deal_id" value={dealId} /><input type="hidden" name="payload" value={payload} />
      {state.error && <Alert kind="error">{state.error}</Alert>}

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="mb-1 font-bold">الباقات</h2>
        <p className="mb-3 text-xs text-ink-500">علّم على الباقات اللي العميل اتفق عليها، واكتب سعر العقد كله مرة واحدة تحت.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((sv) => { const on = picked(sv.code) >= 0; return (
            <label key={sv.code} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 font-medium ${on ? "border-burgundy-600/40 bg-burgundy-600/5" : "border-line"}`}>
              <input type="checkbox" checked={on} onChange={(e) => toggle(sv.code, e.target.checked)} className="h-4 w-4 accent-burgundy-600" />{sv.name_ar}</label>); })}
        </div>
        {f.items.length === 0 && <p className="mt-2 text-sm text-warn">علّم على باقة واحدة على الأقل.</p>}
        <div className="mt-4 max-w-xs">
          <label className={lbl} htmlFor="total">سعر العقد (اللي العميل هيدفعه) <span className="text-burgundy-600">*</span></label>
          <div className="flex items-center gap-2">
            <input id="total" value={f.total} onChange={(e) => set("total", e.target.value)} inputMode="decimal" dir="ltr" placeholder="مثال: 8000" className={inputCls + " tabular-nums text-lg font-bold"} required />
            <span className="text-sm text-ink-500">ريال</span></div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="mb-3 font-bold">مدة العقد</h2>
        <div className="grid gap-3 md:grid-cols-4">
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
        <p className="mb-3 text-xs text-ink-500">اختار عدد الدفعات وهتتفتحلك خانة لكل دفعة (المبلغ والتاريخ). أول دفعة تاريخها نفس تاريخ البداية أو قبله.</p>
        <div className="mb-3 grid gap-3 md:grid-cols-[14rem_1fr]">
          <div><label className={lbl} htmlFor="method">طريقة الدفع</label>
            <select id="method" value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)} className={inputCls}><option value="">—</option>{Object.entries(PAYMENT_METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className={lbl} htmlFor="terms">شروط الدفع</label>
            <input id="terms" value={f.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} maxLength={2000} className={inputCls} placeholder="مثال: 50% مقدم والباقي بعد شهر" /></div>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div><label className={lbl} htmlFor="count">عدد الدفعات</label>
            <select id="count" value={count} onChange={(e) => pickCount(Number(e.target.value))} className={inputCls + " w-44"}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "دفعة واحدة" : n === 2 ? "دفعتين" : `${n} دفعات`}</option>)}</select></div>
          {f.installments.length > 1 && <button type="button" onClick={() => set("installments", makeRows(f.installments.length))} className="rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-cream">وزّع المبلغ بالتساوي</button>}
        </div>
        {f.installments.length === 0 ? (
          <p className="text-sm text-ink-500">دفعة واحدة بكامل المبلغ {total > 0 ? `(${sar(total)})` : ""} بتاريخ البداية.</p>
        ) : (
          <div className="space-y-2">
            {f.installments.map((it, i) => (
              <div key={i} className="grid items-center gap-2 rounded-md border border-line/70 p-2 md:grid-cols-[7rem_10rem_11rem] md:border-0 md:p-0">
                <span className="text-sm font-medium">{i === 0 ? "الدفعة الأولى" : i === 1 ? "الدفعة التانية" : `الدفعة ${i + 1}`}</span>
                <input aria-label={`مبلغ الدفعة ${i + 1}`} value={it.amount} onChange={(e) => setInst(i, { amount: e.target.value })} inputMode="decimal" dir="ltr" placeholder="المبلغ" className={inputCls + " tabular-nums"} required />
                <input aria-label={`تاريخ الدفعة ${i + 1}`} type="date" value={it.due_date} max={i === 0 && f.start_date ? f.start_date : undefined} onChange={(e) => setInst(i, { due_date: e.target.value })} className={inputCls} required />
              </div>))}
          </div>)}
        {firstLate && <p className="mt-3 text-sm font-semibold text-bad" role="alert">تاريخ الدفعة الأولى لازم يكون نفس تاريخ البداية ({f.start_date}) أو قبله.</p>}
        {f.installments.length > 0 && (
          <p className={`mt-3 text-sm ${instOff ? "font-semibold text-bad" : "text-ok"}`} role={instOff ? "alert" : undefined}>
            مجموع الدفعات {sar(instSum)} {instOff ? `— لازم يساوي قيمة العقد ${sar(total)} (الفرق ${sar(r2(total - instSum))})` : "= قيمة العقد ✓"}</p>)}
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
