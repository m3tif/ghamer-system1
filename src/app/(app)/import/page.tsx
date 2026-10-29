import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { employeeList, importBatches } from "@/server/data";
import { Badge, ButtonLink, Card, Empty, PageHeader, Table, td } from "@/components/ui";
import { ImportUpload } from "@/components/import-client";
import { IMPORT_STATUS as ST } from "@/lib/import-labels";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "استيراد البيانات السابقة" };
export const dynamic = "force-dynamic";
export default async function ImportPage() {
  const s = await requireSession();
  if (!can(s, "import.own") && !can(s, "import.any")) notFound();
  const any = can(s, "import.any");
  const [batches, emps] = await Promise.all([importBatches(s.userId), any ? employeeList(s.userId) : []]);
  const owners = emps.filter((e: any) => e.is_active && ["tele_sales", "sales_rep", "tele_sales_manager", "sales_manager"].includes(e.role_code)).map((e: any) => ({ id: e.id, name: `${e.full_name} — ${e.role_name_ar}` }));
  return (
    <>
      <PageHeader title="استيراد البيانات السابقة" sub="ارفع ملف Excel أو CSV لعملاء قدامى. الرقم هو معيار التكرار الوحيد، ولا يُستبدل أي عميل موجود تلقائيًا."
        actions={<span className="flex gap-2"><ButtonLink href="/api/import/template?kind=xlsx">تحميل نموذج Excel</ButtonLink><ButtonLink href="/api/import/template?kind=csv">نموذج CSV</ButtonLink></span>} />
      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="رفع ملف جديد"><ImportUpload owners={owners} fixedOwner={s.userId} /></Card>
        <Card title="كيف يعمل؟">
          <ol className="list-decimal space-y-1.5 ps-5 text-sm leading-6">
            <li>حمّل النموذج أو استخدم ملفك (صف العناوين أولًا).</li>
            <li>ارفعه، ثم راجع ربط الأعمدة والمعاينة.</li>
            <li>الجديد يُستورد، والمكرر بالرقم لا يُضاف ويظهر في تقرير.</li>
            <li>الناقص أو المشكوك فيه يذهب «للمراجعة» لتصلحه قبل الاستيراد.</li>
            <li>تاريخ الإضافة الأصلي يُحفظ كما هو، وإن لم يوجد يُسجَّل «غير معروف».</li>
          </ol>
        </Card>
      </div>
      {batches.length === 0 ? <Empty title="لا توجد عمليات استيراد بعد" hint="ارفع أول ملف من الأعلى." /> : (
        <Table head={["الملف", "صاحب البيانات", "الموظف الأصلي في الملف", "استورده", "متى", "الصفوف", "تم", "مكرر", "للمراجعة/خطأ", "الحالة", ""]}>
          {batches.map((b) => { const [lbl, tone] = ST[b.status] ?? [b.status, "neutral" as const]; return (
            <tr key={b.id}><td className={td + " font-medium"}>{b.file_name}</td><td className={td}>{b.data_owner_name}</td><td className={td}>{b.original_employee_name ?? "—"}</td>
              <td className={td}>{b.imported_by_name}</td><td className={td}>{fmtDateTime(b.created_at)}</td><td className={td}>{b.rows_total}</td><td className={td}>{b.c_imported}</td><td className={td}>{b.c_duplicate}</td>
              <td className={td}>{b.c_review + b.c_invalid + b.c_error}</td><td className={td}><Badge tone={tone}>{lbl}</Badge></td>
              <td className={td}><Link className="text-burgundy-600 underline" href={`/import/${b.id}`}>فتح</Link></td></tr>); })}
        </Table>)}
    </>
  );
}
