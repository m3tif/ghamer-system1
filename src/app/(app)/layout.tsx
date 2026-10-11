import Link from "next/link";
import { can, requireSession } from "@/lib/auth";
import { logoutAction } from "@/server/actions";
import { unreadCount } from "@/server/data";
import { NavLink } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const unread = await unreadCount(s.userId);
  const items: { href: string; label: string; show: boolean; badge?: number }[] = [
    { href: "/", label: "لوحة التحكم", show: true },
    { href: "/leads", label: "العملاء المحتملون", show: can(s, "leads.view") },
    { href: "/meetings", label: "الاجتماعات", show: can(s, "meetings.view") },
    { href: "/pipeline", label: "خط المبيعات", show: can(s, "deals.view") },
    { href: "/follow-ups", label: "المتابعات", show: can(s, "followups.manage") },
    { href: "/targets", label: "التارجت", show: can(s, "targets.view") },
    { href: "/duplicates", label: "مراجعة التكرار", show: can(s, "duplicates.review") || can(s, "duplicates.request") },
    { href: "/employees", label: "الموظفون", show: can(s, "employees.view") },
    { href: "/clients/existing", label: "إضافة عميل قائم", show: can(s, "employees.manage") },
    { href: "/audit", label: "سجل التدقيق", show: can(s, "audit.view") },
    { href: "/notifications", label: "الإشعارات", show: true, badge: unread },
  ];
  return (
    <div className="min-h-screen md:grid md:grid-cols-[250px_1fr]">
      <aside className="bg-charcoal px-3 py-4 text-white md:sticky md:top-0 md:h-screen md:overflow-y-auto">
        <div className="mb-4 flex items-center justify-between px-3">
          <Link href="/" className="text-xl font-extrabold">غامر <span className="text-burgundy-200">CRM</span></Link>
        </div>
        <nav aria-label="القائمة الرئيسية" className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:pb-0">
          {items.filter((i) => i.show).map((i) => <NavLink key={i.href} href={i.href} label={i.label} badge={i.badge} />)}
        </nav>
        <div className="mt-4 border-t border-white/10 px-3 pt-4 text-sm md:absolute md:bottom-4 md:start-3 md:end-3 md:mt-0">
          <div className="font-semibold">{s.fullName}</div>
          <div className="text-xs text-ink-300">{s.roleNameAr}</div>
          <div className="mt-2 flex gap-3 text-xs">
            <Link href="/account" className="underline">كلمة المرور</Link>
            <form action={logoutAction}><button className="underline">خروج</button></form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
