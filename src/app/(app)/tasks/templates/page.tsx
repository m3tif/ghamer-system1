import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { servicesList, taskTemplates } from "@/server/data";
import { Badge, Card, Empty, PageHeader, Table, td } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { saveTemplateAction, setTemplateAction } from "@/server/actions";

export const metadata = { title: "قوالب التاسكات" };
export const dynamic = "force-dynamic";

export default async function Templates() {
  const s = await requireSession();
  if (!["super_admin", "operations_manager"].includes(s.role)) notFound();
  const [rows, services] = await Promise.all([taskTemplates(s.userId, true), servicesList(s.userId)]);
  return (
    <>
      <PageHeader title="قوالب التاسكات" sub="تاسكات جاهزة لكل باقة. الأكاونت مانجر يختار القالب وهو بيعمل تاسك فالخانات تتملى لوحدها."
        actions={<Link href="/tasks" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">رجوع للتاسكات</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          {rows.length === 0 ? <Empty title="مفيش قوالب لسه" hint="ضيف أول قالب من الفورم." /> : (
            <Table head={["القالب", "الباقة", "الساعات", "الحالة", ""]}>
              {rows.map((t) => (
                <tr key={t.id} className={t.is_active ? "" : "opacity-60"}>
                  <td className={td}><span className="font-semibold">{t.title}</span>{t.description && <div className="mt-0.5 max-w-md text-xs text-ink-500">{t.description}</div>}</td>
                  <td className={td}>{t.service_name ?? "—"}</td>
                  <td className={td + " tabular-nums"}>{t.estimated_hours ? Number(t.estimated_hours) : "—"}</td>
                  <td className={td}><Badge tone={t.is_active ? "ok" : "neutral"}>{t.is_active ? "شغّال" : "موقوف"}</Badge></td>
                  <td className={td}><ActionForm action={setTemplateAction} submit={t.is_active ? "إيقاف" : "تشغيل"} tone="quiet" className=""><Hidden name="template_id" value={t.id} /><Hidden name="active" value={t.is_active ? "0" : "1"} /></ActionForm></td>
                </tr>))}
            </Table>)}
        </div>
        <Card title="قالب جديد">
          <ActionForm action={saveTemplateAction} submit="إضافة القالب">
            <Field label="عنوان التاسك" name="title" required placeholder="مثال: تدقيق سيو أولي للمتجر" />
            <SelectField label="الباقة" name="service" empty="كل الباقات" options={services.map((x) => ({ value: x.code, label: x.name_ar }))} />
            <Field label="الساعات المتوقعة" name="estimated_hours" type="number" min="0.25" step="0.25" dir="ltr" />
            <TextArea label="الوصف والمطلوب" name="description" rows={4} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
