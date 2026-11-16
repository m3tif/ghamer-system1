import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { broadcastList, broadcastRecipients } from "@/server/data";
import { Card, Empty, PageHeader, Table, td } from "@/components/ui";
import { BroadcastForm } from "@/components/broadcast-form";
import { fmtDateTime } from "@/lib/format";
import { AUDIENCE } from "@/lib/labels";

export const metadata = { title: "رسائل للموظفين" };
export const dynamic = "force-dynamic";

export default async function Messages() {
  const s = await requireSession();
  if (!["super_admin", "operations_manager", "account_manager"].includes(s.role)) notFound();
  const admin = s.role === "super_admin";
  const [sent, emps] = await Promise.all([broadcastList(s.userId), broadcastRecipients(s.userId)]);
  const active = emps.map((e) => ({ id: e.id, full_name: e.full_name, role: e.role_name }));
  return (
    <>
      <PageHeader title="رسائل للموظفين" sub={admin ? "اكتب رسالة تظهر للموظف في نافذة أول ما يفتح السيستم، ولحد ما يدوس الزرار. وبتفضل في إشعاراته." : "ابعت رسالة للفريق التقني أو الأكاونت مانجر — بتظهرلهم في نافذة أول ما يفتحوا السيستم، وباسمك."} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_1fr]">
        <Card title="رسالة جديدة"><BroadcastForm employees={active} audiences={admin ? undefined : ["tech", "ops", "selected"]} /></Card>
        <Card title="الرسائل المرسلة">
          {sent.length === 0 ? <Empty title="لم ترسل أي رسالة من هنا بعد" /> : (
            <Table head={["الرسالة", "لمين", "شافوها", "وقت الإرسال"]}>
              {sent.map((b: any) => (
                <tr key={b.id}>
                  <td className={td}><span className="font-medium">{b.title}</span><span className="mt-0.5 block max-w-md whitespace-pre-wrap text-xs text-ink-500">{b.body}</span></td>
                  <td className={td + " whitespace-nowrap"}>{AUDIENCE[b.audience]}</td>
                  <td className={td + " whitespace-nowrap tabular-nums"}>{b.seen} من {b.recipients}</td>
                  <td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(b.sent_at)}</td>
                </tr>))}
            </Table>)}
        </Card>
      </div>
    </>
  );
}
