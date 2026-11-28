import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { portalStageDefaults } from "@/server/data";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Field, Hidden } from "@/components/forms";
import { portalStageDefaultAction } from "@/server/portal-staff-actions";

export const metadata = { title: "مراحل البوابة الافتراضية" };
export const dynamic = "force-dynamic";

/** The stages every new client project starts with (each project can then change its own). Admin and Technical Manager. */
export default async function PortalStages() {
  const s = await requireSession();
  if (!["super_admin", "operations_manager"].includes(s.role)) notFound();
  const list = await portalStageDefaults(s.userId);
  return (
    <>
      <PageHeader title="مراحل البوابة الافتراضية" sub="المراحل اللي أي مشروع جديد في بوابة العملاء بيبدأ بيها. كل مشروع يقدر يعدل مراحله بعد كده." />
      <div className="grid max-w-4xl gap-6">
        <Card title="المراحل">
          <ul className="space-y-3">{list.map((d) => (
            <li key={d.id}>
              <ActionForm action={portalStageDefaultAction} submit="حفظ" tone="quiet" className="grid gap-2 md:grid-cols-[5rem_1fr_9rem_auto] md:items-end">
                <Hidden name="id" value={d.id} />
                <Field label="الترتيب" name="sort" type="number" defaultValue={String(d.sort)} dir="ltr" />
                <Field label="الاسم" name="name" defaultValue={d.name} required />
                <label className="text-sm">الحالة<select name="active" defaultValue={d.is_active ? "1" : "0"} className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2"><option value="1">مستخدمة</option><option value="0">موقوفة</option></select></label>
              </ActionForm>
            </li>))}</ul>
        </Card>
        <Card title="مرحلة جديدة">
          <ActionForm action={portalStageDefaultAction} submit="إضافة" className="grid gap-2 md:grid-cols-[5rem_1fr_auto] md:items-end">
            <Field label="الترتيب" name="sort" type="number" defaultValue={String((list.at(-1)?.sort ?? 0) + 1)} dir="ltr" /><Field label="الاسم" name="name" required />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
