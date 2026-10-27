"use client";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "./forms";
import { Dialog } from "./dialog";
import { ReturnTo } from "./flash";
import { completeMeetingAction, meetingAction, updateMeetingAction } from "@/server/actions";
import { MEETING_TYPE, OUTCOME } from "@/lib/labels";
import type { MeetingFlags } from "@/server/meeting-rules";

type M = { id: string; title: string | null; meeting_type: string; scheduled_local: string; meeting_url: string | null; booking_notes: string | null; client_name?: string };
const typeOpts = Object.entries(MEETING_TYPE).map(([value, label]) => ({ value, label }));

export function MeetingActions({ m, flags, reps, tz }: { m: M; flags: MeetingFlags; reps: { id: string; full_name: string }[]; tz: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {m.meeting_url && <a href={m.meeting_url} target="_blank" rel="noopener noreferrer nofollow" className="rounded-md bg-burgundy-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-burgundy-700">فتح الرابط</a>}
      {flags.canResult && (
        <Dialog trigger="تسجيل النتيجة" title={`نتيجة الاجتماع${m.client_name ? ` — ${m.client_name}` : ""}`} tone="primary">
          <ActionForm action={completeMeetingAction} submit="حفظ النتيجة" hiddenOnOk className="space-y-4">
            <Hidden name="meeting_id" value={m.id} /><ReturnTo />
            <SelectField label="نتيجة الاجتماع" name="outcome" required empty="اختر النتيجة" options={Object.entries(OUTCOME).map(([value, label]) => ({ value, label }))} />
            <TextArea label="ملاحظات الاجتماع" name="notes" rows={3} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الخطوة التالية" name="next_step" placeholder="مثال: إرسال عرض السعر" />
              <Field label={`موعد الخطوة التالية — ${tz}`} name="next_at" type="datetime-local" hint="اختياري، ويُنشئ متابعة عند تحديده" />
            </div>
          </ActionForm>
        </Dialog>)}
      {flags.canEdit && (
        <Dialog trigger="تعديل" title="تعديل الاجتماع" wide>
          <ActionForm action={updateMeetingAction} submit="حفظ التعديلات" hiddenOnOk className="space-y-4">
            <Hidden name="meeting_id" value={m.id} /><ReturnTo />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="عنوان الاجتماع" name="title" defaultValue={m.title ?? ""} />
              <SelectField label="النوع" name="type" defaultValue={m.meeting_type} options={typeOpts} />
              <Field label={`التاريخ والوقت — ${tz}`} name="at" type="datetime-local" required defaultValue={m.scheduled_local} />
              <Field label="رابط الاجتماع" name="url" dir="ltr" placeholder="https://meet.google.com/…" defaultValue={m.meeting_url ?? ""} hint="اتركه فارغًا لحذف الرابط" />
            </div>
            <TextArea label="ملاحظات" name="notes" rows={2} defaultValue={m.booking_notes ?? ""} />
            <TextArea label="سبب تغيير الموعد" name="reason" rows={2} hint="مطلوب فقط عند تغيير التاريخ أو الوقت" />
          </ActionForm>
        </Dialog>)}
      {flags.canConfirm && (
        <ActionForm action={meetingAction} submit="تأكيد" tone="quiet" className="inline">
          <Hidden name="meeting_id" value={m.id} /><ReturnTo /><Hidden name="action" value="confirm" />
        </ActionForm>)}
      {flags.canNoShow && (
        <Dialog trigger="لم يحضر" title="تسجيل عدم حضور العميل" tone="danger">
          <ActionForm action={meetingAction} submit="تأكيد عدم الحضور" tone="quiet" hiddenOnOk>
            <Hidden name="meeting_id" value={m.id} /><ReturnTo /><Hidden name="action" value="no_show" />
            <TextArea label="ملاحظة" name="reason" rows={2} />
          </ActionForm>
        </Dialog>)}
      {flags.canCancel && (
        <Dialog trigger="إلغاء" title="إلغاء الاجتماع" tone="danger">
          <ActionForm action={meetingAction} submit="تأكيد الإلغاء" tone="quiet" hiddenOnOk>
            <Hidden name="meeting_id" value={m.id} /><ReturnTo /><Hidden name="action" value="cancel" />
            <TextArea label="سبب الإلغاء (مطلوب)" name="reason" required rows={3} />
            <p className="text-xs text-ink-500">يبقى الاجتماع في السجل بحالة «ملغي» ولا يظهر ضمن الاجتماعات القادمة.</p>
          </ActionForm>
        </Dialog>)}
      {flags.canReassign && reps.length > 0 && (
        <Dialog trigger="إعادة إسناد" title="إعادة إسناد الاجتماع">
          <ActionForm action={meetingAction} submit="إعادة الإسناد" tone="quiet" hiddenOnOk>
            <Hidden name="meeting_id" value={m.id} /><ReturnTo /><Hidden name="action" value="reassign" />
            <SelectField label="السيلز الجديد" name="rep" required empty="اختر" options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
            <TextArea label="السبب" name="reason" rows={2} />
          </ActionForm>
        </Dialog>)}
    </div>
  );
}
