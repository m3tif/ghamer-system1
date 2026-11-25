import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { broadcastList, broadcastRecipients, broadcastReplies } from "@/server/data";
import { Card, Empty, PageHeader, Table, td } from "@/components/ui";
import { BroadcastForm } from "@/components/broadcast-form";
import { Dialog } from "@/components/dialog";
import { ActionForm, Hidden } from "@/components/forms";
import { recallBroadcastAction } from "@/server/actions";
import { fmtDateTime } from "@/lib/format";
import { AUDIENCE } from "@/lib/labels";

export const metadata = { title: "رسائل للموظفين" };
export const dynamic = "force-dynamic";

export default async function Messages({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const s = await requireSession();
  if (!["super_admin", "operations_manager", "account_manager"].includes(s.role)) notFound();
  const admin = s.role === "super_admin";
  const open = (await searchParams).b;
  const [sent, emps] = await Promise.all([broadcastList(s.userId), broadcastRecipients(s.userId)]);
  const withReplies = sent.filter((b: any) => b.allow_reply || b.replies > 0);   // a withdrawn message keeps the replies it got
  const replies = new Map(await Promise.all(withReplies.map(async (b: any) => [b.id, b.replies > 0 ? await broadcastReplies(s.userId, b.id) : []] as const)));
  const active = emps.map((e) => ({ id: e.id, full_name: e.full_name, role: e.role_name }));
  return (
    <>
      <PageHeader title="رسائل للموظفين" sub={admin ? "اكتب رسالة تظهر للموظف في نافذة أول ما يفتح السيستم، ولحد ما يدوس الزرار. وبتفضل في إشعاراته." : "ابعت رسالة للفريق التقني أو الأكاونت مانجر — بتظهرلهم في نافذة أول ما يفتحوا السيستم، وباسمك."} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_1fr]">
        <Card title="رسالة جديدة"><BroadcastForm employees={active} audiences={admin ? undefined : ["tech", "ops", "selected"]} /></Card>
        <Card title="الرسائل المرسلة">
          {sent.length === 0 ? <Empty title="لم ترسل أي رسالة من هنا بعد" /> : (
            <Table head={["الرسالة", "لمين", "شافوها", "الردود", "وقت الإرسال", ""]}>
              {sent.map((b: any) => (
                <tr key={b.id}>
                  <td className={td}><span className="font-medium">{b.title}</span><span className="mt-0.5 block max-w-md whitespace-pre-wrap text-xs text-ink-500">{b.body}</span></td>
                  <td className={td + " whitespace-nowrap"}>{AUDIENCE[b.audience]}</td>
                  <td className={td + " whitespace-nowrap tabular-nums"}>{b.recalled_at ? <span className="text-ink-500">—</span> : <>{b.seen} من {b.recipients}</>}</td>
                  <td className={td + " whitespace-nowrap tabular-nums"}>{b.allow_reply || b.replies > 0 ? (b.replies > 0 ? <a href={`#r-${b.id}`} className="font-semibold text-burgundy-700 underline">{b.replies} رد</a> : "لسه مفيش") : "—"}</td>
                  <td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(b.sent_at)}</td>
                  <td className={td + " whitespace-nowrap"}>{b.recalled_at
                    ? <span className="rounded-full bg-cream px-2.5 py-1 text-xs text-ink-500" title={`${b.recalled_by ?? ""} · ${fmtDateTime(b.recalled_at)}`}>اتسحبت · {b.recalled_by}</span>
                    : (admin || b.mine) && (
                      <Dialog trigger="تراجع" title={`تراجع عن الرسالة «${b.title}»؟`} tone="danger">
                        <ActionForm action={recallBroadcastAction} submit="أيوه، اسحبها" className="space-y-3 whitespace-normal">
                          <Hidden name="id" value={b.id} />
                          <p className="whitespace-normal text-sm leading-7">الرسالة هتختفي من عند الـ {b.recipients} موظف: من شاشتهم لو مفتوحة، ومن إشعاراتهم، ومش هتقبل ردود تانية.{b.replies > 0 ? ` الردود اللي وصلت (${b.replies}) هتفضل عندك.` : ""} والرسالة هتفضل في القايمة دي مكتوب عليها «اتسحبت».</p>
                        </ActionForm>
                      </Dialog>)}</td>
                </tr>))}
            </Table>)}
        </Card>
      </div>
      {withReplies.some((b: any) => b.replies > 0) && (
        <div className="mt-6 space-y-4">
          <h2 className="text-lg font-bold">الردود</h2>
          {withReplies.filter((b: any) => b.replies > 0).map((b: any) => (
            <details key={b.id} id={`r-${b.id}`} open={open === b.id || withReplies.length === 1} className="rounded-xl border border-line bg-white">
              <summary className="cursor-pointer px-4 py-3 font-semibold">{b.title} <span className="text-sm font-normal text-ink-500">· {b.replies} رد · {fmtDateTime(b.sent_at)}</span></summary>
              <ul className="divide-y divide-line border-t border-line">
                {(replies.get(b.id) ?? []).map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold">{r.employee} <span className="text-xs font-normal text-ink-500">{r.role_name}</span></span><time className="text-xs text-ink-500">{fmtDateTime(r.created_at)}</time></div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-7">{r.body}</p>
                  </li>))}
              </ul>
            </details>))}
        </div>)}
    </>
  );
}
