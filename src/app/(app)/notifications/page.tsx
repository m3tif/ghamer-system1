import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listNotifications, myReplyable } from "@/server/data";
import { markNotificationsReadAction, replyBroadcastFormAction } from "@/server/actions";
import { ActionForm, Hidden, TextArea } from "@/components/forms";
import { Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "الإشعارات" };
export const dynamic = "force-dynamic";

export default async function Notifications() {
  const s = await requireSession();
  const [rows, rep] = await Promise.all([listNotifications(s.userId), myReplyable(s.userId)]);
  const replyable = new Map(rep.map((r) => [r.notification_id, r]));
  return (
    <>
      <PageHeader title="الإشعارات" actions={rows.some((r: any) => !r.read_at) ? <form action={markNotificationsReadAction}><button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">تحديد الكل كمقروء</button></form> : null} />
      {rows.length === 0 ? <Empty title="لا توجد إشعارات" hint="ستصلك هنا تنبيهات المتابعات والتكرار والعقود." /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {rows.map((n: any) => (
            <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.read_at ? "" : "bg-burgundy-50"}`}>
              <span className={`mt-2 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-burgundy-600"}`} aria-label={n.read_at ? "مقروء" : "غير مقروء"} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</div>
                {n.body && <div className="text-sm text-ink-500">{n.body}</div>}
                {replyable.has(n.id) && (() => { const r = replyable.get(n.id)!; return (
                  <div className="mt-2 space-y-2">
                    {r.my_replies.map((m, i) => <p key={i} className="rounded-md bg-ok/5 px-3 py-2 text-sm"><span className="text-xs font-semibold text-ok">ردّك · {fmtDateTime(m.at)}</span><span className="block whitespace-pre-wrap">{m.body}</span></p>)}
                    <details open={r.my_replies.length === 0}><summary className="cursor-pointer text-sm font-semibold text-burgundy-700">{r.my_replies.length ? "ابعت رد تاني" : "اكتب ردك"}</summary>
                      <ActionForm action={replyBroadcastFormAction} submit="ابعت الرد" className="mt-2 max-w-xl space-y-2">
                        <Hidden name="broadcast_id" value={r.broadcast_id} /><TextArea label="ردّك" name="body" rows={3} required />
                      </ActionForm></details>
                  </div>); })()}
              </div>
              <time className="shrink-0 text-xs text-ink-500">{fmtDateTime(n.created_at)}</time>
            </li>))}
        </ul>)}
    </>
  );
}
