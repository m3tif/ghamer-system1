import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { HideLead } from "@/components/leads-cells";
import { assignable, employeeList, getLead, salesReps } from "@/server/data";
import { meetingFlags } from "@/server/meeting-rules";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { Dialog } from "@/components/dialog";
import { BookMeetingForm } from "@/components/book-meeting-form";
import { MeetingActions } from "@/components/meeting-actions";
import { acceptHandoffAction, correctAttributionAction, handoffAction, logCallAction, rejectHandoffAction, setTemperatureAction, transferLeadAction, updateClientAction, updateContactsAction } from "@/server/actions";
import { fmtDateTime, getTimezone, toLocalInput, tzLabel } from "@/lib/format";
import { CALL_STATUSES, FOLLOWUP_STATUS, HANDOFF_STATUS, HANDOFF_TONE, LEAD_STATUS, LEAD_STATUS_TONE, MEETING_STATUS, MEETING_TYPE, OUTCOME, REJECT_REASON, SOURCES, TEMPERATURE, TEMPERATURE_TONE } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(); await requirePerm(s, "leads.view");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getLead(s.userId, id);
  if (!data) notFound();
  const { lead, contacts, stores, activities, assignments, meetings, followUps, deal, handoff } = data;
  const canEdit = can(s, "leads.edit");
  const reps = can(s, "meetings.manage") || can(s, "leads.handoff") ? await salesReps(s.userId) : [];
  const emps = can(s, "employees.view") ? await employeeList(s.userId) : [];
  const managed = new Set<string>(emps.map((e: any) => e.id));
  const targets = can(s, "leads.transfer") ? await assignable(s.userId) : [];
  const tz = tzLabel(getTimezone());
  const phones = contacts.filter((c: any) => c.phone);
  const get = (label: string) => phones.find((c: any) => c.label === label)?.phone ?? "";
  const activeMeeting = meetings.find((m: any) => ["Scheduled", "Confirmed", "Rescheduled"].includes(m.status));
  // Sales may arrange a meeting only for a lead he accepted (or one he added himself)
  const accepted = handoff?.status === "accepted" || (!handoff && lead.original_creator_id === lead.assigned_sales_id);
  const salesActor = can(s, "meetings.create") && lead.assigned_sales_id && (lead.assigned_sales_id === s.userId || s.role === "super_admin" || (s.role === "sales_manager" && managed.has(lead.assigned_sales_id)));
  const pendingForMe = handoff?.status === "pending_review" && handoff.to_employee_id === s.userId;
  const canSend = can(s, "leads.handoff") && !lead.handed_off_at && !["Not Interested", "Invalid Contact", "Pending Sales Review", "Accepted by Sales", "Meeting Scheduled", "Meeting Completed"].includes(lead.lead_status) && !handoff?.status?.startsWith("pending");
  const needsStatus = !["Interested", "Qualified Lead", "Rejected by Sales"].includes(lead.lead_status);
  const rejected = lead.lead_status === "Rejected by Sales" && handoff?.status === "rejected";

  return (
    <>
      <PageHeader title={lead.name} sub={lead.business_name ?? undefined}
        actions={<>
          <Badge tone={LEAD_STATUS_TONE[lead.lead_status]}>{LEAD_STATUS[lead.lead_status]}</Badge>
          {lead.lead_temperature && <Badge tone={TEMPERATURE_TONE[lead.lead_temperature]}>{TEMPERATURE[lead.lead_temperature]}</Badge>}
          {lead.hidden_at && <Badge tone="bad">مخفي عن الموظفين</Badge>}
          {["super_admin", "general_manager", "tele_sales_manager", "sales_manager"].includes(s.role) && <HideLead leadId={id} name={lead.name} hidden={!!lead.hidden_at} />}
          {deal && can(s, "deals.view") && <Link className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream" href={`/deals/${deal.id}`}>فتح الصفقة</Link>}
        </>} />

      {pendingForMe && (
        <div className="mb-5 rounded-lg border-2 border-warn/50 bg-warn/5 p-4">
          <p className="font-bold">عميل بانتظار قرارك</p>
          <p className="mt-0.5 text-sm text-ink-500">حوّله {handoff.from_name} في {fmtDateTime(handoff.handed_at)}{handoff.note ? ` · ${handoff.note}` : ""}. لا يُعتبر مقبولًا حتى تقبله.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={acceptHandoffAction}><input type="hidden" name="lead_id" value={id} />
              <button className="rounded-md bg-ok px-4 py-2 text-sm font-semibold text-white hover:opacity-90">قبول العميل</button></form>
            <Dialog trigger="رفض العميل" title="رفض العميل" tone="danger">
              <ActionForm action={rejectHandoffAction} submit="تأكيد الرفض" tone="quiet">
                <Hidden name="lead_id" value={id} />
                <SelectField label="سبب الرفض" name="reason" empty="اختر السبب" options={Object.entries(REJECT_REASON).map(([value, label]) => ({ value, label }))} />
                <TextArea label="ملاحظة توضيحية" name="note" rows={3} hint="مطلوبة عند اختيار «سبب آخر»، واختيارية غير ذلك" />
                <p className="text-xs text-ink-500">يعود العميل لمن أرسله مع سبب الرفض، ويبقى القرار في السجل.</p>
              </ActionForm>
            </Dialog>
          </div>
        </div>)}
      {rejected && (
        <div className="mb-5 rounded-lg border border-bad/40 bg-bad/5 p-4 text-sm">
          <p className="font-bold text-bad">رفض السيلز هذا العميل</p>
          <p className="mt-0.5">{handoff.to_name} · {fmtDateTime(handoff.decided_at)} · السبب: {handoff.reject_note || REJECT_REASON[handoff.reject_reason] || "—"}</p>
          {canSend && <p className="mt-1 text-ink-500">يمكنك تعديل بيانات العميل ثم إرساله من جديد لنفس السيلز أو لغيره.</p>}
        </div>)}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card title="الملكية والمصدر">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-ink-500">أضافه (ثابت)</dt><dd className="font-semibold">{lead.creator}</dd></div>
              <div><dt className="text-ink-500">المسؤول الحالي</dt><dd className="font-semibold">{lead.owner}</dd></div>
              <div><dt className="text-ink-500">السيلز</dt><dd className="font-semibold">{lead.sales ?? "—"}</dd></div>
              <div><dt className="text-ink-500">المصدر الأصلي (ثابت)</dt><dd className="font-semibold">{SOURCES[lead.original_source] ?? lead.original_source}</dd></div>
              <div><dt className="text-ink-500">درجة التواصل</dt><dd>{lead.lead_temperature ? <Badge tone={TEMPERATURE_TONE[lead.lead_temperature]}>{TEMPERATURE[lead.lead_temperature]}</Badge> : <span className="text-ink-500">غير مصنّف</span>}</dd></div>
              <div><dt className="text-ink-500">تاريخ التسجيل</dt><dd>{fmtDateTime(lead.created_at)}</dd></div>
              <div><dt className="text-ink-500">آخر تواصل</dt><dd>{fmtDateTime(lead.last_contact_at)}</dd></div>
              {handoff && <div><dt className="text-ink-500">التحويل إلى السيلز</dt><dd><Badge tone={HANDOFF_TONE[handoff.status]}>{HANDOFF_STATUS[handoff.status]}</Badge></dd></div>}
            </dl>
          </Card>

          {canSend && (
            <Card title={rejected ? "إرسال العميل من جديد إلى السيلز" : "إرسال العميل إلى السيلز"}>
              <ActionForm action={handoffAction} submit="إرسال العميل" className="grid gap-4 md:grid-cols-2">
                <Hidden name="lead_id" value={id} />
                {needsStatus && <SelectField label="تقييم العميل قبل الإرسال" name="status" required defaultValue="Interested" options={[{ value: "Interested", label: LEAD_STATUS["Interested"] }, { value: "Qualified Lead", label: LEAD_STATUS["Qualified Lead"] }]} hint={`الحالة الحالية: ${LEAD_STATUS[lead.lead_status]}. ستُحدَّث وتُسجَّل في سجل العميل.`} />}
                <SelectField label="المستلم" name="to" required defaultValue="admin" options={[{ value: "admin", label: "إرسال للإدارة لتوزيعه" }, ...reps.map((r) => ({ value: r.id, label: r.full_name }))]} />
                <TextArea label="ملاحظة للسيلز" name="note" rows={2} placeholder="مثال: العميل مهتم بإدارة السوشيال ميديا ويفضل التواصل مساءً" />
                <p className="md:col-span-2 text-xs text-ink-500">لا يُعتبر العميل مقبولًا بمجرد الإرسال. القرار النهائي (قبول أو رفض) عند السيلز، وتتابعين النتيجة من «تم تحويلها».</p>
              </ActionForm>
            </Card>)}

          {canEdit && (
            <Card title="تسجيل مكالمة / تحديث الحالة">
              <ActionForm action={logCallAction} submit="حفظ المكالمة" className="grid gap-4 md:grid-cols-2">
                <Hidden name="lead_id" value={id} />
                <SelectField label="نتيجة المكالمة" name="status" empty="بدون تغيير الحالة" options={CALL_STATUSES.map((k) => ({ value: k, label: LEAD_STATUS[k] }))} />
                <div />
                <div className="md:col-span-2"><TextArea label="ملاحظات المكالمة" name="note" required /></div>
                <Field label={`موعد المتابعة القادمة — ${tz}`} name="next_followup" type="datetime-local" hint="اختياري. مطلوب مع «يحتاج متابعة»" />
                <Field label="سبب المتابعة" name="followup_reason" />
              </ActionForm>
            </Card>)}

          <Card title="سجل النشاط">
            {activities.length === 0 ? <p className="text-sm text-ink-500">لا يوجد نشاط.</p> : (
              <ol className="space-y-3 border-s-2 border-line ps-4">
                {activities.map((a: any) => (
                  <li key={a.id} className="relative text-sm">
                    <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full bg-burgundy-600" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{a.by_name}</span>
                      {a.status_to && <Badge tone={LEAD_STATUS_TONE[a.status_to]}>{LEAD_STATUS[a.status_to] ?? a.status_to}</Badge>}
                      <span className="text-xs text-ink-500">{fmtDateTime(a.created_at)}</span>
                    </div>
                    {a.note && <p className="mt-0.5 whitespace-pre-wrap text-ink-500">{a.note}</p>}
                  </li>))}
              </ol>)}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="بيانات التواصل">
            <ul className="mb-3 space-y-1 text-sm">
              {phones.map((c: any) => <li key={c.id} dir="ltr" className="text-start"><span className="text-ink-500">{c.label}: </span>{c.phone}</li>)}
              {stores.map((st: any) => <li key={st.id} dir="ltr" className="text-start"><a className="underline" href={st.url_raw} target="_blank" rel="noopener noreferrer nofollow">{st.url_raw}</a></li>)}
            </ul>
            {canEdit && (
              <Dialog trigger="تعديل بيانات العميل" title="تعديل بيانات العميل" wide>
                <div className="space-y-6">
                  <ActionForm action={setTemperatureAction} submit="حفظ درجة التواصل" tone="quiet" className="flex flex-wrap items-end gap-3" >
                    <Hidden name="lead_id" value={id} />
                    <div className="min-w-48"><SelectField label="درجة التواصل" name="temperature" defaultValue={lead.lead_temperature ?? ""} empty="غير مصنّف" options={Object.entries(TEMPERATURE).map(([value, label]) => ({ value, label }))} /></div>
                  </ActionForm>
                  <ActionForm action={updateClientAction} submit="حفظ" tone="quiet" className="grid gap-4 sm:grid-cols-2">
                    <Hidden name="client_id" value={lead.client_id} /><Hidden name="lead_id" value={id} />
                    <Field label="اسم العميل" name="name" defaultValue={lead.name} required />
                    <Field label="النشاط التجاري" name="business_name" defaultValue={lead.business_name ?? ""} />
                    <Field label="النشاط" name="industry" defaultValue={lead.industry ?? ""} />
                    <Field label="المدينة" name="city" defaultValue={lead.city ?? ""} />
                    <Field label="الشخص المسؤول" name="contact_person" defaultValue={lead.contact_person ?? ""} />
                  </ActionForm>
                  <ActionForm action={updateContactsAction} submit="حفظ أرقام الاتصال والروابط" tone="quiet" className="grid gap-4 sm:grid-cols-2">
                    <Hidden name="client_id" value={lead.client_id} /><Hidden name="lead_id" value={id} />
                    <Field label="الجوال" name="phone" dir="ltr" defaultValue={get("mobile")} required />
                    <Field label="رقم بديل" name="alt_phone" dir="ltr" defaultValue={get("alt_mobile")} />
                    <Field label="واتساب" name="whatsapp" dir="ltr" defaultValue={get("whatsapp")} />
                    <TextArea label="روابط المتجر" name="store_url" rows={2} defaultValue={stores.map((x: any) => x.url_raw).join("\n")} />
                  </ActionForm>
                </div>
              </Dialog>)}
          </Card>

          <Card title="الاجتماعات" right={salesActor && accepted && !activeMeeting ? (
            <Dialog trigger="حجز اجتماع" title={`حجز اجتماع — ${lead.name}`} tone="primary" wide>
              <BookMeetingForm leadId={id} clientName={lead.name} tz={tz} min={toLocalInput(new Date())} />
            </Dialog>) : undefined}>
            {meetings.length === 0 ? (
              <p className="text-sm text-ink-500">
                {!accepted && lead.assigned_sales_id ? "لا يُحجز اجتماع قبل أن يقبل السيلز العميل." : salesActor ? "لا توجد اجتماعات. اضغط «حجز اجتماع»." : "لا توجد اجتماعات."}
              </p>) : (
              <ul className="space-y-3">
                {meetings.map((m: any) => (
                  <li key={m.id} className="rounded-md border border-line p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{m.title}</span>
                      <Badge tone={m.status === "Completed" ? "ok" : m.status === "Cancelled" || m.status === "No Show" ? "bad" : "brand"}>{MEETING_STATUS[m.status]}</Badge>
                    </div>
                    <div className="mt-1 text-ink-500">{fmtDateTime(m.scheduled_at)} · {MEETING_TYPE[m.meeting_type]} · مع {m.rep_name}</div>
                    {m.outcome && <div className="mt-1">النتيجة: {OUTCOME[m.outcome]}</div>}
                    <div className="mt-2">
                      <MeetingActions m={{ id: m.id, title: m.title, meeting_type: m.meeting_type, scheduled_local: toLocalInput(m.scheduled_at), meeting_url: m.meeting_url, booking_notes: m.booking_notes, client_name: lead.name }}
                        flags={meetingFlags(m, s, managed)} reps={reps} tz={tz} />
                    </div>
                  </li>))}
              </ul>)}
          </Card>

          <Card title="المتابعات">
            {followUps.length === 0 ? <p className="text-sm text-ink-500">لا توجد متابعات.</p> : (
              <ul className="space-y-2 text-sm">{followUps.map((f: any) => (
                <li key={f.id} className="flex justify-between gap-2"><span>{f.reason}</span>
                  <span className={f.status === "open" && new Date(f.due_at) < new Date() ? "font-semibold text-bad" : "text-ink-500"}>{FOLLOWUP_STATUS[f.status]} · {fmtDateTime(f.due_at)}</span></li>))}</ul>)}
          </Card>

          <Card title="سجل الإسناد">
            <ol className="space-y-2 text-sm">{assignments.map((a: any) => (
              <li key={a.id}><span className="font-medium">{a.kind === "owner" ? "المسؤول" : "السيلز"}:</span> {a.from_name ? `${a.from_name} ← ` : ""}{a.to_name}
                <div className="text-xs text-ink-500">{a.by_name} · {fmtDateTime(a.created_at)}{a.reason ? ` · ${a.reason}` : ""}</div></li>))}</ol>
            {can(s, "leads.transfer") && (
              <details className="mt-4 border-t border-line pt-3 text-sm"><summary className="cursor-pointer font-medium text-burgundy-600">نقل الملكية</summary>
                <ActionForm action={transferLeadAction} submit="نقل" tone="quiet" className="mt-3 space-y-3">
                  <Hidden name="lead_id" value={id} />
                  <SelectField label="نوع النقل" name="kind" required options={[{ value: "owner", label: "المسؤول عن العميل" }, { value: "sales", label: "السيلز" }]} />
                  <SelectField label="إلى" name="to" required empty="اختر الموظف" options={targets.map((t) => ({ value: t.id, label: t.full_name }))} />
                  <TextArea label="السبب (مطلوب)" name="reason" required rows={2} />
                  <p className="text-xs text-ink-500">المسجِّل الأصلي ومصدر العميل لا يتغيران، ويُحفظ كل نقل في السجل.</p>
                </ActionForm>
              </details>)}
            {can(s, "leads.correct_source") && (
              <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-burgundy-600">تصحيح المصدر (استثنائي)</summary>
                <ActionForm action={correctAttributionAction} submit="تصحيح" tone="quiet" className="mt-3 space-y-3">
                  <Hidden name="client_id" value={lead.client_id} /><Hidden name="lead_id" value={id} />
                  <SelectField label="المصدر الجديد" name="source" empty="بدون تغيير" options={Object.entries(SOURCES).map(([value, label]) => ({ value, label }))} />
                  <SelectField label="المسجِّل الأصلي الجديد" name="creator" empty="بدون تغيير" options={targets.map((t) => ({ value: t.id, label: t.full_name }))} />
                  <TextArea label="السبب (مطلوب ويُسجَّل في التدقيق)" name="reason" required rows={2} />
                </ActionForm>
              </details>)}
          </Card>
        </div>
      </div>
    </>
  );
}
