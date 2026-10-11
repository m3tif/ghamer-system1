import Link from "next/link";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { listLeads } from "@/server/data";
import { Badge, ButtonLink, Empty, PageHeader, Pager, Table, td } from "@/components/ui";
import { inputCls } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";
import { LEAD_STATUS } from "@/lib/labels";

export const metadata = { title: "العملاء المحتملون" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const s = await requireSession(); await requirePerm(s, "leads.view");
  const sp = await searchParams;
  const { rows, total, page } = await listLeads(s.userId, { q: sp.q, status: sp.status, page: Number(sp.page) || 1 });
  const base = `/leads?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}) })}`;
  return (
    <>
      <PageHeader title="العملاء المحتملون" sub={`${total} سجل ضمن صلاحياتك`} actions={can(s, "leads.create") ? <ButtonLink href="/leads/new">تسجيل عميل جديد</ButtonLink> : null} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="بحث بالاسم أو النشاط أو رقم الجوال" className={inputCls + " max-w-sm"} aria-label="بحث" />
        <select name="status" defaultValue={sp.status ?? ""} className={inputCls + " max-w-48"} aria-label="الحالة">
          <option value="">كل الحالات</option>{Object.entries(LEAD_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-cream">تصفية</button>
      </form>
      {rows.length === 0 ? <Empty title="لا توجد نتائج" hint={sp.q || sp.status ? "جرّب تغيير البحث أو الحالة." : "سجّل أول عميل ليظهر هنا."} /> : (
        <Table head={["العميل", "الجوال", "الحالة", "المسجِّل", "المسؤول", "المبيعات", "المتابعة القادمة"]}>
          {rows.map((l: any) => (
            <tr key={l.id} className="hover:bg-cream/40">
              <td className={td}><Link href={`/leads/${l.id}`} className="font-semibold hover:underline">{l.name}</Link>{l.business_name && <div className="text-xs text-ink-500">{l.business_name}</div>}</td>
              <td className={td} dir="ltr">{l.phone ?? "—"}</td>
              <td className={td}><Badge tone={l.lead_status === "Interested" ? "ok" : l.lead_status === "Not Interested" || l.lead_status === "Invalid Contact" ? "bad" : "neutral"}>{LEAD_STATUS[l.lead_status]}</Badge></td>
              <td className={td}>{l.creator}</td><td className={td}>{l.owner}</td><td className={td}>{l.sales ?? "—"}</td>
              <td className={td + " text-ink-500"}>{fmtDateTime(l.next_followup_at)}</td>
            </tr>))}
        </Table>)}
      <Pager base={base} page={page} total={total} />
    </>
  );
}
