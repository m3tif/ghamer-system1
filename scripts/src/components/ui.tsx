import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function Card({ title, children, className = "", right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-lg border border-line bg-white ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-bold">{title}</h2>{right}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "bad" | "ok" }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-extrabold tabular-nums ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-ink-500">{sub}</div>}
    </div>
  );
}
const TONES: Record<string, string> = {
  neutral: "bg-cream-dark text-charcoal", ok: "bg-ok/10 text-ok", warn: "bg-warn/10 text-warn", bad: "bg-bad/10 text-bad", brand: "bg-burgundy-100 text-burgundy-800",
};
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export const btn = "inline-flex items-center justify-center rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700";
export const btnQuiet = "inline-flex items-center justify-center rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream";
export function ButtonLink({ href, children, quiet }: { href: string; children: ReactNode; quiet?: boolean }) {
  return <Link href={href} className={quiet ? btnQuiet : btn}>{children}</Link>;
}
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-line bg-cream/60 text-start text-xs text-ink-500">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2.5 text-start font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
export const td = "px-4 py-3.5 align-top";
export function Pager({ base, page, total, size = 20 }: { base: string; page: number; total: number; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const sep = base.includes("?") ? "&" : "?";
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="الصفحات">
      <span className="text-ink-500">صفحة {page} من {pages} · {total} سجل</span>
      <div className="flex gap-2">
        {page > 1 && <Link className={btnQuiet} href={`${base}${sep}page=${page - 1}`}>السابق</Link>}
        {page < pages && <Link className={btnQuiet} href={`${base}${sep}page=${page + 1}`}>التالي</Link>}
      </div>
    </nav>
  );
}
export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-cream-dark">
      <div className="h-full rounded-full bg-burgundy-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
