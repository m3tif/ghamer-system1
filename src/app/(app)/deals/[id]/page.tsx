import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { dealContract, getDeal } from "@/server/data";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, CheckGroup, Field, Hidden, TextArea } from "@/components/forms";
import { saveBriefAction } from "@/server/actions";
import { DealActions } from "@/components/deal-actions";
import { fmtDateTime } from "@/lib/format";
import { CONTRACT_STATUS, CONTRACT_STATUS_TONE, DEAL_STAGE, FOLLOWUP_STATUS, SERVICES } from "@/lib/labels";
import { fmtSar } from "@/lib/format";

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
  const contract = can(s, "contracts.view") ? await dealContract(s.userId, id) : undefined;
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
              <div className="md:col-span-2"><TextArea label="ملاحظات" name="meeting_notes" defaultValue={b.meeting_notes ?? ""} /></div>
            </ActionForm>
          ) : (
            <dl className="space-y-3 text-sm">
              {([["نوع النشاط", b.business_type], ["الأهداف", b.marketing_goals], ["المشاكل", b.current_problems], ["المنافسون", b.competitors], ["ملاحظات", b.meeting_notes]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-ink-500">{k}</dt><dd className="whitespace-pre-wrap">{v || "—"}</dd></div>))}
            </dl>)}
        </Card>
        <div className="space-y-6">
          {canEdit && (
            <Card title="الخطوة الجاية">
              <div className="space-y-2 text-sm">
                <DealActions deal={{ id, stage: deal.stage, client_name: deal.client_name }} />
                <p className="text-xs text-ink-500">«بتابعه»: حدّد هتكلمه إمتى. «اعمل عقد»: لما يوافق. العقد بيتبعت للمالية ولما تعتمد العميل بيتقفل لوحده.</p>
              </div>
            </Card>)}
          {deal.stage === "Lost" && deal.lost_reason && <Card title="سبب الخسارة"><p className="text-sm">{deal.lost_reason}</p></Card>}
          {contract && (
            <Card title="العقد">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2"><Link href={`/contracts/${contract.id}`} className="font-semibold text-burgundy-700 underline" dir="ltr">{contract.contract_no}</Link>
                  <Badge tone={CONTRACT_STATUS_TONE[contract.status]}>{CONTRACT_STATUS[contract.status]}</Badge></div>
                <p className="text-ink-500">الإجمالي: <span className="tabular-nums">{fmtSar(contract.total_amount)}</span></p>
              </div>
            </Card>)}
          <Card title="سجل المراحل">
            <ol className="space-y-2 text-sm">{history.map((h: any) => (
              <li key={h.id}><span className="font-medium">{h.from_stage && DEAL_STAGE[h.from_stage] !== DEAL_STAGE[h.to_stage] ? `${DEAL_STAGE[h.from_stage]} ← ` : ""}{DEAL_STAGE[h.to_stage]}</span>
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
