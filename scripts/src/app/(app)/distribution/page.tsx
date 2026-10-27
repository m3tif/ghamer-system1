import { requirePerm, requireSession } from "@/lib/auth";
import { pendingHandoffs, salesReps } from "@/server/data";
import { assignHandoffAction } from "@/server/actions";
import { Card, Empty, PageHeader } from "@/components/ui";
import { ActionForm, Hidden, SelectField } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "توزيع العملاء" };
export const dynamic = "force-dynamic";

export default async function Distribution() {
  const s = await requireSession(); await requirePerm(s, "leads.distribute");
  const [rows, reps] = await Promise.all([pendingHandoffs(s.userId), salesReps(s.userId)]);
  return (
    <>
      <PageHeader title="توزيع العملاء المحوّلين" sub="عملاء أرسلهم Tele Sales للإدارة لاختيار السيلز المناسب." />
      {rows.length === 0 ? <Empty title="لا يوجد عملاء بانتظار التوزيع" /> : (
        <div className="space-y-4">{rows.map((h) => (
          <Card key={h.handoff_id} title={h.client_name}>
            <p className="mb-3 text-sm text-ink-500">حوّلته {h.from_name} · {fmtDateTime(h.handed_at)}{h.note ? ` · ${h.note}` : ""}</p>
            <ActionForm action={assignHandoffAction} submit="توزيع" className="flex flex-wrap items-end gap-3" hiddenOnOk>
              <Hidden name="id" value={h.handoff_id} />
              <div className="min-w-60"><SelectField label="السيلز" name="to" required empty="اختر السيلز" options={reps.map((r) => ({ value: r.id, label: r.full_name }))} /></div>
            </ActionForm>
          </Card>))}</div>)}
    </>
  );
}
