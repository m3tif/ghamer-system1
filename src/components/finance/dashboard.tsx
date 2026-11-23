import Link from "next/link";
import type { ReactNode } from "react";
import { financeClients, financeContracts, financeDashboard, financeEmployees, type FinClient } from "@/server/data";
import { readPeriod } from "@/lib/period";
import { fmtDate, fmtDateTime, fmtSar } from "@/lib/format";
import { CONTRACT_STATUS, CONTRACT_STATUS_TONE, INSTALLMENT_KIND, LEAD_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui";
import { DailyChart, HBars, MonthChart } from "@/components/finance/charts";

export type FinSP = { p?: string; from?: string; to?: string; q?: string; cs?: string; emp?: string; cf?: string; ct?: string; pg?: string; tab?: string };
/** the admin home is split into tabs; the first one opens by default */
export const ADMIN_TABS = [["team", "أداء الموظفين"], ["attention", "محتاج تدخلك"], ["summary", "الملخص"], ["money", "المالية"], ["ops", "التشغيل"], ["analytics", "التحليلات"]] as const;
const UUID = /^[0-9a-f-]{36}$/, D = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown) => Number(v ?? 0);
const num = (v: unknown) => n(v).toLocaleString("en");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : "—");

/* ───────── small building blocks ───────── */
function Section({ id, title, sub, right, children }: { id?: string; title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="flex items-center gap-2 text-lg font-extrabold text-[#1b2a41]"><span className="h-5 w-1 rounded-full bg-[#b8955a]" />{title}</h2>{sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}
function Panel({ title, children, className = "", right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-[#e7dfcf] bg-white p-5 shadow-[0_1px_2px_rgba(27,42,65,.04),0_8px_24px_-12px_rgba(27,42,65,.12)] ${className}`}>
      {title && <div className="mb-4 flex items-center justify-between gap-2"><h3 className="font-bold text-[#1b2a41]">{title}</h3>{right}</div>}
      {children}
    </div>
  );
}
function Delta({ cur, prev, label }: { cur: number; prev: number | null | undefined; label: string }) {
  if (prev == null) return null;
  if (prev === 0 && cur === 0) return <span className="text-[11px] text-ink-500">زي {label}</span>;
  if (prev === 0) return <span className="text-[11px] font-semibold text-ok">جديد · {label} كان 0</span>;
  const d = Math.round(((cur - prev) / prev) * 100);
  const up = d >= 0;
  return <span className={`text-[11px] font-semibold ${up ? "text-ok" : "text-bad"}`}>{up ? "▲" : "▼"} {Math.abs(d)}% <span className="font-normal text-ink-500">عن {label} ({num(prev)})</span></span>;
}
function Kpi({ label, value, icon, delta, href, accent, note }: { label: string; value: ReactNode; icon: string; delta?: ReactNode; href?: string; accent?: "gold" | "wine" | "navy"; note?: string }) {
  const ring = accent === "wine" ? "bg-burgundy-50 text-burgundy-700" : accent === "gold" ? "bg-[#f6efe2] text-[#8a6a35]" : "bg-[#eef1f6] text-[#1b2a41]";
  const body = (
    <div className="flex h-full flex-col gap-2 rounded-2xl border border-[#e7dfcf] bg-white p-4 shadow-[0_1px_2px_rgba(27,42,65,.04),0_8px_24px_-14px_rgba(27,42,65,.18)] transition hover:-translate-y-0.5 hover:border-[#b8955a]/60">
      <div className="flex items-start justify-between gap-2"><span className="text-xs font-medium text-ink-500">{label}</span><span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm ${ring}`}>{icon}</span></div>
      <div className="text-[1.9rem] font-extrabold leading-none tabular-nums text-[#1b2a41]">{value}</div>
      <div className="min-h-4">{delta}{note && <span className="text-[11px] text-ink-500">{note}</span>}</div>
    </div>);
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

/* ───────── the dashboard ───────── */
export type AdminExtras = { attention?: ReactNode; ops?: ReactNode; daily?: ReactNode; analytics?: ReactNode; tech?: ReactNode };
export async function FinanceDashboard({ uid, name, sp, variant = "finance", extra }: { uid: string; name: string; sp: FinSP; variant?: "finance" | "admin"; extra?: AdminExtras }) {
  const defPeriod = variant === "admin" ? "today" : "month";
  const per = readPeriod(sp, defPeriod);
  const q = (sp.q ?? "").slice(0, 80), cs = sp.cs && sp.cs in CONTRACT_STATUS ? sp.cs : "", emp = UUID.test(sp.emp ?? "") ? sp.emp! : "";
  const cf = D.test(sp.cf ?? "") ? sp.cf! : "", ct = D.test(sp.ct ?? "") ? sp.ct! : "", pg = Math.max(1, Number(sp.pg) || 1), size = 15;
  const [d, rows, emps, money] = await Promise.all([financeDashboard(uid, per.from, per.to),
    financeContracts(uid, { q, status: cs, emp, from: cf, to: ct, limit: size, offset: (pg - 1) * size }), financeEmployees(uid), financeClients(uid)]);
  const k = d.kpi, c = d.contracts, total = n(rows[0]?.total);
  const prevLabel = per.key === "today" ? "امبارح" : per.key === "month" ? "نفس الفترة اللي قبلها" : "الفترة اللي قبلها";
  const view = variant === "admin" ? (ADMIN_TABS.find(([k]) => k === sp.tab)?.[0] ?? "team") : "";
  const keep = { tab: view && view !== "team" ? view : undefined, p: per.key === defPeriod ? undefined : per.key, from: per.key === "custom" ? per.from : undefined, to: per.key === "custom" ? per.to : undefined };
  const link = (o: Record<string, string | undefined>, hash = "") => {
    // the contracts list lives in the «المالية» tab of the admin home: a link to it opens that tab
    const all = { ...keep, ...(view && hash === "#contracts" ? { tab: "money" } : {}), q: q || undefined, cs: cs || undefined, emp: emp || undefined, cf: cf || undefined, ct: ct || undefined, ...o };
    const qs = new URLSearchParams(Object.entries(all).filter(([, v]) => v) as [string, string][]).toString();
    return `/${qs ? "?" + qs : ""}${hash}`;
  };
  const exportHref = (kind: string) => `/api/finance/export?${new URLSearchParams(Object.entries({ kind, from: per.from, to: per.to, q, cs, emp, cf, ct }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const periodTitle = per.key === "today" ? "النهارده" : per.key === "week" ? "آخر 7 أيام" : per.key === "month" ? "الشهر الحالي" : "فترة مخصصة";
  const tab = (key: string, label: string) => (
    <Link key={key} href={link({ p: key === defPeriod ? undefined : key, from: undefined, to: undefined, pg: undefined })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${per.key === key ? "bg-[#b8955a] text-[#1b2a41]" : "text-white/80 hover:bg-white/10"}`}>{label}</Link>);
  const funnel = [
    { label: "عملاء دخلوا", v: n(k.added) }, { label: "اتحوّلوا للسيلز", v: n(k.handed) }, { label: "السيلز قبلهم", v: n(k.accepted) },
    { label: "عقود اتسجلت", v: n(k.contracts_new) }, { label: "عقود اتعتمدت", v: n(k.contracts_approved) }];
  const tele = (d.employees as any[]).filter((e) => e.role_code.startsWith("tele")), sales = (d.employees as any[]).filter((e) => e.role_code.startsWith("sales"));

  const headerBlock = (<>
      {/* header band */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-[#1b2a41] via-[#22314b] to-[#2c1b28] p-6 text-white shadow-[0_20px_40px_-20px_rgba(27,42,65,.6)] sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-[#b8955a]/15 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#d9bf8c]">{variant === "admin" ? "لوحة مدير النظام — الشركة كلها" : "لوحة المدير المالي"}</p>
            <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">أهلًا {name}</h1>
            <p className="mt-1 text-sm text-white/70">{periodTitle}: {fmtDate(d.from)} ← {fmtDate(d.to)} · بتوقيت {d.tz === "Asia/Riyadh" ? "الرياض" : d.tz} · الأرقام كلها من السيستم مباشرة</p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <nav aria-label="الفترة" className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">{tab("today", "اليوم")}{tab("week", "أسبوع")}{tab("month", "الشهر")}</nav>
            <form action="/" className="flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="p" value="custom" />
              {view && view !== "team" && <input type="hidden" name="tab" value={view} />}
              <label className="sr-only" htmlFor="from">من</label><input id="from" name="from" type="date" defaultValue={per.key === "custom" ? per.from : ""} required className="rounded-lg border-0 bg-white/10 px-2 py-1.5 text-white [color-scheme:dark]" />
              <label className="sr-only" htmlFor="to">إلى</label><input id="to" name="to" type="date" defaultValue={per.key === "custom" ? per.to : ""} required className="rounded-lg border-0 bg-white/10 px-2 py-1.5 text-white [color-scheme:dark]" />
              <button className={`rounded-lg px-3 py-1.5 font-semibold ${per.key === "custom" ? "bg-[#b8955a] text-[#1b2a41]" : "bg-white/10 hover:bg-white/20"}`}>فترة مخصصة</button>
            </form>
          </div>
        </div>
      </div>
  </>);
  const moneyBlock = (<>
      <ClientsMoney rows={money} />
  </>);
  const attentionBlock = (<>
      {/* 6. attention centre */}
      <Section title={variant === "admin" ? "المالية — العقود والدفعات" : "محتاج تدخلك"} sub="من العقود والدفعات الفعلية في السيستم — بتتحدث لوحدها">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Panel title={`دفعات مستنية تأكيدك (${num(c.payments_pending)})`}>
            {d.attention.payments.length === 0 ? <p className="text-sm text-ink-500">مفيش دفعات مستنياك ✓</p> : (
              <ul className="divide-y divide-line text-sm">{d.attention.payments.map((w: any) => (
                <li key={w.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/contracts/${w.contract_id}`} className="min-w-0"><span className="block truncate font-semibold text-burgundy-700 underline">{w.client_name}</span><span className="text-xs text-ink-500">{w.recorded_by} · {fmtDate(w.paid_at)}</span></Link>
                  <span className="shrink-0 text-xs font-bold tabular-nums">{fmtSar(w.amount)}</span>
                </li>))}</ul>)}
          </Panel>
          <Panel title={`عقود مستنية مراجعة (${num(c.submitted)})`}>
            {d.attention.waiting.length === 0 ? <p className="text-sm text-ink-500">مفيش عقود مستنياك ✓</p> : (
              <ul className="divide-y divide-line text-sm">{d.attention.waiting.map((w: any) => (
                <li key={w.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/contracts/${w.id}`} className="min-w-0"><span className="block truncate font-semibold text-burgundy-700 underline">{w.client_name}</span><span className="text-xs text-ink-500" dir="ltr">{w.contract_no}</span> <span className="text-xs text-ink-500">· {w.sales_name} · {fmtDateTime(w.submitted_at)}</span></Link>
                  {w.late ? <Badge tone="bad">متأخر</Badge> : <span className="shrink-0 text-xs font-semibold tabular-nums">{fmtSar(w.total_amount)}</span>}
                </li>))}</ul>)}
          </Panel>
          <Panel title={`رجعت للسيلز (${num(c.returned)})`}>
            {d.attention.returned.length === 0 ? <p className="text-sm text-ink-500">مفيش عقود راجعة.</p> : (
              <ul className="divide-y divide-line text-sm">{d.attention.returned.map((w: any) => (
                <li key={w.id} className="py-2"><Link href={`/contracts/${w.id}`} className="font-semibold text-burgundy-700 underline">{w.client_name}</Link> <span className="text-xs text-ink-500">· {w.sales_name}</span>
                  <p className="text-xs text-ink-500">{w.return_reason} · {fmtDateTime(w.returned_at)}</p></li>))}</ul>)}
          </Panel>
          <Panel title="آخر تحديثات العقود">
            {d.attention.recent.length === 0 ? <p className="text-sm text-ink-500">مفيش عقود لسه.</p> : (
              <ul className="divide-y divide-line text-sm">{d.attention.recent.map((w: any) => (
                <li key={w.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0"><Link href={`/contracts/${w.id}`} className="block truncate font-medium text-burgundy-700 underline">{w.client_name}</Link><span className="text-xs text-ink-500">{w.by} · {fmtDateTime(w.at)}</span></span>
                  <Badge tone={CONTRACT_STATUS_TONE[w.status]}>{CONTRACT_STATUS[w.status]}</Badge></li>))}</ul>)}
          </Panel>
        </div>
      </Section>
  </>);
  const contractsBlock = (<>
      {/* 3 + 7. contracts table */}
      <Section id="contracts" title="متابعة العقود" sub="ابحث باسم العميل أو رقمه أو رقم العقد، وفلتر بالحالة والموظف وتاريخ التسجيل" right={<a href={exportHref("contracts")} className="rounded-lg border border-[#b8955a]/60 bg-white px-3 py-1.5 text-sm font-semibold text-[#8a6a35] hover:bg-[#f6efe2]">⬇ تصدير Excel (CSV)</a>}>
        <Panel>
          <div className="mb-4 flex flex-wrap gap-2">
            {[["", "الكل", c.total + c.cancelled], ["draft", "مسودة", c.draft], ["submitted", "مستنية مراجعة", c.submitted], ["returned", "رجعت للتعديل", c.returned], ["approved", "معتمدة", c.approved], ["cancelled", "ملغية", c.cancelled]].map(([key, label, cnt]) => (
              <Link key={String(key)} href={link({ cs: String(key) || undefined, pg: undefined }, "#contracts")} className={`rounded-full px-3 py-1 text-sm font-medium ${cs === key ? "bg-[#1b2a41] text-white" : "bg-cream text-charcoal hover:bg-cream-dark"}`}>{label} <span className="tabular-nums opacity-70">{num(cnt)}</span></Link>))}
          </div>
          <form action="/#contracts" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_auto_auto_auto]">
            {view && <input type="hidden" name="tab" value="money" />}{keep.p && <input type="hidden" name="p" value={keep.p} />}{keep.from && <input type="hidden" name="from" value={keep.from} />}{keep.to && <input type="hidden" name="to" value={keep.to} />}{cs && <input type="hidden" name="cs" value={cs} />}
            <input name="q" defaultValue={q} placeholder="اسم العميل أو رقم الجوال أو رقم العقد" aria-label="بحث" className="rounded-lg border border-line px-3 py-2 text-sm" />
            <select name="emp" defaultValue={emp} aria-label="الموظف" className="rounded-lg border border-line px-3 py-2 text-sm"><option value="">كل الموظفين</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name} — {e.role_name}</option>)}</select>
            <input name="cf" type="date" defaultValue={cf} aria-label="من تاريخ" className="rounded-lg border border-line px-3 py-2 text-sm" />
            <input name="ct" type="date" defaultValue={ct} aria-label="إلى تاريخ" className="rounded-lg border border-line px-3 py-2 text-sm" />
            <div className="flex gap-2"><button className="rounded-lg bg-[#1b2a41] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2b3c58]">بحث</button>{(q || emp || cf || ct) && <Link href={link({ q: undefined, emp: undefined, cf: undefined, ct: undefined, pg: undefined }, "#contracts")} className="rounded-lg border border-line px-3 py-2 text-sm">مسح</Link>}</div>
          </form>
          {rows.length === 0 ? <p className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-500">مفيش عقود بالشروط دي.</p> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-[#1b2a41] text-start text-xs text-white/85"><tr>{["العقد", "العميل", "الباقات", "السيلز / التيلي", "القيمة", "الحالة", "اتسجل", "آخر تحديث"].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold">{h}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r.id} className={i % 2 ? "bg-cream/40" : ""}>
                    <td className="px-3 py-2.5"><Link href={`/contracts/${r.id}`} className="font-semibold text-burgundy-700 underline" dir="ltr">{r.contract_no}</Link></td>
                    <td className="px-3 py-2.5"><span className="font-medium">{r.client_name}</span>{r.phone && <span className="block text-xs text-ink-500" dir="ltr">{r.phone}</span>}</td>
                    <td className="max-w-48 px-3 py-2.5 text-xs">{r.packages ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{r.sales_name ?? "—"}<span className="block text-ink-500">{r.tele_name ?? ""}</span></td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold tabular-nums">{fmtSar(r.total_amount)}</td>
                    <td className="px-3 py-2.5"><Badge tone={CONTRACT_STATUS_TONE[r.status]}>{CONTRACT_STATUS[r.status]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-500">{fmtDateTime(r.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-500">{fmtDateTime(r.updated_at)}</td>
                  </tr>))}</tbody>
              </table>
            </div>)}
          {total > size && (
            <nav className="mt-3 flex items-center justify-between text-sm" aria-label="الصفحات">
              <span className="text-ink-500">صفحة {pg} من {Math.ceil(total / size)} · {num(total)} عقد</span>
              <span className="flex gap-2">{pg > 1 && <Link href={link({ pg: String(pg - 1) }, "#contracts")} className="rounded-lg border border-line px-3 py-1.5">السابق</Link>}{pg * size < total && <Link href={link({ pg: String(pg + 1) }, "#contracts")} className="rounded-lg border border-line px-3 py-1.5">التالي</Link>}</span>
            </nav>)}
        </Panel>
      </Section>
  </>);
  const summaryBlock = (<>
      {/* 1. executive summary */}
      <Section title="الملخص التنفيذي" sub={`مقارنة بـ${prevLabel}: ${fmtDate(d.prev_from)} ← ${fmtDate(d.prev_to)}`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          <Kpi icon="👥" label="عملاء دخلوا في الفترة" value={num(k.added)} delta={<Delta cur={n(k.added)} prev={n(k.added_prev)} label={prevLabel} />} />
          <Kpi icon="☀" label="عملاء دخلوا النهارده" value={num(k.added_today)} accent="gold" />
          <Kpi icon="∑" label="كل العملاء من أول السيستم" value={num(k.total_clients)} />
          <Kpi icon="⇄" label="عملاء اتوزعوا على الموظفين" value={num(k.distributed)} delta={<Delta cur={n(k.distributed)} prev={n(k.distributed_prev)} label={prevLabel} />} />
          <Kpi icon="➜" label="اتحوّلوا للسيلز" value={num(k.handed)} accent="gold" delta={<Delta cur={n(k.handed)} prev={n(k.handed_prev)} label={prevLabel} />} />
          <Kpi icon="✓" label="السيلز قبلهم" value={num(k.accepted)} note={`رفض ${num(k.rejected)} · لسه مستني ${num(k.pending)}`} />
          <Kpi icon="▤" label="كل العقود المسجلة" value={num(c.total)} href={link({ cs: undefined, pg: undefined }, "#contracts")} accent="wine" note="من غير الملغية" />
          <Kpi icon="⏳" label={variant === "admin" ? "عقود مستنية مراجعة المالية" : "عقود مستنية مراجعتك"} value={num(c.submitted)} href={link({ cs: "submitted", pg: undefined }, "#contracts")} accent="wine" note={n(c.late) ? `${num(c.late)} منهم أكتر من يومين` : undefined} />
          <Kpi icon="★" label="عقود معتمدة" value={num(c.approved)} href={link({ cs: "approved", pg: undefined }, "#contracts")} note={`قيمتها ${fmtSar(c.value_approved)}`} />
          <Kpi icon="﷼" label="فلوس اتحصلت في الفترة" value={fmtSar(k.collected)} accent="gold" delta={<Delta cur={n(k.collected)} prev={n(k.collected_prev)} label={prevLabel} />} />
          <Kpi icon="↺" label="رجعت للتعديل / ملغية" value={`${num(c.returned)} / ${num(c.cancelled)}`} href={link({ cs: "returned", pg: undefined }, "#contracts")} note="السيستم مافيهوش «رفض» — الرفض بيبقى إرجاع للسيلز" />
        </div>
      </Section>
  </>);
  const achievementsBlock = (<>
      {/* 2. achievements */}
      <Section title="إنجازات الفترة" sub="كل مرحلة بتتعد بتاريخها هي (العميل بتاريخ دخوله، التحويل بتاريخ التحويل، العقد بتاريخ تسجيله). النِسب بين أعداد نفس الفترة.">
        <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
          <Panel title="مراحل الشغل">
            <ol className="space-y-3">
              {funnel.map((f, i) => (
                <li key={f.label}>
                  <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium">{i + 1}. {f.label}</span><span className="text-xl font-extrabold tabular-nums text-[#1b2a41]">{num(f.v)}</span></div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-cream-dark/70"><div className="h-full rounded-full bg-gradient-to-l from-[#1b2a41] to-[#4a5d7c]" style={{ width: `${funnel[0].v ? Math.max(2, (f.v / Math.max(...funnel.map((x) => x.v), 1)) * 100) : 0}%` }} /></div>
                  {i > 0 && <p className="mt-0.5 text-[11px] text-ink-500">نسبة من المرحلة اللي قبلها: <b className="text-[#8a6a35]">{pct(f.v, funnel[i - 1].v)}</b></p>}
                </li>))}
            </ol>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 text-sm">
              <div>اتحوّلوا للسيلز<br /><Delta cur={n(k.handed)} prev={n(k.handed_prev)} label={prevLabel} /></div>
              <div>عقود اتسجلت<br /><Delta cur={n(k.contracts_new)} prev={n(k.contracts_new_prev)} label={prevLabel} /></div>
              <div>عقود اتعتمدت<br /><Delta cur={n(k.contracts_approved)} prev={n(k.contracts_approved_prev)} label={prevLabel} /></div>
              <div>قيمة المعتمد {fmtSar(k.approved_value)}<br /><Delta cur={n(k.approved_value)} prev={n(k.approved_value_prev)} label={prevLabel} /></div>
            </div>
          </Panel>
          <Panel title="يوم بيوم" right={<span className="text-xs text-ink-500">مرّر على أي يوم تشوف أرقامه</span>}>
            <DailyChart rows={d.daily} contractsHref={(day) => link({ cf: day, ct: day, cs: undefined, pg: undefined }, "#contracts")} />
          </Panel>
        </div>
      </Section>
  </>);
  const employeesBlock = (<>
      {/* 4. employees */}
      <Section title="أداء الموظفين" sub="في الفترة المختارة. «ضافهم» = العملاء اللي سجّلهم بنفسه، «استلمهم» = اتوزعوا عليه من غيره — العميل الواحد مابيتعدّش مرتين. العقود = اللي هو سيلزها أو التيلي اللي جابها."
        right={<a href={exportHref("employees")} className="rounded-lg border border-[#b8955a]/60 bg-white px-3 py-1.5 text-sm font-semibold text-[#8a6a35] hover:bg-[#f6efe2]">⬇ تصدير Excel (CSV)</a>}>
        <div className="grid gap-4 xl:grid-cols-2">
          {[["التيلي سيلز", tele], ["السيلز", sales]].map(([title, list]) => (
            <Panel key={title as string} title={`ترتيب ${title}`} right={<span className="text-[11px] text-ink-500">الترتيب بالنقاط: إضافة 1 · استلام 1 · تحويل 3 · عقد 10</span>}>
              {(list as any[]).length === 0 ? <p className="text-sm text-ink-500">مفيش موظفين.</p> : (
                <ol className="space-y-2">{(list as any[]).map((e, i) => (
                  <li key={e.id}>
                    <details className="group rounded-xl border border-line/80 open:border-[#b8955a]/50 open:bg-[#fbf8f2]">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${i === 0 ? "bg-[#b8955a] text-[#1b2a41]" : i < 3 ? "bg-[#1b2a41] text-white" : "bg-cream text-ink-500"}`}>{i + 1}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{e.full_name}</span><span className="text-xs text-ink-500">{e.role_name}</span></span>
                        <span className="hidden gap-3 text-center text-xs sm:flex">
                          <span><b className="block text-base tabular-nums text-[#1b2a41]">{e.added + e.received}</b>عملاء</span>
                          <span><b className="block text-base tabular-nums text-[#1b2a41]">{e.handed}</b>تحويل</span>
                          <span><b className="block text-base tabular-nums text-burgundy-700">{e.contracts}</b>عقد</span>
                        </span>
                        <span aria-hidden className="text-ink-300 transition group-open:rotate-180">⌄</span>
                      </summary>
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-line/70 px-4 py-3 text-sm sm:grid-cols-3">
                        {[["ضافهم بنفسه", e.added], ["استلمهم من التوزيع", e.received], ["حوّلهم للسيلز", e.handed], ["عقود اتسجلت", e.contracts], ["عقود اتعتمدت", e.contracts_approved]].map(([l, v]) => (
                          <div key={l as string} className="flex justify-between gap-2"><dt className="text-ink-500">{l}</dt><dd className="font-bold tabular-nums">{num(v)}</dd></div>))}
                        <div className="col-span-full pt-1"><Link href={link({ emp: e.id, cs: undefined, pg: undefined }, "#contracts")} className="text-xs font-semibold text-burgundy-700 underline">عقود {e.full_name}</Link></div>
                      </dl>
                    </details>
                  </li>))}</ol>)}
            </Panel>))}
        </div>
      </Section>
  </>);
  const analyticsBlock = (<>
      {/* 5. analytics */}
      <Section title="تحليلات" sub="توزيع العملاء على المراحل دلوقتي، وآخر 6 شهور">
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="العملاء حسب المرحلة الحالية" right={variant === "admin" ? <span className="text-[11px] text-ink-500">اضغط على أي مرحلة تفتح عملاءها</span> : <span className="text-[11px] text-ink-500">أرقام بس — قايمة العملاء مش ضمن صلاحيات المالية</span>}>
            <HBars rows={(d.stages as any[]).slice(0, 12).map((s) => ({ label: LEAD_STATUS[s.s] ?? s.s, value: s.n, href: variant === "admin" ? `/leads?status=${encodeURIComponent(s.s)}` : undefined }))} />
          </Panel>
          <Panel title="آخر 6 شهور" className="xl:col-span-2"><MonthChart rows={d.monthly} /></Panel>
          <Panel title={`الفترة دي مقابل ${prevLabel}`} className="xl:col-span-3">
            <div className="grid gap-6 md:grid-cols-2">
              <HBars rows={[{ label: `عملاء جدد — ${periodTitle}`, value: n(k.added) }, { label: `عملاء جدد — ${prevLabel}`, value: n(k.added_prev), tone: "gold" },
                { label: `اتحوّلوا للسيلز — ${periodTitle}`, value: n(k.handed) }, { label: `اتحوّلوا للسيلز — ${prevLabel}`, value: n(k.handed_prev), tone: "gold" }]} />
              <HBars rows={[{ label: `عقود — ${periodTitle}`, value: n(k.contracts_new), tone: "wine", href: link({ cf: per.from, ct: per.to, cs: undefined, pg: undefined }, "#contracts") }, { label: `عقود — ${prevLabel}`, value: n(k.contracts_new_prev), tone: "gold" }]} />
            </div>
          </Panel>
        </div>
      </Section>
  </>);

  const isAdmin = variant === "admin";
  return (
    <div className="space-y-8 overflow-x-clip">
      {headerBlock}
      {isAdmin ? (<>
        <nav aria-label="أقسام اللوحة" className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-[#e7dfcf] bg-white/95 p-1.5 shadow-[0_8px_24px_-18px_rgba(27,42,65,.5)] backdrop-blur">
          {ADMIN_TABS.map(([k, label]) => {
            const badge = k === "money" ? n(c.submitted) + n(c.payments_pending) : 0;
            return (
              <Link key={k} href={link({ tab: k === "team" ? undefined : k, pg: undefined })} aria-current={view === k ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${view === k ? "bg-[#1b2a41] text-white shadow" : "text-[#1b2a41] hover:bg-[#f6efe2]"}`}>
                {label}{badge > 0 && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${view === k ? "bg-[#b8955a] text-[#1b2a41]" : "bg-bad text-white"}`}>{badge}</span>}
              </Link>);
          })}
        </nav>
        {view === "team" && (<>{employeesBlock}{extra?.tech}{extra?.daily}</>)}
        {view === "attention" && extra?.attention}
        {view === "summary" && (<>{summaryBlock}{achievementsBlock}</>)}
        {view === "money" && (<>{moneyBlock}{attentionBlock}{contractsBlock}</>)}
        {view === "ops" && extra?.ops}
        {view === "analytics" && (<>{analyticsBlock}{extra?.analytics}</>)}
      </>) : (<>
        {moneyBlock}
        {attentionBlock}
        {contractsBlock}
        {summaryBlock}
        {achievementsBlock}
        {employeesBlock}
        {analyticsBlock}
      </>)}
    </div>
  );
}
/* ───────── clients ranked by money: payments, when they end, time left on the contract ───────── */
function ClientsMoney({ rows }: { rows: FinClient[] }) {
  const sum = (k: "total_amount" | "paid" | "overdue" | "remaining") => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const total = sum("total_amount"), paid = sum("paid"), late = sum("overdue"), left = sum("remaining");
  return (
    <Section id="money" title="العملاء والفلوس" sub="العملاء مترتبين من الأكبر قيمة للأصغر (العقود المعتمدة واللي عند المالية). «اتحصل» = الدفعات اللي المدير المالي أكد وصولها بس. «متأخر» = اللي جه ميعاده في جدول الدفعات ولسه ماوصلش.">
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl bg-[#1b2a41] p-4 text-white"><p className="text-xs text-white/70">إجمالي قيمة العقود</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{fmtSar(total)}</p><p className="text-xs text-white/60">{rows.length} عميل</p></div>
        <div className="rounded-2xl border border-[#e7dfcf] bg-white p-4"><p className="text-xs text-ink-500">اتحصل فعلًا</p><p className="mt-1 text-2xl font-extrabold tabular-nums text-ok">{fmtSar(paid)}</p></div>
        <div className="rounded-2xl border border-[#e7dfcf] bg-white p-4"><p className="text-xs text-ink-500">متأخر على العملاء</p><p className={`mt-1 text-2xl font-extrabold tabular-nums ${late ? "text-bad" : "text-[#1b2a41]"}`}>{fmtSar(late)}</p></div>
        <div className="rounded-2xl border border-[#e7dfcf] bg-white p-4"><p className="text-xs text-ink-500">باقي لسه</p><p className="mt-1 text-2xl font-extrabold tabular-nums text-burgundy-700">{fmtSar(left)}</p></div>
      </div>
      {rows.length === 0 ? <Panel><p className="py-6 text-center text-sm text-ink-500">مفيش عقود معتمدة أو عند المالية لسه.</p></Panel> : (
        <div className="space-y-3">{rows.map((r, i) => {
          const tot = Number(r.total_amount) || 0, paidPct = tot ? Math.min(100, (Number(r.paid) / tot) * 100) : 0, duePct = tot ? Math.min(100, (Number(r.due_so_far) / tot) * 100) : 0;
          const timePct = r.days_total && r.days_left != null ? Math.min(100, Math.max(0, ((r.days_total - r.days_left) / r.days_total) * 100)) : 0;
          const ended = r.days_left === 0, notStarted = r.start_date && new Date(r.start_date) > new Date();
          return (
            <details key={r.contract_id} className="group rounded-2xl border border-[#e7dfcf] bg-white shadow-[0_1px_2px_rgba(27,42,65,.04),0_8px_24px_-16px_rgba(27,42,65,.18)] open:border-[#b8955a]/60">
              <summary className="grid cursor-pointer list-none gap-3 p-4 md:grid-cols-[2.2rem_1.4fr_1fr_1.3fr_1.3fr_1rem] md:items-center">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold ${i === 0 ? "bg-[#b8955a] text-[#1b2a41]" : i < 3 ? "bg-[#1b2a41] text-white" : "bg-cream text-ink-500"}`}>{i + 1}</span>
                <span className="min-w-0"><span className="block truncate font-bold text-[#1b2a41]">{r.client_name}</span>
                  <span className="block truncate text-xs text-ink-500">{r.packages ?? "—"}{r.status !== "approved" && <> · <span className="font-semibold text-warn">{CONTRACT_STATUS[r.status]}</span></>}</span></span>
                <span><span className="block text-lg font-extrabold tabular-nums text-[#1b2a41]">{fmtSar(r.total_amount)}</span><span className="text-xs text-ink-500">{r.inst_count ? `${r.inst_count} ${r.inst_count === 1 ? "دفعة" : "دفعات"}` : "مفيش جدول دفعات"}</span></span>
                <span className="min-w-0">
                  <span className="flex justify-between text-xs"><span className="text-ok">اتحصل {fmtSar(r.paid)}</span><b className="text-burgundy-700">باقي {fmtSar(r.remaining)}</b></span>
                  <span className="relative mt-1 block h-2 overflow-hidden rounded-full bg-cream-dark/70"><span className="absolute inset-y-0 right-0 block rounded-full bg-[#b8955a]/40" style={{ width: `${duePct}%` }} /><span className="absolute inset-y-0 right-0 block rounded-full bg-ok" style={{ width: `${paidPct}%` }} /></span>
                  {(Number(r.overdue) > 0 || r.pending_payments > 0) && <span className="mt-1 flex flex-wrap gap-1.5">{Number(r.overdue) > 0 && <Badge tone="bad">متأخر {fmtSar(r.overdue)}</Badge>}{r.pending_payments > 0 && <Badge tone="warn">{r.pending_payments} دفعة مستنية تأكيد</Badge>}</span>}
                  <span className="mt-1 block text-[11px] text-ink-500">{r.next_due ? `الدفعة الجاية ${fmtDate(r.next_due)} — ${fmtSar(r.next_amount)}` : r.inst_count ? "كل الدفعات اتستحقت" : "—"}{r.last_due ? ` · الدفعات بتخلص ${fmtDate(r.last_due)}` : ""}</span>
                </span>
                <span className="min-w-0">
                  <span className="flex justify-between text-xs"><span className="text-ink-500">{r.start_date ? `${fmtDate(r.start_date)} ← ${r.end_date ? fmtDate(r.end_date) : "—"}` : "مفيش تواريخ"}</span>
                    <b className={ended ? "text-bad" : "text-[#1b2a41]"}>{r.days_left == null ? "" : ended ? "العقد خلص" : notStarted ? "لسه مابدأش" : `باقي ${r.days_left} يوم`}</b></span>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-cream-dark/70"><span className="block h-full rounded-full bg-[#1b2a41]" style={{ width: `${timePct}%` }} /></span>
                  <span className="mt-1 block text-[11px] text-ink-500">{notStarted && r.days_left != null && r.days_total ? `مدته ${r.days_total} يوم — بيبدأ ${fmtDate(r.start_date)}` : r.days_total ? `عدّى ${Math.round(timePct)}% من مدة العقد` : ""}</span>
                </span>
                <span aria-hidden className="hidden text-ink-300 transition group-open:rotate-180 md:block">⌄</span>
              </summary>
              <div className="border-t border-line/70 px-4 py-3">
                {r.schedule.length === 0 ? <p className="text-sm text-ink-500">العقد مالوش جدول دفعات (دفعة واحدة بتاريخ البداية بتتعمل لما يتبعت للمالية).</p> : (
                  <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{r.schedule.map((p) => (
                    <li key={p.seq} className={`rounded-xl border px-3 py-2 text-sm ${p.due ? "border-[#b8955a]/50 bg-[#fbf8f2]" : "border-line"}`}>
                      <span className="flex justify-between gap-2"><span className="font-semibold">{p.seq}. {INSTALLMENT_KIND[p.kind] ?? p.kind}</span><span className="font-bold tabular-nums">{fmtSar(p.amount)}</span></span>
                      <span className="text-xs text-ink-500">{fmtDate(p.due_date)} · {p.due ? "اتستحقت" : "جاية"}</span>
                    </li>))}</ol>)}
                <Link href={`/contracts/${r.contract_id}`} className="mt-3 inline-block text-xs font-semibold text-burgundy-700 underline" dir="auto">فتح العقد {r.contract_no}</Link>
              </div>
            </details>);
        })}</div>)}
    </Section>
  );
}
