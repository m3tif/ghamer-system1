import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { employeeList, hideLog, hideOverview } from "@/server/data";
import { hidePeriodAction } from "@/server/actions";
import { Badge, Card, PageHeader, Table, td } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "إخفاء وإظهار البيانات" };
export const dynamic = "force-dynamic";
const SCOPE: Record<string, string> = { day: "يوم", month: "شهر", year: "سنة" };

export default async function Visibility({ searchParams }: { searchParams: Promise<{ y?: string; m?: string; emp?: string }> }) {
  const s = await requireSession();
  if (!["super_admin", "general_manager"].includes(s.role)) notFound();
  const sp = await searchParams;
  const now = new Date();
  const y = /^\d{4}$/.test(sp.y ?? "") ? Number(sp.y) : now.getFullYear();
  const m = /^(?:[1-9]|1[0-2])$/.test(sp.m ?? "") ? Number(sp.m) : now.getMonth() + 1;
  const emp = /^[0-9a-f-]{36}$/.test(sp.emp ?? "") ? sp.emp! : null;
  const [days, months, log, emps] = await Promise.all([
    hideOverview(s.userId, "day", y, m, emp), hideOverview(s.userId, "month", y, 1, emp), hideLog(s.userId),
    employeeList(s.userId),
  ]);
  const team = emps.filter((e: any) => ["tele_sales", "sales_rep", "tele_sales_manager", "sales_manager"].includes(e.role_code));
  const status = (r: { total: number; hidden: number; rule_active: boolean }) =>
    r.hidden === 0 ? <Badge tone="ok">ظاهر</Badge> : r.hidden === r.total ? <Badge tone="bad">مخفي</Badge> : <Badge tone="warn">مخفي جزئيًا ({r.hidden}/{r.total})</Badge>;
  const restore = (scope: string, start: string) => (
    <ActionForm action={hidePeriodAction} submit="إظهار" tone="quiet" className="inline">
      <Hidden name="scope" value={scope} /><Hidden name="start" value={start} /><Hidden name="emp" value={emp ?? ""} /><Hidden name="hide" value="0" />
    </ActionForm>);
  const hideBtn = (scope: string, start: string) => (
    <details><summary className="cursor-pointer text-xs text-burgundy-600">إخفاء</summary>
      <ActionForm action={hidePeriodAction} submit="تأكيد الإخفاء" tone="quiet" className="mt-2 w-52 space-y-2">
        <Hidden name="scope" value={scope} /><Hidden name="start" value={start} /><Hidden name="emp" value={emp ?? ""} /><Hidden name="hide" value="1" />
        <Field label="السبب" name="reason" required />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" value="1" /> أؤكد الإخفاء</label>
      </ActionForm></details>);
  const nav = (dy: number, dm: number) => { let yy = y, mm = m + dm; if (mm < 1) { mm = 12; yy--; } if (mm > 12) { mm = 1; yy++; } return `/visibility?y=${yy + dy}&m=${mm}${emp ? `&emp=${emp}` : ""}`; };
  return (
    <>
      <PageHeader title="إخفاء وإظهار البيانات" sub="إخفاء يوم أو شهر أو سنة بالكامل بخطوة واحدة، وعكسه بخطوة واحدة. لا يُحذف شيء ولا تتغير ملكية أي عميل، وأنت تظل ترى كل شيء." />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="y" value={y} /><input type="hidden" name="m" value={m} />
        <select name="emp" defaultValue={emp ?? ""} className="rounded-md border border-line bg-white px-3 py-2 text-sm" aria-label="الموظف">
          <option value="">كل الموظفين</option>{team.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <button className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-cream">تطبيق</button>
      </form>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`الأيام — ${y}/${m}`} right={<span className="flex gap-3 text-sm"><Link className="underline" href={nav(0, -1)}>الشهر السابق</Link><Link className="underline" href={nav(0, 1)}>التالي</Link></span>}>
          {days.length === 0 ? <p className="text-sm text-ink-500">لا توجد بيانات في هذا الشهر.</p> : (
            <Table head={["اليوم", "العملاء", "الحالة", ""]}>
              {days.map((r) => (<tr key={r.period}><td className={td + " tabular-nums"} dir="ltr">{r.period}</td><td className={td}>{r.total}</td><td className={td}>{status(r)}</td>
                <td className={td}>{r.hidden > 0 ? restore("day", r.period) : hideBtn("day", r.period)}</td></tr>))}
            </Table>)}
        </Card>
        <Card title={`الأشهر — ${y}`} right={<span className="flex gap-3 text-sm"><Link className="underline" href={nav(-1, 0)}>{y - 1}</Link><Link className="underline" href={nav(1, 0)}>{y + 1}</Link></span>}>
          {months.length === 0 ? <p className="text-sm text-ink-500">لا توجد بيانات في هذه السنة.</p> : (
            <Table head={["الشهر", "العملاء", "الحالة", ""]}>
              {months.map((r) => (<tr key={r.period}><td className={td + " tabular-nums"} dir="ltr">{r.period.slice(0, 7)}</td><td className={td}>{r.total}</td><td className={td}>{status(r)}</td>
                <td className={td}>{r.hidden > 0 ? restore("month", r.period.slice(0, 7) + "-01") : hideBtn("month", r.period.slice(0, 7))}</td></tr>))}
            </Table>)}
        </Card>
      </div>
      <div className="mt-6"><Card title="سجل عمليات الإخفاء والإظهار">
        {log.length === 0 ? <p className="text-sm text-ink-500">لا توجد عمليات بعد.</p> : (
          <Table head={["النطاق", "الفترة", "الموظف", "السبب", "بواسطة", "متى", "عدد العملاء", "الحالة"]}>
            {log.map((l: any) => (<tr key={l.id}><td className={td}>{SCOPE[l.scope]}</td><td className={td + " tabular-nums"} dir="ltr">{String(l.period_start).slice(0, 10)}{l.scope !== "day" ? ` → ${String(l.period_end).slice(0, 10)}` : ""}</td>
              <td className={td}>{l.employee_name ?? "الكل"}</td><td className={td}>{l.reason ?? "—"}</td><td className={td}>{l.created_by_name}</td><td className={td}>{fmtDateTime(l.created_at)}</td>
              <td className={td}>{l.affected}</td><td className={td}>{l.restored_at ? <span>أُعيد إظهاره · {l.restored_by_name} · {fmtDateTime(l.restored_at)}</span> : <Badge tone="bad">مخفي الآن</Badge>}</td></tr>))}
          </Table>)}
      </Card></div>
    </>
  );
}
