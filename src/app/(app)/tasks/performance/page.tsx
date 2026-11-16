import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { techPerformance } from "@/server/data";
import { Empty, PageHeader, Table, td } from "@/components/ui";
import { fmtMins, monthStart } from "@/lib/format";

export const metadata = { title: "أداء الفريق التقني" };
export const dynamic = "force-dynamic";

export default async function Performance({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requireSession();
  if (!["super_admin", "general_manager", "operations_manager"].includes(s.role)) notFound();
  const sp = await searchParams;
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? `${sp.m}-01` : monthStart();
  const rows = await techPerformance(s.userId, month);
  const shift = (n: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const btn = "rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream";
  return (
    <>
      <PageHeader title="أداء الفريق التقني" sub={`شهر ${month.slice(0, 7)} — التاسكات اللي اتبعتت واتعتمدت والوقت المتسجل في الشهر. «مفتوح» و«متأخر» و«مستني مراجعة» هي الوضع الحالي.`}
        actions={<><Link href={`/tasks/performance?m=${shift(-1)}`} className={btn}>الشهر اللي فات</Link>{month < monthStart() && <Link href={`/tasks/performance?m=${shift(1)}`} className={btn}>الشهر اللي بعده</Link>}
          <Link href="/tasks" className={btn}>التاسكات</Link></>} />
      {rows.length === 0 ? <Empty title="مفيش موظفين تقنيين لسه" /> : (
        <Table head={["الموظف", "اتبعتله", "اتعتمد", "في الميعاد", "تعديلات", "الوقت الفعلي", "المتوقع", "مفتوح الآن", "متأخر الآن", "مستني مراجعة"]}>
          {rows.map((r) => (
            <tr key={r.employee_id}>
              <td className={td}><span className="font-semibold">{r.full_name}</span><div className="text-xs text-ink-500">{r.role_name}</div></td>
              <td className={td + " tabular-nums"}>{r.assigned}</td>
              <td className={td + " tabular-nums"}>{r.approved}</td>
              <td className={td + " tabular-nums"}>{r.on_time_base ? `${Math.round((r.on_time / r.on_time_base) * 100)}% (${r.on_time}/${r.on_time_base})` : "—"}</td>
              <td className={td + " tabular-nums"}>{r.revisions}</td>
              <td className={td + " whitespace-nowrap tabular-nums"}>{fmtMins(r.minutes)}</td>
              <td className={td + " tabular-nums"}>{Number(r.estimated_hours) ? `${Number(r.estimated_hours)} س` : "—"}</td>
              <td className={td + " tabular-nums"}>{r.open_now}</td>
              <td className={td + " tabular-nums " + (r.late_now ? "font-bold text-bad" : "")}>{r.late_now}</td>
              <td className={td + " tabular-nums"}>{r.pending_review}</td>
            </tr>))}
        </Table>)}
    </>
  );
}
