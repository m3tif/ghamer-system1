import { SearchBox } from "@/components/search-box";
import Link from "next/link";
import { can, requireSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { archiveLeads, archiveMonths, employeeList } from "@/server/data";
import { Badge, Card, Empty, PageHeader, Pager, Table, td } from "@/components/ui";
import { inputCls } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";
import { HANDOFF_STATUS, LEAD_STATUS, LEAD_STATUS_TONE } from "@/lib/labels";

export const metadata = { title: "الأرشيف الشهري" };
export const dynamic = "force-dynamic";
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const label = (d: string | Date) => { const x = new Date(d); return `${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const ym = (d: string | Date) => new Date(d).toISOString().slice(0, 7);

export default async function Archive({ searchParams }: { searchParams: Promise<{ emp?: string; month?: string; status?: string; page?: string; q?: string }> }) {
  const s = await requireSession();
  if (!can(s, "leads.view") && !can(s, "leads.create")) notFound();
  const sp = await searchParams;
  const emps: any[] = can(s, "employees.view") ? (await employeeList(s.userId)).filter((e: any) => ["tele_sales", "sales_rep", "tele_sales_manager", "sales_manager"].includes(e.role_code)) : [];
  const isAdmin = s.role === "super_admin" || s.role === "general_manager";
  const emp = sp.emp || (isAdmin ? "" : s.userId);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : null;
  const months = emp || !isAdmin ? await archiveMonths(s.userId, emp || null) : [];
  const { rows, total, page } = await archiveLeads(s.userId, { emp: emp || null, month, status: sp.status || null, page: Number(sp.page) || 1, q: sp.q });
  const q = (o: Record<string, string | undefined>) => `/archive?${new URLSearchParams(Object.fromEntries(Object.entries({ emp: sp.emp, month: sp.month, status: sp.status, q: sp.q, ...o }).filter(([, v]) => v)) as Record<string, string>)}`;
  return (
    <>
      <PageHeader title="الأرشيف الشهري" sub="سجل كامل لكل شهر. لا يمكن حذف أي سجل منه أو تغيير تاريخ إضافته." />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <SearchBox className="w-full sm:w-72" />
        {emps.length > 0 && (
          <select name="emp" defaultValue={sp.emp ?? ""} className={inputCls + " max-w-56"} aria-label="الموظف">
            {isAdmin ? <option value="">كل الموظفين</option> : <option value="">أنا</option>}
            {emps.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>)}
        <input type="month" name="month" defaultValue={sp.month} className={inputCls + " max-w-44"} aria-label="الشهر" />
        <select name="status" defaultValue={sp.status ?? ""} className={inputCls + " max-w-48"} aria-label="الحالة"><option value="">كل الحالات</option>
          {Object.entries(LEAD_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-cream">تصفية</button>
      </form>
      {months.length > 0 && (
        <div className="mb-6"><Card title="ملخص الأشهر">
          <Table head={["الشهر", "عملاء أضيفوا", "حُوّلوا إلى Sales", "استُلموا", "اجتماعات منعقدة", "إنجازات", ""]}>
            {months.map((m: any) => (
              <tr key={String(m.month)}><td className={td + " font-medium"}>{label(m.month)}</td><td className={td}>{m.leads}</td><td className={td}>{m.handed_off}</td>
                <td className={td}>{m.received}</td><td className={td}>{m.meetings_completed}</td><td className={td}>{m.achievements > 0 ? <Badge tone="brand">★ {m.achievements}</Badge> : "—"}</td>
                <td className={td}><Link className="text-sm text-burgundy-600 underline" href={q({ month: ym(m.month), page: undefined })}>عرض العملاء</Link></td></tr>))}
          </Table></Card></div>)}
      {rows.length === 0 ? <Empty title={sp.q ? `لا توجد نتائج لـ «${sp.q}»` : "لا توجد سجلات"} hint="غيّر كلمة البحث أو الشهر أو الموظف أو الحالة." /> : (
        <Table head={["العميل", "تاريخ الإضافة", "الحالة", "أضافه", "المسؤول الآن", "التحويل"]}>
          {rows.map((l: any) => (
            <tr key={l.lead_id}>
              <td className={td + " font-medium"}>{l.can_open ? <Link className="hover:underline" href={`/leads/${l.lead_id}`}>{l.client_name}</Link> : <span title="تم تحويله إلى Sales">{l.client_name}</span>}
                {l.business_name && <div className="text-xs text-ink-500">{l.business_name}</div>}</td>
              <td className={td + " text-ink-500"}>{fmtDateTime(l.created_at)}</td>
              <td className={td}><Badge tone={LEAD_STATUS_TONE[l.lead_status]}>{LEAD_STATUS[l.lead_status]}</Badge></td>
              <td className={td}>{l.creator_name}</td><td className={td}>{l.owner_name}</td>
              <td className={td}>{l.handoff_status ? HANDOFF_STATUS[l.handoff_status] : "—"}</td></tr>))}
        </Table>)}
      <Pager base={q({ page: undefined })} page={page} total={total} />
    </>
  );
}
