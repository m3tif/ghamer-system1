import Link from "next/link";
import { requirePerm, requireSession } from "@/lib/auth";
import { listFollowUps } from "@/server/data";
import { completeFollowUpAction } from "@/server/actions";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/format";

export const metadata = { title: "المتابعات" };
export const dynamic = "force-dynamic";

const dayKey = (v: string) => fmtDay(v);

export default async function FollowUps() {
  const s = await requireSession(); await requirePerm(s, "followups.manage");
  const rows = await listFollowUps(s.userId, "open");
  const overdue = rows.filter((r: any) => r.overdue);
  const groups = new Map<string, any[]>();
  for (const r of rows.filter((x: any) => !x.overdue)) { const k = dayKey(r.due_at); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const item = (f: any) => (
    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <div><Link href={`/leads/${f.lead_id}`} className="font-semibold hover:underline">{f.client_name}</Link>
        <div className="text-ink-500">{f.reason}{f.owner_name ? ` · ${f.owner_name}` : ""}</div></div>
      <div className="flex items-center gap-3"><span className={f.overdue ? "font-semibold text-bad" : "text-ink-500"}>{fmtDateTime(f.due_at)}</span>
        <form action={completeFollowUpAction}><input type="hidden" name="id" value={f.id} /><button className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium hover:bg-cream">تمت</button></form></div>
    </li>);
  return (
    <>
      <PageHeader title="المتابعات" sub="المتأخرة أولًا، ثم القادمة مجمّعة حسب اليوم." />
      {rows.length === 0 ? <Empty title="لا توجد متابعات مفتوحة" hint="تُضاف المتابعات عند تسجيل مكالمة أو تأجيل صفقة." /> : (
        <div className="space-y-6">
          {overdue.length > 0 && <Card title={`متأخرة (${overdue.length})`} right={<Badge tone="bad">تحتاج إجراء</Badge>}><ul className="divide-y divide-line">{overdue.map(item)}</ul></Card>}
          {[...groups.entries()].map(([day, list]) => <Card key={day} title={day}><ul className="divide-y divide-line">{list.map(item)}</ul></Card>)}
        </div>)}
    </>
  );
}
