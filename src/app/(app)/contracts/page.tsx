import Link from "next/link";
import { requirePerm, requireSession } from "@/lib/auth";
import { contractList } from "@/server/data";
import { Badge, Empty, PageHeader, Pager, Table, td } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { fmtDate, fmtSar } from "@/lib/format";
import { CONTRACT_STATUS, CONTRACT_STATUS_TONE } from "@/lib/labels";

export const metadata = { title: "العقود" };
export const dynamic = "force-dynamic";

export default async function Contracts({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const s = await requireSession(); await requirePerm(s, "contracts.view");
  const sp = await searchParams;
  const status = sp.status && sp.status in CONTRACT_STATUS ? sp.status : "";
  const { rows, total, page } = await contractList(s.userId, { status, q: sp.q, page: Number(sp.page) || 1 });
  const link = (o: Record<string, string | undefined>) => `/contracts?${new URLSearchParams(Object.fromEntries(Object.entries({ status, q: sp.q, ...o }).filter(([, v]) => v)) as Record<string, string>)}`;
  const isSales = s.role === "sales_rep" || s.role === "sales_manager";
  return (
    <>
      <PageHeader title="العقود" sub={isSales ? "عقود صفقاتك. اكتب العقد من صفحة الصفقة، ارفع النسخة الموقّعة، وابعته للمالية." : "كل العقود. اللي عند المالية بتظهر فوق."} />
      <div className="mb-3 flex flex-wrap gap-2 text-sm" role="tablist" aria-label="حالة العقد">
        {[["", "الكل"], ...Object.entries(CONTRACT_STATUS)].map(([k, l]) => (
          <Link key={k} href={link({ status: k || undefined, page: undefined })} role="tab" aria-selected={status === k}
            className={`rounded-md border px-3 py-1.5 font-medium ${status === k ? "border-burgundy-600 bg-burgundy-600 text-white" : "border-line bg-white hover:bg-cream"}`}>{l}</Link>))}
      </div>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        <SearchBox className="min-w-64 max-w-md flex-1" />
        <button className="rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700">بحث</button>
        {sp.q && <Link href={link({ q: undefined, page: undefined })} className="self-center text-sm text-burgundy-600 underline">مسح البحث</Link>}
      </form>
      {rows.length === 0 ? <Empty title={sp.q || status ? "لا توجد عقود بهذه الشروط" : "لا توجد عقود بعد"} hint={isSales ? "افتح الصفقة من «خط المبيعات» واضغط «إنشاء عقد»." : undefined} /> : (
        <>
          <p className="mb-2 text-xs text-ink-500">{total} عقد</p>
          <Table head={["رقم العقد", "العميل", "السيلز", "الإجمالي (شامل الضريبة)", "البداية", "النهاية", "الحالة", "الموقّع"]}>
            {rows.map((c: any) => (
              <tr key={c.id}>
                <td className={td + " whitespace-nowrap font-medium"}><Link href={`/contracts/${c.id}`} className="text-burgundy-700 hover:underline" dir="ltr">{c.contract_no}</Link></td>
                <td className={td}>{c.client_name}{c.business_name && <span className="block text-xs text-ink-500">{c.business_name}</span>}</td>
                <td className={td}>{c.sales_name}</td>
                <td className={td + " whitespace-nowrap tabular-nums"}>{fmtSar(c.total_amount)}</td>
                <td className={td + " whitespace-nowrap text-ink-500"}>{fmtDate(c.start_date)}</td>
                <td className={td + " whitespace-nowrap text-ink-500"}>{fmtDate(c.end_date)}</td>
                <td className={td}><Badge tone={CONTRACT_STATUS_TONE[c.status]}>{CONTRACT_STATUS[c.status]}</Badge></td>
                <td className={td}>{c.has_signed ? <span className="text-ok">✓ مرفوع</span> : <span className="text-warn">لسه</span>}</td>
              </tr>))}
          </Table>
          <Pager base={link({ page: undefined })} page={page} total={total} />
        </>)}
    </>
  );
}
