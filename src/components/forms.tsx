"use client";
import { createContext, useActionState, useContext, useEffect, type ReactNode } from "react";
import { useDialog } from "./dialog";
import type { FormState } from "@/lib/form";

const Ctx = createContext<FormState>({});
export const useFormState0 = () => useContext(Ctx);

export const inputCls = "w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] placeholder:text-ink-300 focus:border-burgundy-600 disabled:bg-cream";

export function Alert({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  return (
    <div role={kind === "error" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-sm ${kind === "error" ? "border-bad/30 bg-bad/5 text-bad" : "border-ok/30 bg-ok/5 text-ok"}`}>
      {children}
    </div>
  );
}

export function SubmitButton({ pending, children, tone = "primary" }: { pending: boolean; children: ReactNode; tone?: "primary" | "quiet" }) {
  return (
    <button type="submit" disabled={pending}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        tone === "primary" ? "bg-burgundy-600 text-white hover:bg-burgundy-700" : "border border-line bg-white text-charcoal hover:bg-cream"}`}>
      {pending ? "جارٍ الحفظ…" : children}
    </button>
  );
}

export function ActionForm({ action, submit, children, className = "space-y-4", tone, hiddenOnOk }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>; submit: string; children: ReactNode; className?: string; tone?: "primary" | "quiet"; hiddenOnOk?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const dlg = useDialog();
  // inside a dialog: show the success message briefly, then close it
  useEffect(() => { if (state.ok && dlg) { const t = setTimeout(dlg.close, 900); return () => clearTimeout(t); } }, [state.ok]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form action={formAction} className={className}>
      <Ctx.Provider value={state}>
        {state.error && <Alert kind="error">{state.error}</Alert>}
        {state.ok && <Alert kind="ok">{state.ok}</Alert>}
        {!(hiddenOnOk && state.ok) && children}
        {!(hiddenOnOk && state.ok) && <SubmitButton pending={pending} tone={tone}>{submit}</SubmitButton>}
      </Ctx.Provider>
    </form>
  );
}

type FieldProps = { label: string; name: string; hint?: string; required?: boolean; defaultValue?: string; className?: string };

function Wrap({ label, hint, required, name, className, children }: FieldProps & { children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}{required && <span className="ms-1 text-burgundy-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Field(p: FieldProps & { type?: string; placeholder?: string; dir?: "ltr" | "rtl"; min?: string; step?: string }) {
  const st = useContext(Ctx);
  return (
    <Wrap {...p}>
      <input id={p.name} name={p.name} type={p.type ?? "text"} required={p.required} placeholder={p.placeholder} dir={p.dir}
        min={p.min} step={p.step} defaultValue={st.values?.[p.name] ?? p.defaultValue} className={inputCls} />
    </Wrap>
  );
}
export function TextArea(p: FieldProps & { rows?: number; placeholder?: string }) {
  const st = useContext(Ctx);
  return (
    <Wrap {...p}>
      <textarea id={p.name} name={p.name} rows={p.rows ?? 3} required={p.required} placeholder={p.placeholder}
        defaultValue={st.values?.[p.name] ?? p.defaultValue} className={inputCls} />
    </Wrap>
  );
}
export function SelectField(p: FieldProps & { options: { value: string; label: string }[]; empty?: string }) {
  const st = useContext(Ctx);
  return (
    <Wrap {...p}>
      <select id={p.name} name={p.name} required={p.required} defaultValue={st.values?.[p.name] ?? p.defaultValue ?? ""} className={inputCls}>
        {p.empty !== undefined && <option value="">{p.empty}</option>}
        {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Wrap>
  );
}
export function CheckGroup({ label, name, options, defaultValues = [] }: { label: string; name: string; options: { value: string; label: string }[]; defaultValues?: string[] }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm has-[:checked]:border-burgundy-600 has-[:checked]:bg-burgundy-50">
            <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="accent-burgundy-600" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function Hidden({ name, value }: { name: string; value: string }) { return <input type="hidden" name={name} value={value} />; }

/** Button that asks for confirmation before submitting its form. */
export function ConfirmButton({ message, children, className }: { message: string; children: ReactNode; className?: string }) {
  return (
    <button type="submit" className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
