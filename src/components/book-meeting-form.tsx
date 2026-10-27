"use client";
import { useState } from "react";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "./forms";
import { bookMeetingAction } from "@/server/actions";
import { MEETING_TYPE } from "@/lib/labels";
import { ReturnTo } from "./flash";

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000");

/** One request id per opening of the form: pressing Save twice can never create two meetings. */
export function BookMeetingForm({ leadId, clientName, tz, min }: { leadId: string; clientName: string; tz: string; min: string }) {
  const [rid] = useState(uuid);
  return (
    <ActionForm action={bookMeetingAction} submit="حجز الاجتماع" hiddenOnOk className="space-y-4">
      <Hidden name="lead_id" value={leadId} /><ReturnTo /><input type="hidden" name="request_id" value={rid} suppressHydrationWarning />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان الاجتماع" name="title" defaultValue={`اجتماع مع ${clientName}`} />
        <SelectField label="النوع" name="type" defaultValue="online" options={Object.entries(MEETING_TYPE).map(([value, label]) => ({ value, label }))} />
        <Field label={`التاريخ والوقت — ${tz}`} name="at" type="datetime-local" required min={min} />
        <Field label="رابط الاجتماع" name="url" dir="ltr" placeholder="https://meet.google.com/…" hint="اختياري. يظهر للسيلز والإدارة فقط" />
      </div>
      <TextArea label="ملاحظات" name="notes" rows={2} />
    </ActionForm>
  );
}
