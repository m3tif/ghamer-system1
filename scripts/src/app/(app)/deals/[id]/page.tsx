import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { getDeal } from "@/server/data";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, CheckGroup, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { moveDealAction, saveBriefAction } from "@/server/actions";
import { fmtDateTime } from "@/lib/format";
import { DEAL_STAGE, DEAL_STAGES, FOLLOWUP_STATUS, SERVICES } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(); await requirePerm(s, "deals.view");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getDeal(s.userId, id);
  if (!data) notFound();
  const { deal, brief, history, followUps } = data;
  const closed = ["Lost", "Financially Approved"].includes(deal.stage);
  const canEdit = can(s, "deals.edit") && !closed;
  const b = brief as any;
  return (
    <>
      <PageHeader title={deal.client_name} sub={`${deal.business_name ?? ""} · المسؤول: ${deal.owner_name}`}
        actions={<><Badge tone={deal.stage === "Lost" ? "bad" : deal.stage.startsWith("Signed") || deal.stage === "Financially Approved" ? "ok" : "brand"}>{DEAL_STAGE[deal.stage]}</Badge>
          <Link href={`/leads/${deal.lead_id}`} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">ملف العميل</Link></>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title="بريف المبيعات">
          {canEdit ? (
            <ActionForm action={saveBriefAction} submit="حفظ البريف" className="grid gap-4 md:grid-cols-2">
              <Hidden name="deal_id" value={id} />
              <Field label="نوع النشاط" name="business_type" defaultValue={b.business_type ?? ""} />
              <Field label="رابط المتجر" name="store_url" dir="ltr" defaultValue={b.store_url ?? ""} />
              <div className="md:col-span-2"><TextArea label="الأهداف التسويقية" name="marketing_goals" defaultValue={b.marketing_goals ?? ""} /></div>
              <div className="md:col-span-2"><TextArea label="مشاكل العميل الحالية" name="current_problems" defaultValue={b.current_problems ?? ""} /></div>
              <TextArea label="المنافسون" name="competitors" rows={2} defaultValue={b.competitors ?? ""} />
              <TextArea label="الباقات المقترحة" name="proposed_packages" rows={2} defaultValue={b.proposed_packages ?? ""} />
              <Field label="الميزانية المتوقعة (ريال)" name="expected_budget" type="number" min="0" step="1" defaultValue={b.expected_budget ?? ""} />
              <Field label="قيمة الصفقة المتوقعة (ريال)" name="expected_value" type="number" min="0" step="1" defaultValue={deal.expected_value ?? ""} />
              <Field label="نسبة احتمال التعاقد %" name="win_probability" type="number" min="0" step="5" defaultValue={deal.win_probability ?? ""} />
              <Field label="القرار المتوقع" name="expected_decision" defaultValue={b.expected_decision ?? ""} />
              <div className="md:col-span-2"><CheckGroup label="الخدمات المطلوبة" name="services" defaultValues={b.required_services ?? []} options={Object.entries(SERVICES).map(([value, label]) => ({ value, label }))} /></div>
              <div className="md:col-span-2"><TextArea label="ملاحظات الاجتماع" name="meeting_notes" defaultValue={b.meeting_notes ?? ""} /></div>
            </ActionForm>
          ) : (
            <dl className="space-y-3 text-sm">
              {([["نوع النشاط", b.business_type], ["الأهداف", b.marketing_goals], ["المشاكل", b.current_problems], ["المنافسون", b.competitors], ["ملاحظات الاجتماع", b.meeting_notes]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-ink-500">{k}</dt><dd className="whitespace-pre-wrap">{v || "—"}</dd></div>))}
            </dl>)}
        </Card>
        <div className="space-y-6">
          {canEdit && (
            <Card title="تحديث المرحلة">
              <ActionForm action={moveDealAction} submit="تحديث المرحلة" className="space-y-3">
                <Hidden name="deal_id" value={id} />
                <SelectField label="المرحلة الجديدة" name="to" required defaultValue={deal.stage}
                  options={DEAL_STAGES.filter((x) => x !== "Financially Approved").map((x) => ({ value: x, label: DEAL_STAGE[x] }))} />
                <TextArea label="ملاحظة / سبب" name="reason" rows={2} hint="مطلوب عند «خسرناه»" />
                <Field label="موعد المتابعة" name="followup_at" type="datetime-local" hint="مطلوب عند «مؤجل» و«متابعة»" />
                <Field label="سبب المتابعة" name="followup_reason" />
                <p className="text-xs text-ink-500">الاعتماد المالي يتم من قسم المالية فقط.</p>
              </ActionForm>
            </Card>)}
          <Card title="سجل المراحل">
            <ol className="space-y-2 text-sm">{history.map((h: any) => (
              <li key={h.id}><span className="font-medium">{h.from_stage && h.from_stage !== h.to_stage ? `${DEAL_STAGE[h.from_stage]} ← ` : ""}{DEAL_STAGE[h.to_stage]}</span>
                <div className="text-xs text-ink-500">{h.by_name} · {fmtDateTime(h.at)}{h.reason ? ` · ${h.reason}` : ""}</div></li>))}</ol>
          </Card>
          {followUps.length > 0 && (
            <Card title="المتابعات"><ul className="space-y-2 text-sm">{followUps.map((f: any) => (
              <li key={f.id} className="flex justify-between gap-2"><span>{f.reason}</span><span className="text-ink-500">{FOLLOWUP_STATUS[f.status]} · {fmtDateTime(f.due_at)}</span></li>))}</ul></Card>)}
        </div>
      </div>
    </>
  );
}
