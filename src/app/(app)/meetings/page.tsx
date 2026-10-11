import Link from "next/link";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { employeeList, listMeetings, salesReps } from "@/server/data";
import { allowedMeetingActions } from "@/server/meeting-rules";
import { Badge, Empty, PageHeader, Table, td } from "@/components/ui";
import { MeetingActions } from "@/components/meeting-actions";
import { fmtDateTime } from "@/lib/format";
import { MEETING_STATUS } from "@/lib/labels";

export const metadata = { title: "الاجتماعات" };
export const dynamic = "force-dynamic";

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const s = await requireSession(); await requirePerm(s, "meetings.view");
  const scope = ((await searchParams).scope as "upcoming" | "past" | "all") ?? "upcoming";
  const [rows, reps, emps] = await Promise.all([listMeetings(s.userId, scope), salesReps(s.userId), can(s, "employees.view") ? employeeList(s.userId) : []]);
  const managed = new Set<string>(emps.map((e: any) => e.id));
  const tabs: [string, string][] = [["upcoming", "القادمة"], ["past", "السابقة"], ["all", "الكل"]];
  return (
    <>
      <PageHeader title="الاجتماعات" sub="الاجتماع يُحتسب في التارجت فقط بعد تأكيد انعقاده من مندوب المبيعات أو المدير." />
      <div className="mb-4 flex gap-2" role="tablist">
        {tabs.map(([k, l]) => <Link key={k} href={`/meetings?scope=${k}`} role="tab" aria-selected={scope === k}
          className={`rounded-md px-3 py-1.5 text-sm ${scope === k ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>{l}</Link>)}
      </div>
      {rows.length === 0 ? <Empty title="لا توجد اجتماعات" hint="تظهر هنا الاجتماعات التي تحجزها أو تُسند إليك." /> : (
        <Table head={["الموعد", "العميل", "حجزه", "مندوب المبيعات", "الحالة", "إجراءات"]}>
          {rows.map((m: any) => (
            <tr key={m.id}>
              <td className={td + " whitespace-nowrap"}>{fmtDateTime(m.scheduled_at)}{m.reschedule_count > 0 && <div className="text-xs text-ink-500">أُعيدت جدولته {m.reschedule_count} مرة</div>}</td>
              <td className={td}><Link className="font-semibold hover:underline" href={`/leads/${m.lead_id}`}>{m.client_name}</Link>
                {m.meeting_url && <div><a className="text-xs underline" dir="ltr" href={m.meeting_url} target="_blank" rel="noopener noreferrer">رابط الاجتماع</a></div>}</td>
              <td className={td}>{m.tele_name ?? "—"}</td><td className={td}>{m.rep_name}</td>
              <td className={td}><Badge tone={m.status === "Completed" ? "ok" : m.status === "Cancelled" || m.status === "No Show" ? "bad" : "brand"}>{MEETING_STATUS[m.status]}</Badge></td>
              <td className={td}><MeetingActions meetingId={m.id} allowed={allowedMeetingActions(m, s, managed)} reps={reps} /></td>
            </tr>))}
        </Table>)}
    </>
  );
}
