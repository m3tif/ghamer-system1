"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Small "go to page N" box next to the pager. Keeps every current filter (they are already inside `base`). */
export function PageJump({ base, page, pages }: { base: string; page: number; pages: number }) {
  const router = useRouter();
  const [v, setV] = useState("");
  const [err, setErr] = useState(false);
  const go = () => {
    const n = Number(v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
    if (!Number.isInteger(n) || n < 1 || n > pages) { setErr(true); return; }
    setErr(false); setV("");
    if (n === page) return;
    router.push(`${base}${base.includes("?") ? "&" : "?"}page=${n}`);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex items-center gap-1" aria-label="الانتقال إلى صفحة">
      <input value={v} onChange={(e) => { setV(e.target.value); setErr(false); }} inputMode="numeric" dir="ltr" placeholder={`1–${pages}`} aria-label="رقم الصفحة" aria-invalid={err || undefined}
        className={`w-16 rounded-md border bg-white px-2 py-1.5 text-center text-sm ${err ? "border-red-500" : "border-line"}`} />
      <button className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm hover:bg-cream">اذهب</button>
      {err && <span role="alert" className="text-xs text-red-700">اكتب رقمًا من 1 إلى {pages}</span>}
    </form>
  );
}
