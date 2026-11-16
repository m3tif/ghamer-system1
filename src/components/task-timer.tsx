"use client";
import { useEffect, useState } from "react";

/** Live clock for a running task timer: base minutes already logged + the time since the timer started. */
export function TaskTimer({ since, baseSeconds }: { since: string; baseSeconds: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const total = Math.max(0, baseSeconds + (now == null ? 0 : Math.floor((now - new Date(since).getTime()) / 1000)));
  const p = (n: number) => String(n).padStart(2, "0");
  return <span dir="ltr" className="font-mono text-2xl font-bold tabular-nums" suppressHydrationWarning>{p(Math.floor(total / 3600))}:{p(Math.floor((total % 3600) / 60))}:{p(total % 60)}</span>;
}
