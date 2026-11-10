import Link from "next/link";
import { can, requireSession } from "@/lib/auth";
import { logoutAction } from "@/server/actions";
import { NavLink } from "@/components/nav";
import { Flash } from "@/components/flash";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const employee = ["tele_sales", "sales_rep"].includes(s.role);
  const isSales = ["sales_rep", "sales_manager"].includes(s.role);
  const items: { href: string; label: string; show: boolean; badge?: number }[] = [
    { href: "/", label: "لوحة التحكم", show: true },
    { href: "/leads", label: employee ? "العملاء اللي ضفتهم" : "العملاء", show: can(s, "leads.view") },
    { href: "/leads?tab=received", label: "الداتا المستلمة", show: s.role === "tele_sales" && can(s, "leads.view") },
    { href: "/assigned", label: "العملاء المسندين إليّ", show: isSales && can(s, "meetings.create"), badge: s.pendingReview },
    { href: "/meetings", label: "الاجتماعات", show: can(s, "meetings.view") },
    { href: "/pipeline", label: "خط المبيعات", show: can(s, "deals.view") },
    { href: "/distribution", label: "توزيع العملاء", show: can(s, "leads.distribute") },
    { href: "/bulk-distribution", label: "استيراد وتوزيع العملاء", show: can(s, "leads.bulk_distribute") },
    { href: "/follow-ups", label: "المتابعات", show: can(s, "followups.manage") },
    { href: "/targets", label: "التارجت", show: can(s, "targets.view") },
    { href: "/archive", label: "الأرشيف الشهري", show: can(s, "leads.view") || can(s, "leads.create") },
    { href: "/duplicates", label: "مراجعة التكرار", show: can(s, "duplicates.review") || can(s, "duplicates.request") },
    { href: "/visibility", label: "إخفاء وإظهار البيانات", show: s.role === "super_admin" || s.role === "general_manager" },
    { href: "/import", label: "استيراد البيانات السابقة", show: can(s, "import.own") || can(s, "import.any") },
    { href: "/employees", label: "الموظفون", show: can(s, "employees.view") },
    { href: "/clients/existing", label: "إضافة عميل قائم", show: can(s, "employees.manage") },
    { href: "/audit", label: "سجل التدقيق", show: can(s, "audit.view") },
    { href: "/notifications", label: "الإشعارات", show: true, badge: s.unread },
  ];
  const nav = items.filter((i) => i.show).map((i) => <NavLink key={i.href} href={i.href} label={i.label} badge={i.badge} />);
  const who = (
    <div className="text-sm">
      <div className="font-semibold">{s.fullName}</div>
      <div className="text-xs text-ink-300">{s.roleNameAr}</div>
      <div className="mt-2 flex gap-3 text-xs">
        <Link href="/account" className="underline">كلمة المرور</Link>
        <form action={logoutAction}><button className="underline">خروج</button></form>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      {/* phone / tablet: top bar with a menu */}
      <header className="sticky top-0 z-30 bg-charcoal text-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-extrabold">غامر <span className="text-burgundy-200">CRM</span></Link>
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-sm">القائمة
              {(s.unread + s.pendingReview) > 0 && <span className="rounded-full bg-white px-1.5 text-xs font-bold text-burgundy-700">{s.unread + s.pendingReview}</span>}</summary>
            <div className="absolute end-0 mt-2 max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-white/10 bg-charcoal p-2 shadow-2xl">
              <nav aria-label="القائمة الرئيسية" className="flex flex-col gap-1">{nav}</nav>
              <div className="mt-2 border-t border-white/10 p-3">{who}</div>
            </div>
          </details>
        </div>
      </header>
      {/* laptop / desktop: fixed side menu */}
      <aside className="hidden bg-charcoal px-3 py-4 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <Link href="/" className="mb-4 px-3 text-xl font-extrabold">غامر <span className="text-burgundy-200">CRM</span></Link>
        <nav aria-label="القائمة الرئيسية" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">{nav}</nav>
        <div className="mt-3 shrink-0 border-t border-white/10 px-3 pt-4">{who}</div>
      </aside>
      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7"><div className="mx-auto w-full max-w-[1760px]"><Flash />{children}</div><AutoRefresh /></main>
    </div>
  );
}
