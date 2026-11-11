"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const BASE = 15_000, MAX = 120_000;

/**
 * Keeps the page current without a manual reload.
 *  - polls /api/pulse every 15s while the tab is visible (pauses when hidden, stops on unmount);
 *  - only re-renders the page (router.refresh) when the data really changed, so URL, filters, search, sort and page stay;
 *  - never refreshes while the user is typing in a form field;
 *  - on network errors it backs off (15s → 30s → … → 2min) instead of hammering the server, and shows a quiet "offline" note.
 */
export function AutoRefresh() {
  const router = useRouter();
  const [updated, setUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const rev = useRef<string | null>(null), delay = useRef(BASE), timer = useRef<ReturnType<typeof setTimeout> | null>(null), stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    const busy = () => !!document.querySelector("#leads-table.paint-mode") || document.querySelectorAll("#leads-table tr[data-lead]").length > 40;   // colouring, or more rows loaded than the first batch: a refresh would reset them
    const typing = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a.tagName === "INPUT" && (a as HTMLInputElement).type !== "search" && (a as HTMLInputElement).type !== "checkbox" && (a as HTMLInputElement).type !== "radio")) && !!(a as HTMLInputElement).value; };
    const schedule = () => { if (!stopped.current) timer.current = setTimeout(tick, delay.current); };
    const tick = async () => {
      if (document.visibilityState !== "visible") return schedule();
      try {
        const r = await fetch("/api/pulse", { cache: "no-store" });
        if (r.status === 401) { stopped.current = true; return; }
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        delay.current = BASE; setOffline(false);
        if (rev.current === null) rev.current = j.rev;
        else if (j.rev !== rev.current) {
          if (typing() || busy()) return schedule();            // try again next tick, do not disturb typing
          rev.current = j.rev; router.refresh();
        }
        setUpdated(new Date());
      } catch { setOffline(true); delay.current = Math.min(delay.current * 2, MAX); }
      schedule();
    };
    const onVisible = () => { if (document.visibilityState === "visible") { if (timer.current) clearTimeout(timer.current); delay.current = BASE; void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => { stopped.current = true; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);

  return (
    <div aria-live="off" data-testid="last-update" className="fixed bottom-3 end-3 z-20 rounded-full border border-line bg-white/90 px-3 py-1 text-xs text-ink-500 shadow-sm backdrop-blur">
      {offline ? "تعذّر التحديث — سنعيد المحاولة" : updated ? <>آخر تحديث: <span dir="ltr" className="tabular-nums">{updated.toLocaleTimeString("en-GB")}</span></> : "جارٍ التحديث…"}
    </div>
  );
}
