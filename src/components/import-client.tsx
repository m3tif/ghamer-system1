"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PHONE_COUNTRIES } from "@/lib/normalize";
import { inputCls } from "@/components/forms";

export function ImportUpload({ owners, fixedOwner }: { owners: { id: string; name: string }[]; fixedOwner?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;                      // double-click guard
    lock.current = true; setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/import/upload", { method: "POST", body: new FormData(e.currentTarget) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) { setErr(j.error ?? "فشل رفع الملف"); lock.current = false; setBusy(false); return; }
      router.push(`/import/${j.id}`);
    } catch { setErr("تعذّر الاتصال بالخادم. حاول مرة أخرى"); lock.current = false; setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" encType="multipart/form-data">
      {err && <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad sm:col-span-2">{err}</p>}
      <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">الملف (xlsx أو csv، حتى 4 ميجابايت و 20,000 صف) <b className="text-burgundy-600">*</b></span>
        <input type="file" name="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={inputCls} /></label>
      {owners.length > 0 ? (
        <label className="block"><span className="mb-1 block text-sm font-medium">صاحب البيانات (الموظف الذي ستُنسب إليه) <b className="text-burgundy-600">*</b></span>
          <select name="data_owner_id" required className={inputCls} defaultValue=""><option value="" disabled>اختر الموظف</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      ) : <input type="hidden" name="data_owner_id" value={fixedOwner} />}
      <label className="block"><span className="mb-1 block text-sm font-medium">اسم الموظف كما في الملف القديم (اختياري)</span>
        <input name="original_employee_name" className={inputCls} placeholder="يُحفظ كما هو لكل عميل مستورد" maxLength={120} /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">دولة الأرقام المحلية (للأرقام بدون +)</span>
        <select name="default_country" defaultValue="SA" className={inputCls}>{PHONE_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.dial})</option>)}</select></label>
      <div className="sm:col-span-2"><button disabled={busy} className="rounded-md bg-burgundy-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "جارٍ قراءة الملف وفحصه…" : "رفع وفحص الملف"}</button>
        <span className="ms-3 text-xs text-ink-500">لن يُضاف أي عميل قبل أن تراجع المعاينة وتضغط «ابدأ الاستيراد».</span></div>
    </form>
  );
}

export function RunImport({ id, total, newCount }: { id: string; total: number; newCount: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [done, setDone] = useState(0), [dups, setDups] = useState(0), [errs, setErrs] = useState(0), [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  async function start() {
    if (lock.current) return;                       // double-click guard (the database also serialises the batch)
    lock.current = true; setState("running"); setMsg(null);
    let a = 0, d = 0, e = 0, fails = 0;
    for (;;) {
      try {
        const r = await fetch(`/api/import/${id}/run`, { method: "POST" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "فشل");
        fails = 0; a += j.imported; d += j.duplicates; e += j.errors; setDone(a); setDups(d); setErrs(e);
        if (j.done) { setState("done"); router.refresh(); return; }
      } catch (x) {
        if (++fails >= 3) { setState("error"); setMsg((x as Error).message + " — يمكنك الضغط لإكمال الاستيراد من حيث توقف"); lock.current = false; router.refresh(); return; }
        await new Promise((res) => setTimeout(res, 1500 * fails));
      }
    }
  }
  const pct = newCount ? Math.min(100, Math.round((done / newCount) * 100)) : 0;
  return (
    <div className="space-y-3">
      {state !== "done" && <button onClick={start} disabled={state === "running" || newCount === 0} className="rounded-md bg-burgundy-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {state === "running" ? "جارٍ الاستيراد… لا تغلق الصفحة" : state === "error" ? "إكمال الاستيراد" : `ابدأ الاستيراد (${newCount} عميل جديد)`}</button>}
      {state !== "idle" && (
        <div role="status" aria-live="polite">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-cream-dark"><div className="h-full bg-burgundy-600 transition-all" style={{ width: `${state === "done" ? 100 : pct}%` }} /></div>
          <p className="mt-1 text-sm">{state === "done" ? "اكتمل الاستيراد. " : ""}تم استيراد <b>{done}</b> من {newCount}{dups > 0 && <> · مكرر ظهر أثناء التنفيذ {dups}</>}{errs > 0 && <> · أخطاء {errs}</>}</p>
        </div>)}
      {msg && <p role="alert" className="text-sm text-bad">{msg}</p>}
    </div>
  );
}
