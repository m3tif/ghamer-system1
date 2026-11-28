import Link from "next/link";
import { requirePortal } from "@/lib/portal-auth";
import { portalNotifications } from "@/server/portal-data";
import { fmtDateTime } from "@/lib/format";
import { portalReadAllAction } from "@/server/portal-actions";
import { PageTitle, Panel } from "@/components/portal/ui";

export const metadata = { title: "الإشعارات" };

export default async function PortalNotifications() {
  const ps = await requirePortal();
  const list = await portalNotifications(ps.accountId);
  const unread = list.filter((n: any) => !n.read_at).length;
  return (
    <>
      <PageTitle title="الإشعارات" sub={unread ? `${unread} جديد` : "مفيش جديد"}
        right={unread > 0 ? <form action={portalReadAllAction}><button className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium hover:bg-cream">علّم الكل مقروء</button></form> : undefined} />
      <Panel>
        {list.length === 0 ? <p className="py-8 text-center text-sm text-ink-500">لسه مفيش إشعارات.</p> : (
          <ul className="divide-y divide-line/70">
            {list.map((n: any) => (
              <li key={n.id}>
                <Link href={n.link ?? "/portal"} className={`flex gap-3 py-3 hover:bg-cream/40 ${n.read_at ? "" : "font-semibold"}`}>
                  <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-burgundy-600"}`} />
                  <span className="min-w-0 flex-1"><span className="block">{n.title}</span>{n.body && <span className="block truncate text-sm font-normal text-ink-500">{n.body}</span>}
                    <span className="text-xs font-normal text-ink-500">{fmtDateTime(n.created_at)}</span></span>
                </Link>
              </li>))}
          </ul>)}
      </Panel>
    </>
  );
}
