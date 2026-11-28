"use client";
import { useActionState, useState, type ReactNode } from "react";
import type { FormState } from "@/lib/form";
import { Alert, SubmitButton } from "@/components/forms";

/** A form whose result is sign-in details shown ONCE (temporary password), with a ready WhatsApp message to copy. */
export function CredentialsForm({ action, submit, children, tone = "primary", confirm }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>; submit: string; children: ReactNode; tone?: "primary" | "quiet"; confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const [copied, setCopied] = useState(false);
  const v = state.values;
  if (state.ok && v?.password) {
    const msg = `أهلًا بيك في بوابة عملاء غامر 👋\nتقدر تتابع مشروعك من هنا:\n${v.url}\nرقم الدخول: \u2066${v.phone}\u2069\nكلمة المرور المؤقتة: ${v.password}\nأول ما تدخل هتختار كلمة مرور خاصة بيك.`;
    return (
      <div data-hold-refresh className="space-y-3 rounded-xl border border-ok/30 bg-ok/5 p-4">
        <p className="font-semibold text-ok">{state.ok} ✓</p>
        <p className="text-sm">ابعت البيانات دي للعميل. <b>كلمة المرور دي مش هتظهر تاني.</b></p>
        <pre dir="rtl" className="whitespace-pre-wrap rounded-lg bg-white p-3 font-sans text-sm leading-7">{msg}</pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { navigator.clipboard?.writeText(msg); setCopied(true); }} className="rounded-md bg-burgundy-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-burgundy-700">{copied ? "اتنسخت ✓" : "انسخ الرسالة"}</button>
          <a href={typeof window === "undefined" ? "#" : window.location.pathname} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">تمام، بعتها ✓</a>
          <a href={`https://wa.me/${v.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">افتح واتساب العميل</a>
        </div>
      </div>);
  }
  return (
    <form action={formAction} className="space-y-3" onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.ok && <Alert kind="ok">{state.ok}</Alert>}
      {children}
      <SubmitButton pending={pending} tone={tone}>{submit}</SubmitButton>
    </form>
  );
}
