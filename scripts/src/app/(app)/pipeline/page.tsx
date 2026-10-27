import Link from "next/link";
import { requirePerm, requireSession } from "@/lib/auth";
import { listDeals } from "@/server/data";
import { Empty, PageHeader } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { DEAL_STAGES, DEAL_STAGE } from "@/lib/labels";

export const metadata = { title: "خط المبيعات" };
export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const s = await requireSession(); await requirePerm(s, "deals.view");
  const deals = await listDeals(s.userId);
  return (
    <>
      <PageHeader title="خط المبيعات" sub="اضغط على أي صفقة لتحديث مرحلتها وتعديل البريف." />
      {deals.length === 0 ? <Empty title="لا توجد صفقات بعد" hint="تظهر الصفقة تلقائيًا عند حجز اجتماع لك أو تسجيل عميل مباشرة." /> : (
        <div className="flex gap-3 overflow-x-auto pb-4" aria-label="لوحة كانبان">
          {DEAL_STAGES.map((st) => {
            const col = deals.filter((d: any) => d.stage === st);
            const total = col.reduce((a: number, d: any) => a + Number(d.expected_value ?? 0), 0);
            return (
              <section key={st} className="w-64 shrink-0 rounded-lg bg-cream-dark/60 p-2" aria-label={DEAL_STAGE[st]}>
                <header className="mb-2 flex items-center justify-between px-1 text-sm font-bold"><span>{DEAL_STAGE[st]}</span>
                  <span className="rounded-full bg-white px-2 text-xs">{col.length}</span></header>
                {total > 0 && <div className="mb-2 px-1 text-xs text-ink-500">{fmtMoney(total)}</div>}
                <div className="space-y-2">
                  {col.map((d: any) => (
                    <Link key={d.id} href={`/deals/${d.id}`} className="block rounded-md border border-line bg-white p-3 text-sm hover:border-burgundy-600">
                      <div className="font-semibold">{d.client_name}</div>
                      {d.business_name && <div className="text-xs text-ink-500">{d.business_name}</div>}
                      <div className="mt-2 flex items-center justify-between text-xs text-ink-500"><span>{d.owner_name}</span>{d.win_probability != null && <span>{d.win_probability}%</span>}</div>
                      {d.overdue > 0 && <div className="mt-1 text-xs font-semibold text-bad">متابعة متأخرة</div>}
                    </Link>))}
                </div>
              </section>);
          })}
        </div>)}
    </>
  );
}
