"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inputCls } from "@/components/forms";

/** Live search: waits 350ms after typing, then updates ?q= (keeping every other filter and sort, back to page 1). */
export function SearchBox({ placeholder = "ابحث بالاسم أو رقم الهاتف أو رابط المتجر", className = "" }: { placeholder?: string; className?: string }) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const current = params.get("q") ?? "";
  const [val, setVal] = useState(current);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(current);
  useEffect(() => { if (current !== last.current) { last.current = current; setVal(current); } }, [current]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const push = (v: string) => {
    const p = new URLSearchParams(window.location.search);
    if (v.trim()) p.set("q", v.trim()); else p.delete("q");
    p.delete("page");
    last.current = v.trim();
    start(() => router.replace(`${path}${p.size ? `?${p}` : ""}`, { scroll: false }));
  };
  return (
    <div className={`relative ${className}`}>
      <input name="q" type="search" value={val} dir="auto" autoComplete="off" aria-label="بحث" placeholder={placeholder} className={inputCls}
        onChange={(e) => { setVal(e.target.value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => push(e.target.value), 350); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (timer.current) clearTimeout(timer.current); push(val); } }} />
      {pending && <span aria-live="polite" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-xs text-ink-500">جارٍ البحث…</span>}
    </div>
  );
}
