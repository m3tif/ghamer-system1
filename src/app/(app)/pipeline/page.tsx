import Link from "next/link";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { listDeals, filterByClientSearch } from "@/server/data";
import { SearchBox } from "@/components/search-box";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { DealActions } from "@/components/deal-actions";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { PIPE, pipeOf, TEMPERATURE, TEMPERATURE_TONE } from "@/lib/labels";

export const metadata = { title: "خط المبيعات" };
export const dynamic = "force-dynamic";
type SP = { col?: string; owner?: string; q?: string };

export default async function Pipeline({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession(); await requirePerm(s, "deals.view");
  const sp = await searchParams;
  const all = await filterByClientSearch(s.userId, await listDeals(s.userId), sp.q);
  const owners = [...new Map(all.map((d: any) => [d.owner_sales_id, d.owner_name])).entries()] as [string, string][];
  const deals = all.filter((d: any) => !sp.owner || d.owner_sales_id === sp.owner);
  const edit = can(s, "deals.edit");
  const col = (k: string) => deals.filter((d: any) => pipeOf(d.stage) === k);
  const lost = col("lost"), overdue = deals.filter((d: any) => d.overdue > 0 && !["lost", "won"].includes(pipeOf(d.stage))).length;
  const showLost = sp.col === "lost";
  const link = (o: SP) => { const p = new URLSearchParams(); const m = { ...sp, ...o }; if (m.col) p.set("col", m.col); if (m.owner) p.set("owner", m.owner); if (m.q) p.set("q", m.q); return `/pipeline${p.size ? `?${p}` : ""}`; };
  const card = (d: any) => (
    <article key={d.id} className={`relative rounded-lg border bg-white p-3 text-sm shadow-sm transition hover:border-burgundy-600 ${d.overdue > 0 && pipeOf(d.stage) === "follow" ? "border-bad/50" : "border-line"}`}>
      <Link href={`/deals/${d.id}`} className="block font-semibold after:absolute after:inset-0 after:content-['']">{d.client_name}</Link>
      {d.business_name && <div className="text-xs text-ink-500">{d.business_name}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {d.lead_temperature && <Badge tone={TEMPERATURE_TONE[d.lead_temperature]}>{TEMPERATURE[d.lead_temperature]}</Badge>}
        {d.stage === "Signed / Finance Pending" && <Badge tone="warn">عند المالية</Badge>}
        {owners.length > 1 && <span className="text-xs text-ink-500">{d.owner_name}</span>}
      </div>
      {d.followup_at && pipeOf(d.stage) === "follow" && <div className={`mt-1.5 text-xs ${d.overdue > 0 ? "font-semibold text-bad" : "text-ink-500"}`}>{d.overdue > 0 ? "⏰ المتابعة فاتت: " : "المتابعة: "}{fmtDateTime(d.followup_at)}</div>}
      <div className="relative z-10 mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        {d.phone ? <a href={`tel:${d.phone}`} dir="ltr" className="font-mono text-xs text-ink-500 hover:text-burgundy-600">{d.phone}</a> : <span />}
        {edit && <DealActions compact deal={{ id: d.id, stage: d.stage, client_name: d.client_name }} />}
      </div>
    </article>);
  return (
    <>
      <PageHeader title="خط المبيعات" sub="4 خطوات بس: جديد ← بتابعه ← العقد ← اتقفل. كل عميل عليه زراير: «بتابعه» (بميعاد) أو «اعمل عقد» أو «خسرناه»." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox className="w-full max-w-md" />
        {overdue > 0 && <span className="rounded-full bg-bad/10 px-3 py-1 text-sm font-semibold text-bad">⏰ {overdue} متابعة فاتت</span>}
        <Link href={link({ col: showLost ? undefined : "lost" })} className={`rounded-full px-3 py-1 text-sm ${showLost ? "bg-charcoal font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>خسرناهم · {lost.length}</Link>
        {owners.length > 1 && (
          <span className="ms-auto flex flex-wrap items-center gap-2 text-sm">
            {sp.owner && <Link href={link({ owner: undefined })} className="text-burgundy-600 underline">كل السيلز</Link>}
            {owners.map(([id, name]) => <Link key={id} href={link({ owner: sp.owner === id ? undefined : id })} className={`rounded-full px-3 py-1 ${sp.owner === id ? "bg-charcoal font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>{name}</Link>)}
          </span>)}
      </div>
      {all.length === 0 ? <Empty title={sp.q ? `لا توجد نتائج لـ «${sp.q}»` : "مفيش عملاء في الخط لسه"} hint="العميل بيظهر هنا أول ما تقبله من التيلي سيلز." /> : showLost ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lost.length === 0 ? <Empty title="مفيش عملاء خسرناهم" /> : lost.map((d: any) => (
            <article key={d.id} className="rounded-lg border border-line bg-white p-3 text-sm"><Link href={`/deals/${d.id}`} className="font-semibold hover:underline">{d.client_name}</Link>
              <p className="mt-1 text-xs text-ink-500">{d.lost_reason ?? "—"}</p><p className="text-xs text-ink-500">{d.owner_name}</p></article>))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="خط المبيعات">
          {PIPE.map((p) => {
            const list = col(p.key), total = list.reduce((a: number, d: any) => a + Number(d.expected_value ?? 0), 0);
            return (
              <section key={p.key} className="min-w-0 overflow-hidden rounded-xl border border-line bg-cream-dark/50" aria-label={p.label}>
                <div className={`h-1.5 ${p.bar}`} />
                <header className="px-3 pt-2.5">
                  <div className="flex items-center justify-between"><h2 className="font-bold">{p.label}</h2><span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold">{list.length}</span></div>
                  <p className="text-[11px] text-ink-500">{p.hint}{total > 0 ? ` · ${fmtMoney(total)}` : ""}</p>
                </header>
                <div className="max-h-[calc(100vh-300px)] min-h-24 space-y-2 overflow-y-auto p-2">
                  {list.length === 0 ? <p className="px-2 py-6 text-center text-xs text-ink-500">مفيش</p> : list.map(card)}
                </div>
              </section>);
          })}
        </div>)}
    </>
  );
}
