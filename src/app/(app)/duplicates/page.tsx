import { can, requireSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { duplicateReviews } from "@/server/data";
import { resolveReviewAction } from "@/server/actions";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ActionForm, Hidden, SelectField, TextArea } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "مراجعة التكرار" };
export const dynamic = "force-dynamic";
const ST: Record<string, [string, "warn" | "ok" | "bad"]> = { open: ["مفتوح", "warn"], transferred: ["تم النقل", "ok"], rejected: ["مرفوض", "bad"] };

export default async function Duplicates() {
  const s = await requireSession();
  if (!can(s, "duplicates.review") && !can(s, "duplicates.request")) notFound();
  const rows = await duplicateReviews(s.userId);
  return (
    <>
      <PageHeader title="مراجعة ملكية العملاء" sub="طلبات الموظفين عند اكتشاف عميل مسجل لدى موظف آخر." />
      {rows.length === 0 ? <Empty title="لا توجد طلبات" hint="تظهر هنا الطلبات التي يرسلها الموظفون عند ظهور تنبيه التكرار." /> : (
        <div className="space-y-4">{rows.map((r) => (
          <Card key={r.id} title={r.existing_client_name} right={<Badge tone={ST[r.status][1]}>{ST[r.status][0]}</Badge>}>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-ink-500">الطالب</dt><dd className="font-semibold">{r.requested_by_name}</dd></div>
              <div><dt className="text-ink-500">المسجَّل لدى</dt><dd className="font-semibold">{r.existing_owner_name ?? "—"}</dd></div>
              <div><dt className="text-ink-500">التاريخ</dt><dd>{fmtDateTime(r.created_at)}</dd></div>
              <div className="sm:col-span-3"><dt className="text-ink-500">سبب الطلب</dt><dd>{r.reason}</dd></div>
              {r.resolution_note && <div className="sm:col-span-3"><dt className="text-ink-500">قرار المدير</dt><dd>{r.resolution_note}</dd></div>}
            </dl>
            {r.can_resolve && (
              <ActionForm action={resolveReviewAction} submit="تسجيل القرار" className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2" tone="quiet">
                <Hidden name="id" value={r.id} />
                <SelectField label="القرار" name="decision" required options={[{ value: "transfer", label: "نقل العميل للطالب" }, { value: "reject", label: "رفض الطلب" }]} />
                <TextArea label="ملاحظة القرار (مطلوبة)" name="note" required rows={2} />
              </ActionForm>)}
          </Card>))}</div>)}
    </>
  );
}
