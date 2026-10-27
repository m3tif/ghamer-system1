import Link from "next/link";
import { can, requireSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { assignedLeads } from "@/server/data";
import { acceptHandoffAction, rejectHandoffAction } from "@/server/actions";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ActionForm, Hidden, SelectField, TextArea } from "@/components/forms";
import { Dialog } from "@/components/dialog";
import { fmtDateTime } from "@/lib/format";
import { LEAD_STATUS, LEAD_STATUS_TONE, REJECT_REASON, SERVICES, SOURCES, TEMPERATURE, TEMPERATURE_TONE } from "@/lib/labels";

export const metadata = { title: "العملاء المسندين إليّ" };
export const dynamic = "force-dynamic";
const TABS = [["pending", "بانتظار قرارك"], ["accepted", "المقبولون"], ["rejected", "المرفوضون"]] as const;

export default async function Assigned({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const s = await requireSession();
  if (!can(s, "deals.view") && !can(s, "meetings.create")) notFound();
  const sp = await searchParams;
  const tab = (TABS.find((t) => t[0] === sp.tab)?.[0] ?? "pending") as "pending" | "accepted" | "rejected";
  const [pending, rows] = await Promise.all([assignedLeads(s.userId, "pending"), tab === "pending" ? null : assignedLeads(s.userId, tab)]);
  const list = (tab === "pending" ? pending : rows) as any[];
  return (
    <>
      <PageHeader title="العملاء المسندين إليّ" sub="العميل لا يُعتبر مقبولًا بمجرد إرساله إليك. القرار لك: قبول أو رفض." />
      {sp.ok === "accepted" && <p role="status" className="mb-4 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">تم قبول العميل وأصبح ضمن عملائك. يمكنك الآن حجز اجتماع له.</p>}
      {sp.ok === "rejected" && <p role="status" className="mb-4 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">تم رفض العميل وإعادته لمن أرسله مع السبب.</p>}
      {sp.error && <p role="alert" className="mb-4 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{sp.error}</p>}
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/assigned?tab=${k}`} role="tab" aria-selected={tab === k}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-sm ${tab === k ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>
            {l}{k === "pending" && <span className={`rounded-full px-2 text-xs font-bold ${tab === k ? "bg-white/20" : pending.length ? "bg-warn/15 text-warn" : "bg-cream-dark"}`}>{pending.length}</span>}
          </Link>))}
      </div>
      {list.length === 0 ? <Empty title={tab === "pending" ? "لا يوجد عملاء بانتظار قرارك" : tab === "accepted" ? "لا يوجد عملاء مقبولون بعد" : "لا يوجد عملاء مرفوضون"} /> : tab === "pending" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((l) => (
            <Card key={l.handoff_id} title={l.name} right={<div className="flex gap-2">{l.lead_temperature && <Badge tone={TEMPERATURE_TONE[l.lead_temperature]}>{TEMPERATURE[l.lead_temperature]}</Badge>}<Badge tone="warn">بانتظار قرارك</Badge></div>}>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {l.business_name && <div><dt className="text-ink-500">النشاط</dt><dd className="font-medium">{l.business_name}</dd></div>}
                <div><dt className="text-ink-500">الجوال</dt><dd dir="ltr" className="text-start font-medium">{l.phone ?? "—"}</dd></div>
                <div><dt className="text-ink-500">أرسله</dt><dd className="font-medium">{l.from_name} · {fmtDateTime(l.handed_at)}</dd></div>
                <div><dt className="text-ink-500">المصدر</dt><dd className="font-medium">{SOURCES[l.original_source] ?? l.original_source}</dd></div>
                {l.required_services?.length > 0 && <div className="sm:col-span-2"><dt className="text-ink-500">الخدمات المطلوبة</dt><dd className="font-medium">{l.required_services.map((x: string) => SERVICES[x] ?? x).join("، ")}</dd></div>}
                {l.note && <div className="sm:col-span-2"><dt className="text-ink-500">ملاحظة المرسِل</dt><dd className="whitespace-pre-wrap">{l.note}</dd></div>}
                {l.call_notes && <div className="sm:col-span-2"><dt className="text-ink-500">آخر ملاحظات المكالمة</dt><dd className="whitespace-pre-wrap">{l.call_notes}</dd></div>}
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <form action={acceptHandoffAction}><input type="hidden" name="lead_id" value={l.lead_id} />
                  <button className="rounded-md bg-ok px-5 py-2 text-sm font-semibold text-white hover:opacity-90">قبول العميل</button></form>
                <Dialog trigger="رفض العميل" title={`رفض العميل — ${l.name}`} tone="danger">
                  <ActionForm action={rejectHandoffAction} submit="تأكيد الرفض" tone="quiet">
                    <Hidden name="lead_id" value={l.lead_id} />
                    <SelectField label="سبب الرفض" name="reason" empty="اختر السبب" options={Object.entries(REJECT_REASON).map(([value, label]) => ({ value, label }))} />
                    <TextArea label="ملاحظة توضيحية" name="note" rows={3} hint="مطلوبة عند اختيار «سبب آخر»، واختيارية غير ذلك" />
                    <p className="text-xs text-ink-500">يعود العميل لمن أرسله مع السبب. لا يُحذف أي سجل.</p>
                  </ActionForm>
                </Dialog>
                <Link href={`/leads/${l.lead_id}`} className="ms-auto text-sm text-burgundy-600 underline">فتح ملف العميل</Link>
              </div>
            </Card>))}
        </div>
      ) : tab === "accepted" ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[640px] text-sm"><thead className="border-b border-line bg-cream/60 text-xs text-ink-500"><tr>
            {["العميل", "الجوال", "الحالة", "أرسله", "وقت القبول", "المتابعة القادمة"].map((h) => <th key={h} className="px-4 py-2.5 text-start font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{list.map((l) => (
              <tr key={l.lead_id} className="hover:bg-cream/40"><td className="px-4 py-3"><Link className="font-semibold hover:underline" href={`/leads/${l.lead_id}`}>{l.name}</Link>{l.business_name && <div className="text-xs text-ink-500">{l.business_name}</div>}</td>
                <td className="px-4 py-3" dir="ltr">{l.phone ?? "—"}</td><td className="px-4 py-3"><Badge tone={LEAD_STATUS_TONE[l.lead_status]}>{LEAD_STATUS[l.lead_status]}</Badge></td>
                <td className="px-4 py-3">{l.from_name}</td><td className="whitespace-nowrap px-4 py-3 text-ink-500">{fmtDateTime(l.decided_at)}</td><td className="whitespace-nowrap px-4 py-3 text-ink-500">{fmtDateTime(l.next_followup_at)}</td></tr>))}</tbody></table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[560px] text-sm"><thead className="border-b border-line bg-cream/60 text-xs text-ink-500"><tr>
            {["العميل", "أرسله", "وقت الرفض", "السبب"].map((h) => <th key={h} className="px-4 py-2.5 text-start font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{list.map((l) => (
              <tr key={l.handoff_id}><td className="px-4 py-3 font-semibold">{l.client_name}</td><td className="px-4 py-3">{l.from_name}</td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-500">{fmtDateTime(l.decided_at)}</td><td className="px-4 py-3">{l.reject_note || REJECT_REASON[l.reject_reason] || "—"}</td></tr>))}</tbody></table>
        </div>)}
    </>
  );
}
