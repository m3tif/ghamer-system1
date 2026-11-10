"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const path = usePathname();
  const tab = useSearchParams().get("tab");
  const [base, query] = href.split("?");
  const wantTab = query ? new URLSearchParams(query).get("tab") : null;
  // "/leads" and "/leads?tab=received" are two different menu items on the same page
  const active = href === "/" ? path === "/" : (path === base || path.startsWith(base + "/")) && (wantTab ? tab === wantTab : !(base === "/leads" && tab === "received"));
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-burgundy-600 font-semibold text-white" : "text-cream-dark hover:bg-white/10"}`}>
      <span>{label}</span>
      {!!badge && <span className="rounded-full bg-white px-2 text-xs font-bold text-burgundy-700">{badge}</span>}
    </Link>
  );
}
