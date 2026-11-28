"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ITEMS = [
  { href: "/portal", label: "الرئيسية", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/portal/project", label: "مشروعي", icon: "M4 6h16M4 12h10M4 18h6" },
  { href: "/portal/tasks", label: "المهام", icon: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" },
  { href: "/portal/approvals", label: "الموافقات", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6" },
  { href: "/portal/documents", label: "الملفات", icon: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" },
  { href: "/portal/support", label: "الدعم", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" },
];
const MOBILE = ["/portal", "/portal/project", "/portal/tasks", "/portal/approvals", "/portal/support"];

const active = (path: string, href: string) => (href === "/portal" ? path === "/portal" : path.startsWith(href));

/** Desktop: a row of tabs under the header. Phone: a bottom bar with the five most used pages. */
export function PortalNav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname(), sp = useSearchParams(), p = sp.get("p");
  const href = (h: string) => (p && h !== "/portal/support" ? `${h}?p=${p}` : h);
  const dot = (h: string) => (badges[h] ? <span className="ms-1 inline-flex min-w-5 items-center justify-center rounded-full bg-burgundy-600 px-1.5 text-[11px] font-bold text-white">{badges[h]}</span> : null);
  return (
    <>
      <nav aria-label="أقسام البوابة" className="hidden border-b border-line/70 bg-white md:block">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
          {ITEMS.map((it) => (
            <Link key={it.href} href={href(it.href)} aria-current={active(path, it.href) ? "page" : undefined}
              className={`flex items-center whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${active(path, it.href) ? "border-burgundy-600 text-burgundy-700" : "border-transparent text-ink-500 hover:text-charcoal"}`}>
              {it.label}{dot(it.href)}
            </Link>))}
        </div>
      </nav>
      <nav aria-label="أقسام البوابة" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-5">
          {ITEMS.filter((it) => MOBILE.includes(it.href)).map((it) => (
            <Link key={it.href} href={href(it.href)} aria-current={active(path, it.href) ? "page" : undefined}
              className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active(path, it.href) ? "text-burgundy-700" : "text-ink-500"}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={it.icon} /></svg>
              {it.label}
              {badges[it.href] ? <span className="absolute top-1 start-1/2 ms-2 rounded-full bg-burgundy-600 px-1.5 text-[10px] font-bold text-white">{badges[it.href]}</span> : null}
            </Link>))}
        </div>
      </nav>
    </>
  );
}
