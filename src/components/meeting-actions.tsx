"use client";
import { ActionForm, ConfirmButton, Field, Hidden, SelectField, TextArea } from "./forms";
import { meetingAction } from "@/server/actions";

const ACTION_AR: Record<string, string> = { confirm: "تأكيد", reschedule: "إعادة جدولة", cancel: "إلغاء", complete: "تم الانعقاد", no_show: "لم يحضر", reassign: "إعادة إسناد" };

export function MeetingActions({ meetingId, allowed, reps }: { meetingId: string; allowed: string[]; reps: { id: string; full_name: string }[] }) {
  if (allowed.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {allowed.map((a) => (
        <details key={a} className="group relative">
          <summary className="inline-flex cursor-pointer list-none items-center rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium hover:bg-cream">{ACTION_AR[a]}</summary>
          <div className="absolute end-0 z-10 mt-1 w-72 rounded-lg border border-line bg-white p-3 shadow-lg">
            <ActionForm action={meetingAction} submit={ACTION_AR[a]} tone={a === "cancel" || a === "no_show" ? "quiet" : "primary"} className="space-y-3" hiddenOnOk>
              <Hidden name="meeting_id" value={meetingId} /><Hidden name="action" value={a} />
              {a === "reschedule" && <Field label="الموعد الجديد" name="at" type="datetime-local" required />}
              {a === "reassign" && <SelectField label="مندوب المبيعات" name="rep" required empty="اختر" options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />}
              {(a === "cancel" || a === "reschedule") && <TextArea label="السبب" name="reason" required rows={2} />}
              {(a === "no_show" || a === "reassign") && <TextArea label="ملاحظة" name="reason" rows={2} />}
              {(a === "confirm" || a === "complete") && <p className="text-xs text-ink-500">{a === "complete" ? "يُحتسب الاجتماع ضمن التارجت بعد هذا التأكيد." : "سيتم إشعار الطرف الآخر."}</p>}
            </ActionForm>
          </div>
        </details>
      ))}
    </div>
  );
}
