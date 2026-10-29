"use client";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export const FLASH: Record<string, string> = {
  meeting_booked: "تم حجز الاجتماع",
  meeting_updated: "تم حفظ تعديلات الاجتماع",
  meeting_cancelled: "تم إلغاء الاجتماع، وبقي في السجل مع سبب الإلغاء",
  meeting_result: "تم تسجيل نتيجة الاجتماع",
  meeting_confirmed: "تم تأكيد الاجتماع",
  meeting_noshow: "تم تسجيل عدم حضور العميل",
  lead_deleted: "تم حذف العميل نهائيًا من النظام (والعملية مسجلة في سجل التدقيق)",
  leads_deleted: "تم حذف العملاء المحددين نهائيًا (والعملية مسجلة في سجل التدقيق)",
  lead_hidden: "تم إخفاء العميل عن الموظفين. يظهر لك أنت والإدارة فقط من فلتر «المخفيون»",
  lead_shown: "تم إظهار العميل للموظفين من جديد",
  meeting_reassigned: "تم إعادة إسناد الاجتماع",
};

function Inner() {
  const sp = useSearchParams();
  const key = sp.get("ok") ?? "";
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (key && FLASH[key]) {
      setMsg(FLASH[key]);
      const u = new URL(window.location.href); u.searchParams.delete("ok");
      window.history.replaceState(null, "", u.pathname + u.search); // a refresh will not show it again
      const t = setTimeout(() => setMsg(null), 8000); return () => clearTimeout(t);
    }
  }, [key]);
  if (!msg) return null;
  return (
    <div role="status" aria-live="polite" className="mb-5 flex items-center justify-between rounded-md border border-ok/30 bg-ok/5 px-4 py-2.5 text-sm font-medium text-ok">
      <span>{msg}</span>
      <button type="button" aria-label="إغلاق" onClick={() => setMsg(null)} className="px-1 text-lg leading-none">×</button>
    </div>
  );
}
export function Flash() { return <Suspense fallback={null}><Inner /></Suspense>; }

/** Hidden field with the current address, so a server action can return here and show the confirmation banner. */
export function ReturnTo() {
  const path = usePathname(); const sp = useSearchParams();
  const q = new URLSearchParams(sp.toString()); q.delete("ok");
  return <input type="hidden" name="return_to" value={path + (q.toString() ? `?${q}` : "")} suppressHydrationWarning />;
}
