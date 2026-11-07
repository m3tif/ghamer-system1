"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A horizontal scrollbar pinned to the bottom of the screen, linked to the leads table, so you can always slide sideways
 * (to reach the last columns, e.g. "send to sales") without scrolling down to the end of a long list.
 */
export function LeadsHScroll({ tableId = "leads-table" }: { tableId?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ left: number; width: number; inner: number } | null>(null);

  useEffect(() => {
    const t = document.getElementById(tableId); if (!t) return;
    let lock = false, raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = t.getBoundingClientRect();
        const realBarVisible = r.bottom <= window.innerHeight - 4;           // the table's own scrollbar is already on screen
        const inView = r.top < window.innerHeight - 40 && r.bottom > 80;
        if (t.scrollWidth <= t.clientWidth + 2 || realBarVisible || !inView) { setGeo(null); return; }
        setGeo({ left: r.left, width: r.width, inner: t.scrollWidth });
        if (bar.current && !lock) bar.current.scrollLeft = t.scrollLeft;
      });
    };
    const fromTable = () => { if (bar.current && !lock) { lock = true; bar.current.scrollLeft = t.scrollLeft; requestAnimationFrame(() => { lock = false; }); } };
    t.addEventListener("scroll", fromTable, { passive: true });
    window.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update);
    const ro = new ResizeObserver(update); ro.observe(t); ro.observe(t.querySelector("table") ?? t);
    update();
    return () => { cancelAnimationFrame(raf); t.removeEventListener("scroll", fromTable); window.removeEventListener("scroll", update); window.removeEventListener("resize", update); ro.disconnect(); };
  }, [tableId]);

  useEffect(() => { if (geo && bar.current) bar.current.scrollLeft = document.getElementById(tableId)?.scrollLeft ?? 0; }, [geo, tableId]);

  if (!geo) return null;
  return (
    <div ref={bar} aria-hidden data-testid="hscroll" style={{ left: geo.left, width: geo.width }}
      className="fixed bottom-0 z-30 h-5 overflow-x-auto overflow-y-hidden rounded-t-md border border-b-0 border-line bg-white/95 shadow-[0_-2px_6px_rgba(0,0,0,.08)] print:hidden"
      onScroll={(e) => { const t = document.getElementById(tableId); if (t && Math.abs(t.scrollLeft - e.currentTarget.scrollLeft) > 1) t.scrollLeft = e.currentTarget.scrollLeft; }}>
      <div style={{ width: geo.inner, height: 1 }} />
    </div>
  );
}
