"use client";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadLeadsChunk } from "@/server/leads-chunk";
import type { LeadQuery } from "@/server/leads-view";

/** Continuous list: loads the next rows while you scroll (no pages). Lives inside <tbody>, after the first server-rendered rows. */
export function MoreRows({ query, initialCount, total, stamp }: { query: LeadQuery; initialCount: number; total: number; stamp: number }) {
  const [chunks, setChunks] = useState<ReactNode[]>([]);
  const [loaded, setLoaded] = useState(initialCount);
  const [err, setErr] = useState<string | null>(null);
  const loadedRef = useRef(initialCount), busy = useRef(false), done = useRef(initialCount >= total);
  const sentinel = useRef<HTMLTableCellElement>(null);
  const offsets = useRef<number[]>([]);   // where each loaded chunk starts

  const load = useCallback(async () => {
    if (busy.current || done.current) return;
    busy.current = true; setErr(null);
    try {
      const r = await loadLeadsChunk(query, loadedRef.current);
      if (r.count === 0) { done.current = true; setLoaded(total); return; }
      offsets.current.push(loadedRef.current);
      loadedRef.current += r.count;
      setChunks((c) => [...c, r.node]); setLoaded(loadedRef.current);
      if (loadedRef.current >= r.total) done.current = true;
      window.dispatchEvent(new Event("leads:rows"));
    } catch { setErr("تعذّر تحميل المزيد. تأكد من الاتصال ثم اضغط «تحميل المزيد»."); }
    finally { busy.current = false; }
  }, [query, total]);

  // The page was rendered again on the server (after saving a note / status / colour, or a live update): the first rows are
  // fresh, so reload the rows that were added while scrolling too — otherwise they keep showing what they had when loaded.
  const firstStamp = useRef(stamp);
  useEffect(() => {
    if (stamp === firstStamp.current) return;
    firstStamp.current = stamp;
    let cancelled = false;
    const refresh = async () => {
      while (busy.current) await new Promise((r) => setTimeout(r, 50));
      if (loadedRef.current <= initialCount) return;
      busy.current = true;
      try {
        const res = await Promise.all(offsets.current.map((off) => loadLeadsChunk(query, off)));   // same places, fresh data
        if (!cancelled) { setChunks(res.map((r) => r.node)); window.dispatchEvent(new Event("leads:rows")); }
      } catch { /* keep the rows we have; the next save or refresh tries again */ }
      finally { busy.current = false; }
    };
    void refresh();
    return () => { cancelled = true; };
  }, [stamp, query, initialCount]);

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
