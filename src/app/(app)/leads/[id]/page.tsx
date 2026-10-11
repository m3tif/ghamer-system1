import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { assignable, employeeList, getLead, salesReps } from "@/server/data";
import { allowedMeetingActions } from "@/server/meeting-rules";
import { Badge, Card, PageHeader, Empty } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { MeetingActions } from "@/components/meeting-actions";
import { bookMeetingAction, correctAttributionAction, logCallAction, transferLeadAction, updateClientAction, updateContactsAction } from "@/server/actions";
import { fmtDateTime, toRiyadhInput } from "@/lib/format";
import { CALL_STATUSES, FOLLOWUP_STATUS, LEAD_STATUS, MEETING_STATUS, SERVICES, SOURCES } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(); await requirePerm(s, "leads.view");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getLead(s.userId, id);
  if (!data) notFound();
  const { lead, contacts, stores, activities, assignments, meetings, followUps, deal } = data;
  const canEdit = can(s, "leads.edit");
  const reps = can(s, "meetings.create") || can(s, "meetings.manage") ? await salesReps(s.userId) : [];
  const emps = can(s, "employees.view") ? await employeeList(s.userId) : [];
  const managed = new Set<string>(emps.map((e: any) => e.id));
  const targets = can(s, "leads.transfer") ? await assignable(s.userId) : [];
  const activeMeeting = meetings.find((m: any) => ["Scheduled", "Confirmed", "Rescheduled"].includes(m.status));
  const phones = contacts.filter((c: any) => c.phone);
  const get = (label: string) => phones.find((c: any) => c.label === label)?.phone ?? "";

  return (
    <>
      <PageHeader title={lead.name} sub={lead.business_name ?? undefined}
        actions={<><Badge tone="brand">{LEAD_STATUS[lead.lead_status]}</Badge>{deal && can(s, "deals.view") && <Link className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream" href={`/deals/${deal.id}`}>فتح الصفقة</Link>}</>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="الملكية والمصدر">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-ink-500">سُجّل بواسطة (ثابت)</dt><dd className="font-semibold">{lead.creator}</dd></div>
              <div><dt className="text-ink-500">المسؤول الحالي</dt><dd className="font-semibold">{lead.owner}</dd></div>
              <div><dt className="text-ink-500">مندوب المبيعات</dt><dd className="font-semibold">{lead.sales ?? "—"}</dd></div>
              <div><dt className="text-ink-500">المصدر الأصلي (ثابت)</dt><dd className="font-semibold">{SOURCES[lead.original_source] ?? lead.original_source}</dd></div>
              <div><dt className="text-ink-500">تاريخ التسجيل</dt><dd>{fmtDateTime(lead.created_at)}</dd></div>
              <div><dt className="text-ink-500">آخر تواصل</dt><dd>{fmtDateTime(lead.last_contact_at)}</dd></div>
            </dl>
          </Card>

          {canEdit && (
            <Card title="تسجيل مكالمة / تحديث الحالة">
              <ActionForm action={logCallAction} submit="حفظ المكالمة" className="grid gap-4 md:grid-cols-2">
                <Hidden name="lead_id" value={id} />
                <SelectField label="نتيجة المكالمة" name="status" empty="بدون تغيير الحالة" options={CALL_STATUSES.map((k) => ({ value: k, label: LEAD_STATUS[k] }))} />
                <div />
                <div className="md:col-span-2"><TextArea label="ملاحظات المكالمة" name="note" required /></div>
                <Field label="موعد المتابعة القادمة" name="next_followup" type="datetime-local" hint="مطلوب مع «معاودة اتصال» و«متابعة لاحقًا»" />
                <Field label="سبب المتابعة" name="followup_reason" />
              </ActionForm>
            </Card>
          )}

          <Card title="سجل النشاط">
            {activities.length === 0 ? <p className="text-sm text-ink-500">لا يوجد نشاط.</p> : (
              <ol className="space-y-3 border-s-2 border-line ps-4">
                {activities.map((a: any) => (
                  <li key={a.id} className="relative text-sm">
                    <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full bg-burgundy-600" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{a.by_name}</span>
                      {a.status_to && <Badge>{LEAD_STATUS[a.status_to] ?? a.status_to}</Badge>}
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
              <details className="text-sm"><summary className="cursor-pointer font-medium text-burgundy-600">تعديل البيانات</summary>
                <div className="mt-3 space-y-5">
                  <ActionForm action={updateClientAction} submit="حفظ" tone="quiet">
                    <Hidden name="client_id" value={lead.client_id} /><Hidden name="lead_id" value={id} />
                    <Field label="اسم العميل" name="name" defaultValue={lead.name} required />
                    <Field label="النشاط التجاري" name="business_name" defaultValue={lead.business_name ?? ""} />
                    <Field label="النشاط" name="industry" defaultValue={lead.industry ?? ""} />
                    <Field label="المدينة" name="city" defaultValue={lead.city ?? ""} />
                    <Field label="الشخص المسؤول" name="contact_person" defaultValue={lead.contact_person ?? ""} />
                  </ActionForm>
                  <ActionForm action={updateContactsAction} submit="حفظ أرقام الاتصال والروابط" tone="quiet">
                    <Hidden name="client_id" value={lead.client_id} /><Hidden name="lead_id" value={id} />
                    <Field label="الجوال" name="phone" dir="ltr" defaultValue={get("mobile")} required />
                    <Field label="رقم بديل" name="alt_phone" dir="ltr" defaultValue={get("alt_mobile")} />
                    <Field label="واتساب" name="whatsapp" dir="ltr" defaultValue={get("whatsapp")} />
                    <TextArea label="روابط المتجر" name="store_url" rows={2} defaultValue={stores.map((x: any) => x.url_raw).join("\n")} />
                  </ActionForm>
                </div>
              </details>)}
          </Card>

          <Card title="الاجتماعات">
            {meetings.length === 0 ? <p className="mb-3 text-sm text-ink-500">لا توجد اجتماعات.</p> : (
              <ul className="mb-4 space-y-3">
                {meetings.map((m: any) => (
                  <li key={m.id} className="rounded-md border border-line p-3 text-sm">
                    <div className="flex items-center justify-between"><Badge tone={m.status === "Completed" ? "ok" : m.status === "Cancelled" || m.status === "No Show" ? "bad" : "brand"}>{MEETING_STATUS[m.status]}</Badge>
                      <span className="text-xs text-ink-500">{fmtDateTime(m.scheduled_at)}</span></div>
                    <div className="mt-1 text-ink-500">مع {m.rep_name}{m.tele_name ? ` · حجزته ${m.tele_name}` : ""}{m.reschedule_count ? ` · أُعيدت جدولته ${m.reschedule_count} مرة` : ""}</div>
                    {m.meeting_url && <a className="text-xs underline" dir="ltr" href={m.meeting_url} target="_blank" rel="noopener noreferrer">رابط الاجتماع</a>}
                    <div className="mt-2"><MeetingActions meetingId={m.id} allowed={allowedMeetingActions(m, s, managed)} reps={reps} /></div>
                  </li>))}
              </ul>)}
            {can(s, "meetings.create") && !activeMeeting && !["Invalid Contact", "Not Interested"].includes(lead.lead_status) && (
              <ActionForm action={bookMeetingAction} submit="حجز الاجتماع" className="space-y-3 border-t border-line pt-4">
                <Hidden name="lead_id" value={id} />
                <SelectField label="مندوب المبيعات" name="rep" required empty="اختر المندوب" options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
                <Field label="التاريخ والوقت" name="at" type="datetime-local" required min={toRiyadhInput(new Date())} />
                <Field label="رابط الاجتماع" name="url" dir="ltr" placeholder="https://meet.google.com/…" />
                <TextArea label="ملاحظات" name="notes" rows={2} />
              </ActionForm>)}
          </Card>

          <Card title="المتابعات">
            {followUps.length === 0 ? <p className="text-sm text-ink-500">لا توجد متابعات.</p> : (
              <ul className="space-y-2 text-sm">{followUps.map((f: any) => (
                <li key={f.id} className="flex justify-between gap-2"><span>{f.reason}</span>
                  <span className={f.status === "open" && new Date(f.due_at) < new Date() ? "font-semibold text-bad" : "text-ink-500"}>{FOLLOWUP_STATUS[f.status]} · {fmtDateTime(f.due_at)}</span></li>))}</ul>)}
          </Card>

          <Card title="سجل الإسناد">
            <ol className="space-y-2 text-sm">{assignments.map((a: any) => (
              <li key={a.id}><span className="font-medium">{a.kind === "owner" ? "المسؤول" : "المبيعات"}:</span> {a.from_name ? `${a.from_name} ← ` : ""}{a.to_name}
                <div className="text-xs text-ink-500">{a.by_name} · {fmtDateTime(a.created_at)}{a.reason ? ` · ${a.reason}` : ""}</div></li>))}</ol>
            {can(s, "leads.transfer") && (
              <details className="mt-4 border-t border-line pt-3 text-sm"><summary className="cursor-pointer font-medium text-burgundy-600">نقل الملكية</summary>
                <ActionForm action={transferLeadAction} submit="نقل" tone="quiet" className="mt-3 space-y-3">
                  <Hidden name="lead_id" value={id} />
                  <SelectField label="نوع النقل" name="kind" required options={[{ value: "owner", label: "المسؤول عن العميل" }, { value: "sales", label: "مندوب المبيعات" }]} />
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
