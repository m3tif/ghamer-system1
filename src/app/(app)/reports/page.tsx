import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { dailyReportMyTasks, dailyReportTeam, dailyReports } from "@/server/data";
import { saveDailyReportAction } from "@/server/actions";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ActionForm, TextArea } from "@/components/forms";
import { fmtDateTime, getTimezone } from "@/lib/format";
import { TASK_STATUS } from "@/lib/labels";

export const metadata = { title: "التقرير اليومي" };
export const dynamic = "force-dynamic";

const TECH_TEAM = ["operations_manager", "account_manager", "seo_specialist", "ui_designer", "developer", "designer", "branding_designer", "content_creator", "media_buyer", "social_media_manager", "technical_employee", "technical_team_leader"];
const REPORT_VIEWERS = ["super_admin", "general_manager", "operations_manager"];

const dayName = (d: string) => new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} س ${m % 60 ? `${m % 60} د` : ""}` : `${m} د`);

function ReportText({ r }: { r: any }) {
  return (
    <>
      <p className="whitespace-pre-wrap text-sm leading-7">{r.body}</p>
      {r.links && (
        <ul className="mt-2 space-y-1 text-sm">{String(r.links).split(/\s+/).filter(Boolean).map((u: string, i: number) => {
          const href = /^https?:\/\//i.test(u) ? u : `https://${u}`;
          return <li key={i}><a href={href} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all text-burgundy-600 underline">{u}</a></li>; })}</ul>)}
    </>);
}

export default async function Reports({ searchParams }: { searchParams: Promise<{ day?: string; emp?: string }> }) {
  const s = await requireSession();
  const viewer = REPORT_VIEWERS.includes(s.role), writer = TECH_TEAM.includes(s.role) && s.role !== "operations_manager";
  if (!viewer && !writer) notFound();
  const sp = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: getTimezone() }).format(new Date());

  if (viewer) {
    const emp = sp.emp && /^[0-9a-f-]{36}$/.test(sp.emp) ? sp.emp : null;
    const day = isDay(sp.day) ? sp.day! : today;
    const [team, rows] = await Promise.all([dailyReportTeam(s.userId, day), emp ? dailyReports(s.userId, null, today, emp) : dailyReports(s.userId, day, day, null)]);
    const sent = team.filter((t: any) => t.sent).length;
    const person = emp ? team.find((t: any) => t.employee_id === emp)?.full_name ?? rows[0]?.full_name : null;
    return (
      <>
        <PageHeader title="التقارير اليومية" sub="تيم التكنيكال بيكتب كل يوم اللي عمله. التقرير مش إجباري." />
        <form className="mb-4 flex flex-wrap items-center gap-2" action="/reports">
          <input type="date" name="day" defaultValue={day} max={today} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm" aria-label="اختار اليوم" />
          <button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">عرض</button>
          {day !== today && <Link href="/reports" className="text-sm text-burgundy-600 underline">النهارده</Link>}
          {emp && <Link href={`/reports?day=${day}`} className="text-sm text-burgundy-600 underline">كل الفريق</Link>}
        </form>
        <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
          <Card title={`${dayName(day)} · بعت ${sent} من ${team.length}`}>
            {team.length === 0 ? <p className="text-sm text-ink-500">مفيش موظفين في التيم التقني.</p> : (
              <ul className="divide-y divide-line text-sm">{team.map((t: any) => (
                <li key={t.employee_id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/reports?day=${day}&emp=${t.employee_id}`} className={`min-w-0 truncate hover:underline ${emp === t.employee_id ? "font-bold text-burgundy-700" : "font-medium"}`}>{t.full_name}<span className="block text-xs font-normal text-ink-500">{t.role_name}</span></Link>
                  {t.sent ? <Badge tone="ok">بعت</Badge> : <span className="text-xs text-ink-300">لسه</span>}
                </li>))}</ul>)}
          </Card>
          <div className="space-y-4">
            {person && <h2 className="text-lg font-bold">تقارير {person} — آخر 30 يوم</h2>}
            {rows.length === 0 ? <Empty title={emp ? "مابعتش تقارير في آخر 30 يوم" : "مفيش تقارير في اليوم ده"} /> : rows.map((r: any) => (
              <Card key={r.id} title={emp ? dayName(r.report_date) : r.full_name} right={<span className="text-xs text-ink-500">{emp ? "" : `${r.role_name} · `}{fmtDateTime(r.updated_at)}</span>}>
                <ReportText r={r} />
              </Card>))}
          </div>
        </div>
      </>);
  }

  const [mine, tasks] = await Promise.all([dailyReports(s.userId, null, today, null), dailyReportMyTasks(s.userId)]);
  const todayReport = mine.find((r: any) => r.report_date === today);
  const past = mine.filter((r: any) => r.report_date !== today);
  return (
    <>
      <PageHeader title="التقرير اليومي" sub="اكتب باختصار اللي عملته النهارده. مش إجباري، بس بيساعد مديرك يشوف شغلك." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title={`تقرير النهارده — ${dayName(today)}`} right={todayReport ? <Badge tone="ok">اتبعت · تقدر تعدّله لحد آخر اليوم</Badge> : undefined}>
          <ActionForm action={saveDailyReportAction} submit={todayReport ? "حفظ التعديل" : "إرسال التقرير"} className="space-y-3">
            <TextArea label="عملت إيه النهارده؟" name="body" rows={7} required defaultValue={todayReport?.body ?? ""}
              placeholder={"مثال:\n- خلصت تصميم البانرات لعميل نوت\n- عدّلت صفحة المنتج في المتجر\n- مستني رد العميل على الألوان"} />
            <TextArea label="روابط (اختياري) — أي رابط، كل رابط في سطر" name="links" rows={2} defaultValue={todayReport?.links ?? ""} placeholder="figma.com/... أو drive.google.com/..." />
          </ActionForm>
        </Card>
        <Card title="اللي اشتغلت عليه النهارده بالتايمر">
          {tasks.length === 0 ? <p className="text-sm text-ink-500">مفيش وقت متسجل على تاسكات النهارده.</p> : (
            <ul className="divide-y divide-line text-sm">{tasks.map((t: any) => (
              <li key={t.task_id} className="py-2"><Link href={`/tasks/${t.task_id}`} className="font-medium hover:underline">{t.title}</Link>
                <div className="text-xs text-ink-500">{t.client_name ?? "—"} · {hm(Number(t.minutes))} · {TASK_STATUS[t.status] ?? t.status}</div></li>))}</ul>)}
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-bold">تقاريرك اللي فاتت</h2>
      {past.length === 0 ? <Empty title="مفيش تقارير قبل النهارده" /> : (
        <div className="grid gap-4 lg:grid-cols-2">{past.map((r: any) => (
          <Card key={r.id} title={dayName(r.report_date)}><ReportText r={r} /></Card>))}</div>)}
    </>
  );
}
