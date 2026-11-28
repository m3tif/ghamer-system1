import Link from "next/link";
import { Suspense } from "react";
import { requirePortal } from "@/lib/portal-auth";
import { tx } from "@/lib/db";
import { setTimezone } from "@/lib/format";
import { portalProjects, portalProject } from "@/server/portal-data";
import { PortalNav } from "@/components/portal/nav";
import { portalLogoutAction } from "@/server/portal-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "بوابة العملاء", template: "%s | بوابة عملاء غامر" } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ps = await requirePortal();
  const tz = (await tx(null, (c) => c.query("select app.company_tz() tz"))).rows[0]?.tz;
  if (tz) setTimezone(tz);
  // counts on the tabs: what waits for the client
  const projects = await portalProjects(ps.accountId);
  let open = 0, approvals = 0;
  for (const p of projects) {
    const j = await portalProject(ps.accountId, p.ops_id);
    open += (j?.requests ?? []).filter((r: any) => r.status === "open").length;
    approvals += (j?.tasks ?? []).filter((t: any) => t.needs_you).length;
  }
  return (
    <div className="min-h-screen bg-[#faf7f2] pb-20 md:pb-10">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-burgundy-600 text-lg font-extrabold text-white">غ</span>
            <span className="min-w-0"><span className="block text-[11px] font-semibold text-ink-500">بوابة عملاء غامر</span><span className="block truncate font-bold leading-tight">{ps.clientName}</span></span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/portal/notifications" aria-label={`الإشعارات${ps.unread ? ` (${ps.unread} جديد)` : ""}`} className="relative rounded-full p-2 hover:bg-cream">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" /></svg>
              {ps.unread > 0 && <span className="absolute top-0.5 end-0.5 min-w-5 rounded-full bg-burgundy-600 px-1 text-center text-[11px] font-bold text-white">{ps.unread}</span>}
            </Link>
            <Link href="/portal/documents" aria-label="الملفات" className="rounded-full p-2 hover:bg-cream md:hidden">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" /></svg>
            </Link>
            <Link href="/portal/account" aria-label="حسابي" className="rounded-full p-2 hover:bg-cream">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
            </Link>
            <form action={portalLogoutAction} className="hidden sm:block"><button className="rounded-full px-3 py-2 text-sm text-ink-500 hover:bg-cream">خروج</button></form>
          </div>
        </div>
      </header>
      <Suspense><PortalNav badges={{ "/portal/tasks": open, "/portal/approvals": approvals }} /></Suspense>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
