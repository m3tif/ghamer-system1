import Link from "next/link";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { employeeList, listMeetings, meetingCounts, salesReps, type MeetingTab } from "@/server/data";
import { meetingFlags } from "@/server/meeting-rules";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { MeetingActions } from "@/components/meeting-actions";
import { fmtDateTime, getTimezone, toLocalInput, tzLabel } from "@/lib/format";
import { MEETING_STATUS, MEETING_TYPE, OUTCOME } from "@/lib/labels";

export const metadata = { title: "الاجتماعات" };
export const dynamic = "force-dynamic";

const TABS: { key: MeetingTab; label: string; hint: string }[] = [
  { key: "upcoming", label: "القادمة", hint: "اجتماعات موعدها لم يحن بعد" },
  { key: "awaiting", label: "بانتظار تسجيل النتيجة", hint: "انتهى موعدها ولم تُسجَّل نتيجتها بعد" },
  { key: "done", label: "المنتهية", hint: "اجتماعات انعقدت أو لم يحضرها العميل" },
  { key: "cancelled", label: "الملغاة", hint: "اجتماعات أُلغيت، وتبقى في السجل" },
];

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession(); await requirePerm(s, "meetings.view");
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "upcoming") as MeetingTab;
  const [rows, counts, reps, emps] = await Promise.all([
    listMeetings(s.userId, tab), meetingCounts(s.userId),
    can(s, "meetings.manage") ? salesReps(s.userId) : [], can(s, "employees.view") ? employeeList(s.userId) : [],
  ]);
  const managed = new Set<string>(emps.map((e: any) => e.id));
  const tz = getTimezone();
  const active = TABS.find((t) => t.key === tab)!;
  return (
    <>
      <PageHeader title="الاجتماعات" sub={`${active.hint} · كل الأوقات ${tzLabel()}`} />
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <Link key={t.key} href={`/meetings?tab=${t.key}`} role="tab" aria-selected={tab === t.key}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-sm ${tab === t.key ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>
            {t.label}<span className={`rounded-full px-2 text-xs font-bold ${tab === t.key ? "bg-white/20" : t.key === "awaiting" && counts.awaiting > 0 ? "bg-warn/15 text-warn" : "bg-cream-dark"}`}>{counts[t.key]}</span>
          </Link>))}
      </div>
      {rows.length === 0 ? <Empty title="لا توجد اجتماعات هنا" hint={tab === "upcoming" ? "يحجز السيلز الاجتماع من صفحة العميل بعد قبوله." : undefined} /> : (
        <div className="space-y-3">
          {rows.map((m: any) => {
            const flags = meetingFlags(m, s, managed);
            const late = tab === "awaiting";
            return (
              <article key={m.id} className={`rounded-lg border bg-white p-4 ${late ? "border-warn/50" : "border-line"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold">{m.title ?? `اجتماع مع ${m.client_name}`}</h3>
                      <Badge tone={m.status === "Completed" ? "ok" : m.status === "Cancelled" || m.status === "No Show" ? "bad" : late ? "warn" : "brand"}>{late ? "بانتظار النتيجة" : MEETING_STATUS[m.status]}</Badge>
                      <Badge>{MEETING_TYPE[m.meeting_type] ?? m.meeting_type}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-500">
                      {m.can_open_lead ? <Link href={`/leads/${m.lead_id}`} className="font-semibold text-charcoal hover:underline">{m.client_name}</Link> : <span className="font-semibold text-charcoal">{m.client_name}</span>}
                      {m.business_name ? ` · ${m.business_name}` : ""} · السيلز: {m.rep_name}{m.tele_name ? ` · أضافه: ${m.tele_name}` : ""}
                    </p>
                  </div>
                  <div className="text-end">
                    <div className="text-lg font-extrabold tabular-nums">{fmtDateTime(m.scheduled_at)}</div>
                    {m.reschedule_count > 0 && <div className="text-xs text-ink-500">أُعيدت جدولته {m.reschedule_count} مرة</div>}
                  </div>
                </div>
                {m.booking_notes && <p className="mt-2 whitespace-pre-wrap rounded-md bg-cream/60 px-3 py-2 text-sm">{m.booking_notes}</p>}
                {m.outcome && (
                  <div className="mt-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm">
                    <b>النتيجة:</b> {OUTCOME[m.outcome]}{m.result_notes ? ` — ${m.result_notes}` : ""}
                    {m.next_step && <div className="text-ink-500">الخطوة التالية: {m.next_step}{m.next_step_at ? ` (${fmtDateTime(m.next_step_at)})` : ""}</div>}
                  </div>)}
                <div className="mt-3">
                  <MeetingActions m={{ id: m.id, title: m.title, meeting_type: m.meeting_type, scheduled_local: toLocalInput(m.scheduled_at), meeting_url: m.meeting_url, booking_notes: m.booking_notes, client_name: m.client_name }}
                    flags={flags} reps={reps} tz={tzLabel(tz)} />
                </div>
              </article>);
          })}
        </div>)}
    </>
  );
}
