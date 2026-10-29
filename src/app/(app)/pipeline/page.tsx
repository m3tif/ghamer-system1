import Link from "next/link";
import { requirePerm, requireSession } from "@/lib/auth";
import { listDeals, filterByClientSearch } from "@/server/data";
import { SearchBox } from "@/components/search-box";
import { Empty, PageHeader } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { DEAL_STAGES, DEAL_STAGE, TEMPERATURE, TEMPERATURE_TONE } from "@/lib/labels";
import { Badge } from "@/components/ui";

export const metadata = { title: "خط المبيعات" };
export const dynamic = "force-dynamic";

// stage → top-bar colour (tailwind classes), grouped by progress: early / meeting / proposal / closing / won / lost
const BAR: Record<string, string> = {
  "New Lead": "bg-ink-300", "Contacted": "bg-ink-300", "Qualified": "bg-burgundy-200",
  "Meeting Scheduled": "bg-burgundy-500", "Meeting Completed": "bg-burgundy-500",
  "Proposal Preparation": "bg-warn", "Proposal Sent": "bg-warn", "Negotiation": "bg-warn", "Follow-up": "bg-warn", "Postponed": "bg-ink-500",
  "Contract Pending": "bg-ok", "Signed / Finance Pending": "bg-ok", "Financially Approved": "bg-ok", "Lost": "bg-bad",
};
type SP = { stage?: string; owner?: string; q?: string };

export default async function Pipeline({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession(); await requirePerm(s, "deals.view");
  const sp = await searchParams;
  const all = await filterByClientSearch(s.userId, await listDeals(s.userId), sp.q);
  const owners = [...new Map(all.map((d: any) => [d.owner_sales_id, d.owner_name])).entries()] as [string, string][];
  const multi = owners.length > 1;
  const deals = all.filter((d: any) => !sp.owner || d.owner_sales_id === sp.owner);
  const stage = DEAL_STAGES.includes(sp.stage as any) ? sp.stage! : undefined;
  const open = deals.filter((d: any) => !["Lost", "Financially Approved"].includes(d.stage));
  const value = open.reduce((a: number, d: any) => a + Number(d.expected_value ?? 0), 0);
  const overdue = deals.filter((d: any) => d.overdue > 0).length;
  const won = deals.filter((d: any) => d.stage === "Financially Approved").length;
  const lost = deals.filter((d: any) => d.stage === "Lost").length;
  const link = (o: SP) => { const p = new URLSearchParams(); const m = { ...sp, ...o }; if (m.stage) p.set("stage", m.stage); if (m.owner) p.set("owner", m.owner); if (m.q) p.set("q", m.q); return `/pipeline${p.size ? `?${p}` : ""}`; };
  const shown = stage ? [stage] : DEAL_STAGES.filter((st) => deals.some((d: any) => d.stage === st));
  const kpi = "rounded-lg border border-line bg-white px-4 py-3";
  return (
    <>
      <PageHeader title="خط المبيعات" sub="اضغط على أي بطاقة لفتح الصفقة، وعلى اسم العميل لفتح ملفه، وعلى المرحلة لتصفية الخط." />
      <SearchBox className="mb-4 max-w-md" />
      {all.length === 0 ? <Empty title={sp.q ? `لا توجد نتائج لـ «${sp.q}»` : "لا توجد صفقات بعد"} hint="تظهر الصفقة تلقائيًا عند قبول عميل من التيلي سيلز أو حجز اجتماع." /> : (<>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Link href={link({ stage: undefined })} className={kpi + " hover:border-burgundy-600"}><div className="text-xs text-ink-500">صفقات مفتوحة</div><div className="text-2xl font-bold">{open.length}</div></Link>
          <div className={kpi}><div className="text-xs text-ink-500">القيمة المتوقعة</div><div className="text-2xl font-bold">{value ? fmtMoney(value) : "—"}</div></div>
          <div className={kpi}><div className="text-xs text-ink-500">متابعات متأخرة</div><div className={`text-2xl font-bold ${overdue ? "text-bad" : ""}`}>{overdue}</div></div>
          <Link href={link({ stage: "Financially Approved" })} className={kpi + " hover:border-burgundy-600"}><div className="text-xs text-ink-500">معتمدة ماليًا</div><div className="text-2xl font-bold text-ok">{won}</div></Link>
          <Link href={link({ stage: "Lost" })} className={kpi + " hover:border-burgundy-600"}><div className="text-xs text-ink-500">خسرناها</div><div className="text-2xl font-bold">{lost}</div></Link>
        </div>

        <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm" aria-label="تصفية المراحل">
          <Link href={link({ stage: undefined })} className={`rounded-full px-3 py-1 ${!stage ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>كل المراحل</Link>
          {DEAL_STAGES.map((st) => {
            const n = deals.filter((d: any) => d.stage === st).length;
            if (!n && stage !== st) return null;
            return <Link key={st} href={link({ stage: stage === st ? undefined : st })} className={`rounded-full px-3 py-1 ${stage === st ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>{DEAL_STAGE[st]} · {n}</Link>;
          })}
          {multi && (
            <span className="ms-auto flex flex-wrap items-center gap-2">
              {sp.owner && <Link href={link({ owner: undefined })} className="text-burgundy-600 underline">كل السيلز</Link>}
              {owners.map(([id, name]) => <Link key={id} href={link({ owner: sp.owner === id ? undefined : id })} className={`rounded-full px-3 py-1 ${sp.owner === id ? "bg-charcoal font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>{name}</Link>)}
            </span>)}
        </nav>

        <div className={stage ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "flex gap-3 overflow-x-auto pb-4"} aria-label="خط المبيعات">
          {shown.map((st) => {
            const col = deals.filter((d: any) => d.stage === st);
            const total = col.reduce((a: number, d: any) => a + Number(d.expected_value ?? 0), 0);
            return (
              <section key={st} className={`${stage ? "sm:col-span-2 xl:col-span-3" : "w-72 shrink-0"} overflow-hidden rounded-xl border border-line bg-cream-dark/50`} aria-label={DEAL_STAGE[st]}>
                <div className={`h-1.5 ${BAR[st]}`} />
                <header className="flex items-center justify-between px-3 py-2.5">
                  <Link href={link({ stage: stage === st ? undefined : st })} className="font-bold hover:text-burgundy-600 hover:underline">{DEAL_STAGE[st]}</Link>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold">{col.length}</span>
                </header>
                {total > 0 && <div className="-mt-1 px-3 pb-2 text-xs text-ink-500">{fmtMoney(total)}</div>}
                <div className={stage ? "grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3" : "max-h-[calc(100vh-420px)] min-h-24 space-y-2 overflow-y-auto p-2"}>
                  {col.length === 0 && <p className="px-2 py-6 text-center text-xs text-ink-500">لا توجد صفقات</p>}
                  {col.map((d: any) => (
                    <article key={d.id} className={`relative rounded-lg border bg-white p-3 text-sm shadow-sm transition hover:-translate-y-px hover:border-burgundy-600 hover:shadow ${d.overdue > 0 ? "border-bad/50" : "border-line"}`}>
                      <Link href={`/deals/${d.id}`} className="block font-semibold after:absolute after:inset-0 after:content-['']">{d.client_name}</Link>
                      {d.business_name && <div className="text-xs text-ink-500">{d.business_name}</div>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {d.lead_temperature && <Badge tone={TEMPERATURE_TONE[d.lead_temperature]}>{TEMPERATURE[d.lead_temperature]}</Badge>}
                        {d.win_probability != null && <span className="rounded-full bg-cream px-2 py-0.5 text-xs">{d.win_probability}% احتمال</span>}
                        {d.expected_value != null && <span className="rounded-full bg-cream px-2 py-0.5 text-xs">{fmtMoney(d.expected_value)}</span>}
                      </div>
                      <div className="mt-2 text-xs text-ink-500">السيلز: {d.owner_name}</div>
                      {d.followup_at && <div className={`mt-1 text-xs ${d.overdue > 0 ? "font-semibold text-bad" : "text-ink-500"}`}>{d.overdue > 0 ? "متابعة متأخرة · " : "المتابعة: "}{fmtDateTime(d.followup_at)}</div>}
                      <div className="relative z-10 mt-2.5 flex items-center gap-3 border-t border-line pt-2 text-xs">
                        <Link href={`/leads/${d.lead_id}`} className="text-burgundy-600 hover:underline">ملف العميل</Link>
                        {d.phone && <a href={`tel:${d.phone}`} dir="ltr" className="font-mono text-ink-500 hover:text-burgundy-600">{d.phone}</a>}
                      </div>
                    </article>))}
                </div>
              </section>);
          })}
        </div>
      </>)}
    </>
  );
}
