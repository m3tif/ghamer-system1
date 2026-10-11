"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-burgundy-600 font-semibold text-white" : "text-cream-dark hover:bg-white/10"}`}>
      <span>{label}</span>
      {!!badge && <span className="rounded-full bg-white px-2 text-xs font-bold text-burgundy-700">{badge}</span>}
    </Link>
  );
}
