"use client";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadLeadsChunk } from "@/server/leads-chunk";
import type { LeadQuery } from "@/server/leads-view";

/** Continuous list: loads the next rows while you scroll (no pages). Lives inside <tbody>, after the first server-rendered rows. */
export function MoreRows({ query, initialCount, total }: { query: LeadQuery; initialCount: number; total: number }) {
  const [chunks, setChunks] = useState<ReactNode[]>([]);
  const [loaded, setLoaded] = useState(initialCount);
  const [err, setErr] = useState<string | null>(null);
  const loadedRef = useRef(initialCount), busy = useRef(false), done = useRef(initialCount >= total);
  const sentinel = useRef<HTMLTableCellElement>(null);

  const load = useCallback(async () => {
    if (busy.current || done.current) return;
    busy.current = true; setErr(null);
    try {
      const r = await loadLeadsChunk(query, loadedRef.current);
      if (r.count === 0) { done.current = true; setLoaded(total); return; }
      loadedRef.current += r.count;
      setChunks((c) => [...c, r.node]); setLoaded(loadedRef.current);
      if (loadedRef.current >= r.total) done.current = true;
      window.dispatchEvent(new Event("leads:rows"));
    } catch { setErr("تعذّر تحميل المزيد. تأكد من الاتصال ثم اضغط «تحميل المزيد»."); }
    finally { busy.current = false; }
  }, [query, total]);

  useEffect(() => {
    const el = sentinel.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) void load(); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [load, loaded]);

  useEffect(() => {
    const all = async () => { while (!done.current && !busy.current) { await load(); } };
    window.addEventListener("leads:load-all", all);
    return () => window.removeEventListener("leads:load-all", all);
  }, [load]);

  return (
    <>
      {chunks.map((n, i) => <Fragment key={i}>{n}</Fragment>)}
      {loaded < total && (
        <tr data-more><td ref={sentinel} colSpan={13} className="px-3 py-3 text-center text-xs text-ink-500">
          {err ? <span role="alert" className="text-bad">{err} </span> : <span role="status">جارٍ تحميل المزيد… ({loaded} من {total})</span>}
          <button type="button" onClick={() => void load()} className="ms-2 rounded-md border border-line bg-white px-2 py-0.5 text-xs hover:bg-cream">تحميل المزيد</button>
        </td></tr>)}
    </>
  );
}
