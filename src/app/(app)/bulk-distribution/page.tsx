import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { distList } from "@/server/data";
import { Badge, Card, Empty, PageHeader, Table, td } from "@/components/ui";
import { DistributionUpload } from "@/components/distribution-client";
import { IMPORT_STATUS as ST } from "@/lib/import-labels";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "استيراد وتوزيع العملاء" };
export const dynamic = "force-dynamic";
export default async function BulkDistributionPage() {
  const s = await requireSession();
  if (!can(s, "leads.bulk_distribute")) notFound();
  const list = await distList(s.userId);
  return (
    <>
      <PageHeader title="استيراد وتوزيع العملاء" sub="ضع رابط Google Sheets، اختر موظفي Tele Sales، راجع المعاينة ثم أكّد. يُضاف الجدد فقط ويُوزَّعون بالتساوي. المكرر بالرقم يُستبعد ولا يتغير الموجود." />
      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="جدول جديد"><DistributionUpload /></Card>
        <Card title="كيف يعمل؟">
          <ol className="list-decimal space-y-1.5 ps-5 text-sm leading-6">
            <li>ضع الرابط (أو ارفع ملفًا) وسيُقرأ الجدول ويُفحص التكرار مقابل كل عملاء النظام.</li>
            <li>راجع ربط الأعمدة (رابط المتجر، الهاتف، Hunter، التاريخ، الحالة، الملاحظات).</li>
            <li>اختر الموظفين، وستظهر حصة كل واحد.</li>
            <li>اضغط «تأكيد»: تُنفَّذ العملية كلها دفعة واحدة أو لا تُنفَّذ.</li>
          </ol>
        </Card>
      </div>
      <h2 className="mb-2 text-base font-semibold">العمليات السابقة</h2>
      {list.length === 0 ? <Empty title="لا توجد عمليات توزيع بعد" /> : (
        <Table head={["الملف", "نفّذها", "متى", "الصفوف", "الجدد", "المكرر", "الذين وُزِّع عليهم", "الحالة", ""]}>
          {list.map((b) => { const [lbl, tone] = ST[b.status] ?? [b.status, "neutral" as const]; return (
            <tr key={b.id}><td className={td + " max-w-56 truncate font-medium"} title={b.source_url ?? b.file_name}>{b.file_name}</td><td className={td}>{b.imported_by_name}</td><td className={td + " whitespace-nowrap"}>{fmtDateTime(b.finished_at ?? b.created_at)}</td>
              <td className={td}>{b.rows_total}</td><td className={td}>{b.status === "completed" ? b.c_imported : b.c_new}</td><td className={td}>{b.c_duplicate}</td>
              <td className={td + " text-xs leading-5"}>{b.split ?? "—"}</td><td className={td}><Badge tone={tone}>{lbl}</Badge></td>
              <td className={td}><Link className="text-burgundy-600 underline" href={`/bulk-distribution/${b.id}`}>فتح</Link></td></tr>); })}
        </Table>)}
    </>
  );
}
