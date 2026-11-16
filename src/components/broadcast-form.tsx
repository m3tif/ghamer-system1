"use client";
import { useActionState, useEffect, useState } from "react";
import { sendBroadcastAction } from "@/server/actions";
import { Alert, SubmitButton, inputCls } from "@/components/forms";
import { AUDIENCE } from "@/lib/labels";
import type { FormState } from "@/lib/form";

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "");

/** Write a message that pops up for the employees. A fresh request id per message: pressing «إرسال» twice sends it once. */
export function BroadcastForm({ employees, audiences }: { employees: { id: string; full_name: string; role: string }[]; audiences?: string[] }) {
  const [state, action, pending] = useActionState(sendBroadcastAction, {} as FormState);
  const [aud, setAud] = useState(audiences?.[0] ?? "all"); const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [req, setReq] = useState("");
  useEffect(() => { setReq(newId()); }, []);
  useEffect(() => { if (state.ok) { setTitle(""); setBody(""); setReq(newId()); } }, [state]);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="request_id" value={req} />
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.ok && <Alert kind="ok">{state.ok}</Alert>}
      <div><label htmlFor="title" className="mb-1 block text-sm font-medium">عنوان الرسالة <span className="text-burgundy-600">*</span></label>
        <input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className={inputCls} placeholder="مثال: صباح الخير ☀️" /></div>
      <div><label htmlFor="body" className="mb-1 block text-sm font-medium">نص الرسالة <span className="text-burgundy-600">*</span></label>
        <textarea id="body" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={2000} required className={inputCls} />
        <p className="mt-1 text-xs text-ink-500">{body.length} / 2000</p></div>
      <fieldset><legend className="mb-1 text-sm font-medium">تظهر لمين؟</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{Object.entries(AUDIENCE).filter(([k]) => !audiences || audiences.includes(k)).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5"><input type="radio" name="audience" value={k} checked={aud === k} onChange={() => setAud(k)} /> {l}</label>))}</div>
      </fieldset>
      {aud === "selected" && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-2">{employees.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="employees" value={e.id} /> {e.full_name} <span className="text-xs text-ink-500">({e.role})</span></label>))}</div>
        </div>)}
      {(title || body) && (
        <div className="rounded-xl border border-line bg-cream/50 p-4" aria-label="معاينة">
          <p className="mb-1 text-xs font-semibold text-burgundy-700">📣 معاينة الرسالة</p>
          <p className="mb-1 text-lg font-bold">{title || "…"}</p><p className="whitespace-pre-wrap text-sm leading-7">{body}</p>
        </div>)}
      <SubmitButton pending={pending}>إرسال الرسالة</SubmitButton>
    </form>
  );
}
