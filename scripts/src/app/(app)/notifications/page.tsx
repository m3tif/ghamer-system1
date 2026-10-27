import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listNotifications } from "@/server/data";
import { markNotificationsReadAction } from "@/server/actions";
import { Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "الإشعارات" };
export const dynamic = "force-dynamic";

export default async function Notifications() {
  const s = await requireSession();
  const rows = await listNotifications(s.userId);
  return (
    <>
      <PageHeader title="الإشعارات" actions={rows.some((r: any) => !r.read_at) ? <form action={markNotificationsReadAction}><button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">تحديد الكل كمقروء</button></form> : null} />
      {rows.length === 0 ? <Empty title="لا توجد إشعارات" hint="ستصلك هنا تنبيهات الاجتماعات والمتابعات والتكرار." /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {rows.map((n: any) => (
            <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.read_at ? "" : "bg-burgundy-50"}`}>
              <span className={`mt-2 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-burgundy-600"}`} aria-label={n.read_at ? "مقروء" : "غير مقروء"} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</div>
                {n.body && <div className="text-sm text-ink-500">{n.body}</div>}
              </div>
              <time className="shrink-0 text-xs text-ink-500">{fmtDateTime(n.created_at)}</time>
            </li>))}
        </ul>)}
    </>
  );
}
