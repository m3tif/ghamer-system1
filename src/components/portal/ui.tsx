import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ActionForm, Hidden } from "@/components/forms";
import { portalMessageAction, portalUploadAction } from "@/server/portal-actions";

/** Building blocks of the client portal — calmer and simpler than the staff screens, mobile first. */

export function Panel({ title, right, children, className = "", id }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-2xl border border-line/70 bg-white p-5 shadow-[0_1px_2px_rgba(38,32,31,0.04)] sm:p-6 ${className}`}>
      {(title || right) && <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-bold">{title}</h2>{right}</div>}
      {children}
    </section>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>{sub && <p className="mt-1 text-sm text-ink-500">{sub}</p>}</div>
      {right}
    </div>
  );
}

export function Ring({ value, size = 132 }: { value: number; size?: number }) {
  const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`نسبة الإنجاز ${v}%`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-cream-dark)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-burgundy-600)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-3xl font-extrabold tabular-nums">{v}%</span><span className="text-xs text-ink-500">اتنجز</span></div>
    </div>
  );
}

export function Bar({ value }: { value: number }) {
  return <div className="h-2 w-full overflow-hidden rounded-full bg-cream-dark"><div className="h-full rounded-full bg-burgundy-600" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

type Stage = { id: string; name: string; status: "pending" | "current" | "done"; planned_date: string | null; started_at: string | null; done_at: string | null; tasks: number; tasks_done: number };
export function Timeline({ stages, compact = false }: { stages: Stage[]; compact?: boolean }) {
  return (
    <ol className="relative">
      {stages.map((s, i) => {
        const last = i === stages.length - 1;
        return (
          <li key={s.id} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span aria-hidden className={`absolute top-8 bottom-0 start-[15px] w-0.5 ${s.status === "done" ? "bg-burgundy-600" : "bg-cream-dark"}`} />}
            <span aria-hidden className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
              s.status === "done" ? "border-burgundy-600 bg-burgundy-600 text-white" : s.status === "current" ? "border-burgundy-600 bg-white text-burgundy-700 ring-4 ring-burgundy-100" : "border-cream-dark bg-white text-ink-300"}`}>
              {s.status === "done" ? "✓" : i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`font-semibold ${s.status === "pending" ? "text-ink-500" : ""}`}>{s.name}</p>
                {s.status === "current" && <span className="rounded-full bg-burgundy-600 px-2 py-0.5 text-[11px] font-bold text-white">إحنا هنا</span>}
              </div>
              {!compact && (
                <p className="mt-0.5 text-xs text-ink-500">
                  {s.status === "done" ? `خلصت ${fmtDate(s.done_at)}` : s.status === "current" ? `بدأت ${fmtDate(s.started_at)}${s.planned_date ? ` · متوقع تخلص ${fmtDate(s.planned_date)}` : ""}` : s.planned_date ? `متوقعة ${fmtDate(s.planned_date)}` : "جاية"}
                  {s.tasks > 0 && ` · ${s.tasks_done} من ${s.tasks} شغلانة`}
                </p>)}
            </div>
          </li>);
      })}
    </ol>
  );
}

const STATE: Record<string, [string, string]> = {
  planned: ["هيتعمل", "bg-cream text-ink-500"], working: ["الفريق شغال عليه", "bg-burgundy-50 text-burgundy-700"], internal_review: ["بنراجعه", "bg-burgundy-50 text-burgundy-700"],
  your_review: ["مستني موافقتك", "bg-warn/10 text-warn"], done: ["خلص ✓", "bg-ok/10 text-ok"],
  open: ["مطلوب منك", "bg-warn/10 text-warn"], submitted: ["بنراجع ردك", "bg-burgundy-50 text-burgundy-700"], answered: ["اترد عليه", "bg-ok/10 text-ok"], closed: ["مقفول", "bg-cream text-ink-500"],
};
export function Pill({ state }: { state: string }) {
  const [t, c] = STATE[state] ?? [state, "bg-cream text-ink-500"];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${c}`}>{t}</span>;
}

export const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);

export function Files({ files, empty }: { files: { id: string; filename: string; size_bytes: number; by?: string; at?: string; from_client?: boolean }[]; empty?: string }) {
  if (!files.length) return empty ? <p className="text-sm text-ink-500">{empty}</p> : null;
  return (
    <ul className="divide-y divide-line/70">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 py-2.5">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cream text-xs font-bold text-burgundy-700">{(f.filename.split(".").pop() ?? "").slice(0, 4).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <a href={`/portal/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-burgundy-700 hover:underline">{f.filename}</a>
            <p className="text-xs text-ink-500">{kb(f.size_bytes)}{f.by ? ` · ${f.by}` : ""}{f.at ? ` · ${fmtDate(f.at)}` : ""}</p>
          </div>
        </li>))}
    </ul>
  );
}

export function Thread({ kind, id, messages, canWrite = true, placeholder = "اكتب تعليقك أو سؤالك…" }: {
  kind: string; id: string; messages: { id: string; body: string; at: string; from_client: boolean; by: string }[]; canWrite?: boolean; placeholder?: string;
}) {
  return (
    <div className="space-y-3">
      {messages.length > 0 && (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${m.from_client ? "ms-auto rounded-ee-md bg-burgundy-600 text-white" : "me-auto rounded-es-md bg-cream"}`}>
              <p className="whitespace-pre-wrap leading-7">{m.body}</p>
              <p className={`mt-1 text-[11px] ${m.from_client ? "text-burgundy-100" : "text-ink-500"}`}>{m.by} · {fmtDateTime(m.at)}</p>
            </li>))}
        </ul>)}
      {canWrite && (
        <ActionForm action={portalMessageAction} submit="ابعت" tone="quiet" className="flex flex-col gap-2 sm:flex-row sm:items-end" hiddenOnOk={false}>
          <Hidden name="kind" value={kind} /><Hidden name="thread_id" value={id} />
          <textarea name="body" rows={1} required maxLength={4000} placeholder={placeholder} aria-label="رسالتك"
            className="min-h-[42px] w-full flex-1 resize-y rounded-xl border border-line bg-white px-3 py-2 text-[15px] placeholder:text-ink-300 focus:border-burgundy-600" />
        </ActionForm>)}
    </div>
  );
}

export function Upload({ ops, kind, thread, label = "ارفع ملف" }: { ops: string; kind?: string; thread?: string; label?: string }) {
  return (
    <ActionForm action={portalUploadAction} submit={label} tone="quiet" className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Hidden name="ops_id" value={ops} />{kind && <Hidden name="kind" value={kind} />}{thread && <Hidden name="thread_id" value={thread} />}
      <input name="file" type="file" required aria-label="الملف" accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx"
        className="w-full flex-1 rounded-xl border border-dashed border-line bg-cream/40 px-3 py-2 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-1 file:text-sm" />
    </ActionForm>
  );
}

export function ProjectSwitch({ list, cur, base }: { list: { ops_id: string; title: string }[]; cur: string; base: string }) {
  if (list.length < 2) return null;
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {list.map((p) => <Link key={p.ops_id} href={`${base}?p=${p.ops_id}`} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${p.ops_id === cur ? "bg-charcoal text-white" : "border border-line bg-white hover:bg-cream"}`}>{p.title}</Link>)}
    </div>
  );
}

export function NoProject() {
  return <Panel><p className="py-8 text-center text-ink-500">مفيش مشروع مفتوح في البوابة لسه. لو محتاج حاجة كلّم مدير حسابك.</p></Panel>;
}
