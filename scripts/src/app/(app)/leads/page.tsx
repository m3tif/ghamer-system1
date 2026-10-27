import Link from "next/link";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { addedCounts, employeeList, listLeads, myOutcomes } from "@/server/data";
import { Badge, ButtonLink, Empty, PageHeader, Pager, Table, td } from "@/components/ui";
import { inputCls } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";
import { HANDOFF_STATUS, HANDOFF_TONE, LEAD_STATUS, LEAD_STATUS_TONE, MEETING_STATUS, TEMPERATURE, TEMPERATURE_TONE } from "@/lib/labels";

export const metadata = { title: "العملاء اللي ضفتهم" };
export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; page?: string; month?: string; creator?: string; tab?: string; handed?: string; temp?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession(); await requirePerm(s, "leads.view");
  const sp = await searchParams;
  // employees see the leads THEY added; managers/admin see everything in their scope and can filter by employee
  const employee = ["tele_sales", "sales_rep"].includes(s.role);
  const tab = sp.tab === "handed" && can(s, "leads.handoff") ? "handed" : "mine";
  const emps = !employee && can(s, "employees.view") ? (await employeeList(s.userId)).filter((e: any) => ["tele_sales", "sales_rep"].includes(e.role_code)) : [];
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : undefined;
  const creator = employee ? s.userId : sp.creator || undefined;
  const temp = ["cold", "warm", "hot"].includes(sp.temp ?? "") ? sp.temp : undefined;
  const [list, counts, outcomes] = await Promise.all([
    tab === "mine" ? listLeads(s.userId, { q: sp.q, status: sp.status, page: Number(sp.page) || 1, month, creator, temp }) : { rows: [] as any[], total: 0, page: 1 },
    employee || can(s, "leads.create") ? addedCounts(s.userId, s.userId) : null,
    tab === "handed" ? myOutcomes(s.userId) : [],
  ]);
  const { rows, total, page } = list;
  const title = employee ? "العملاء اللي ضفتهم" : "العملاء";
  const base = `/leads?${new URLSearchParams(Object.fromEntries(Object.entries({ q: sp.q, status: sp.status, month: sp.month, creator: sp.creator, temp }).filter(([, v]) => v)) as Record<string, string>)}`;
  const tabCls = (on: boolean) => `rounded-md px-3.5 py-2 text-sm ${on ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`;
  return (
    <>
      <PageHeader title={title}
        sub={counts && employee ? `أضفت ${counts.total} عميل · ${counts.this_month} هذا الشهر · حوّلت ${counts.handed_off} (قُبل ${counts.accepted}، رُفض ${counts.rejected})` : tab === "mine" ? `${total} سجل ضمن صلاحياتك` : undefined}
        actions={can(s, "leads.create") ? <ButtonLink href="/leads/new">تسجيل عميل جديد</ButtonLink> : null} />
      {sp.handed && <p role="status" className="mb-4 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">تم إرسال العميل إلى السيلز. لا يُعتبر مقبولًا حتى يقرر السيلز، وستصلك نتيجة القرار في الإشعارات.</p>}
      {can(s, "leads.handoff") && (
        <div className="mb-4 flex gap-2" role="tablist">
          <Link href="/leads" role="tab" aria-selected={tab === "mine"} className={tabCls(tab === "mine")}>عملائي الحاليون</Link>
          <Link href="/leads?tab=handed" role="tab" aria-selected={tab === "handed"} className={tabCls(tab === "handed")}>تم تحويلها إلى السيلز</Link>
        </div>)}
      {tab === "mine" ? (<>
        <form className="mb-4 flex flex-wrap gap-2" role="search">
          <input name="q" defaultValue={sp.q} placeholder="بحث بالاسم أو النشاط أو رقم الجوال" className={inputCls + " min-w-64 max-w-md flex-1"} aria-label="بحث" />
          <select name="status" defaultValue={sp.status ?? ""} className={inputCls + " w-auto"} aria-label="الحالة">
            <option value="">كل الحالات</option>{Object.entries(LEAD_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select name="temp" defaultValue={temp ?? ""} className={inputCls + " w-auto"} aria-label="درجة التواصل">
            <option value="">كل الدرجات</option>{Object.entries(TEMPERATURE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input type="month" name="month" defaultValue={sp.month} className={inputCls + " w-auto"} aria-label="الشهر" />
          {emps.length > 0 && (
            <select name="creator" defaultValue={sp.creator ?? ""} className={inputCls + " w-auto"} aria-label="الموظف">
              <option value="">كل الموظفين</option>{emps.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>)}
          <button className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-cream">تصفية</button>
        </form>
        {rows.length === 0 ? <Empty title="لا توجد نتائج" hint={sp.q || sp.status || sp.month || temp ? "جرّب تغيير البحث أو الفلاتر." : "سجّل أول عميل ليظهر هنا."} /> : (
          <Table head={["العميل", "الجوال", "الحالة", "الدرجة", "أضافه", "المسؤول", "السيلز", "المتابعة القادمة"]}>
            {rows.map((l: any) => (
              <tr key={l.id} className="hover:bg-cream/40">
                <td className={td}><Link href={`/leads/${l.id}`} className="font-semibold hover:underline">{l.name}</Link>{l.business_name && <div className="text-xs text-ink-500">{l.business_name}</div>}</td>
                <td className={td} dir="ltr">{l.phone ?? "—"}</td>
                <td className={td}><Badge tone={LEAD_STATUS_TONE[l.lead_status]}>{LEAD_STATUS[l.lead_status]}</Badge></td>
                <td className={td}>{l.lead_temperature ? <Badge tone={TEMPERATURE_TONE[l.lead_temperature]}>{TEMPERATURE[l.lead_temperature]}</Badge> : <span className="text-ink-300">—</span>}</td>
                <td className={td}>{l.creator}</td><td className={td}>{l.owner}</td><td className={td}>{l.sales ?? "—"}</td>
                <td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(l.next_followup_at)}</td>
              </tr>))}
          </Table>)}
        <Pager base={base} page={page} total={total} />
      </>) : outcomes.length === 0 ? <Empty title="لم تحوّل أي عميل بعد" hint="حوّل العملاء المهتمين من صفحة العميل بعد تغيير حالته إلى «مهتم» أو «مؤهل»." /> : (
        <Table head={["العميل", "وقت التحويل", "حالة التحويل", "السيلز", "وقت القرار", "الاجتماع", "نتيجة الصفقة"]}>
          {outcomes.map((o: any) => (
            <tr key={o.lead_id}><td className={td + " font-medium"}>{o.client_name}</td><td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(o.handed_off_at)}</td>
              <td className={td}><Badge tone={HANDOFF_TONE[o.handoff_status] ?? "neutral"}>{HANDOFF_STATUS[o.handoff_status] ?? "—"}</Badge></td>
              <td className={td}>{o.to_name ?? "—"}</td><td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(o.decided_at)}</td>
              <td className={td}>{o.meeting_status ? MEETING_STATUS[o.meeting_status] : "—"}</td>
              <td className={td}>{o.deal_outcome === "won" ? <Badge tone="ok">تم التعاقد</Badge> : o.deal_outcome === "lost" ? <Badge tone="bad">خسرناه</Badge> : o.deal_outcome === "open" ? <Badge tone="warn">قيد التفاوض</Badge> : "—"}</td></tr>))}
        </Table>)}
    </>
  );
}
