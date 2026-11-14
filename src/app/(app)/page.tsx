import Link from "next/link";
import { contractList } from "@/server/data";
import { can, requireSession } from "@/lib/auth";
import { dailyReport, type DailyRow, addedCounts, assignedLeads, companyOverview, employeeList, listFollowUps, listLeads, listMeetings, myOutcomes, myProgress, salesStats, teleStats } from "@/server/data";
import { Badge, Card, Empty, PageHeader, Progress, Stat, Table, td } from "@/components/ui";
import { getTimezone, fmtDateTime, fmtNum, fmtPct, fmtMoney, monthStart } from "@/lib/format";
import { ACHIEVEMENT, HANDOFF_STATUS, HANDOFF_TONE, LEAD_STATUS, LEAD_STATUS_TONE, MEETING_STATUS, SOURCES, TEMPERATURE, nextMilestone } from "@/lib/labels";

export const metadata = { title: "لوحة التحكم" };
export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const month = monthStart();
  const isAdmin = s.role === "super_admin" || s.role === "general_manager";
  const emps = can(s, "employees.view") ? await employeeList(s.userId) : [];
  const teleTeam = emps.filter((e) => e.role_code === "tele_sales" && e.is_active);
  const salesTeam = emps.filter((e) => e.role_code === "sales_rep" && e.is_active);

  return (
    <>
      <PageHeader title={`أهلًا ${s.fullName}`} sub={`${s.roleNameAr} · إحصائيات الشهر الحالي`} />
      {s.role === "tele_sales" && <TeleHome uid={s.userId} month={month} />}
      {s.role === "sales_rep" && <SalesHome uid={s.userId} month={month} />}
      {isAdmin && <Daily uid={s.userId} day={/^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : null} />}
      {(s.role === "tele_sales_manager" || isAdmin) && <TeleTeam uid={s.userId} month={month} team={teleTeam} />}
      {(s.role === "sales_manager" || isAdmin) && <SalesTeam uid={s.userId} month={month} team={salesTeam} />}
      {isAdmin && <Company uid={s.userId} month={month} />}
      {(s.role === "finance_manager" || s.role === "finance_employee") && <FinanceHome uid={s.userId} />}
      {!["tele_sales", "sales_rep", "tele_sales_manager", "sales_manager", "super_admin", "general_manager", "finance_manager", "finance_employee"].includes(s.role) && (
        <Empty title="لا توجد لوحة لدورك في هذه المرحلة" hint="وحدات المالية والتشغيل والمهام تُضاف في المراحل القادمة." />
      )}
    </>
  );
}

/** Finance: what is waiting for them right now (payments and approvals are added in the next steps of Phase 2). */
async function FinanceHome({ uid }: { uid: string }) {
  const [waiting, returned, all] = await Promise.all([contractList(uid, { status: "submitted" }), contractList(uid, { status: "returned" }), contractList(uid, {})]);
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-bold">المالية — العقود</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat href="/contracts?status=submitted" label="عقود بانتظار مراجعتك" value={waiting.total} tone={waiting.total ? "bad" : undefined} />
        <Stat href="/contracts?status=returned" label="رجعت للسيلز للتعديل" value={returned.total} />
        <Stat href="/contracts" label="كل العقود" value={all.total} />
      </div>
    </section>
  );
}

async function ProgressCard({ uid, month, title = "إنجازك هذا الشهر" }: { uid: string; month: string; title?: string }) {
  const pr = await myProgress(uid, uid, month);
  const goal = pr.goal == null ? null : Number(pr.goal);
  const target = goal ?? nextMilestone(pr.month_count);
  return (
    <Card title={title}>
      <div className="flex items-baseline justify-between"><span className="text-3xl font-extrabold tabular-nums">{pr.month_count} <span className="text-base font-medium text-ink-500">عميل أضفته من {target}</span></span>
        <span className="text-sm text-ink-500">{goal ? "هدفك الشهري" : "الإنجاز القادم"}</span></div>
      <div className="mt-2"><Progress value={pr.month_count} max={target} /></div>
      {pr.month_count >= (goal ?? Infinity) && <p className="mt-2 text-sm font-semibold text-ok">أحسنت! وصلت إلى هدفك الشهري.</p>}
      {pr.achievements.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">{pr.achievements.map((a) => <span key={a.code} className="rounded-full bg-burgundy-100 px-2.5 py-0.5 text-xs font-bold text-burgundy-800">★ {ACHIEVEMENT[a.code] ?? a.code}</span>)}</p>)}
    </Card>
  );
}

async function TeleHome({ uid, month }: { uid: string; month: string }) {
  const [st, upcoming, overdue, recent, outcomes] = await Promise.all([
    teleStats(uid, uid, month), listMeetings(uid, "upcoming", 8), listFollowUps(uid, "open"), listLeads(uid, { creator: uid }), myOutcomes(uid),
  ]);
  const target = st.target == null ? null : Number(st.target);
  return (
    <div className="space-y-6">
      <ProgressCard uid={uid} month={month} />
      {target != null && (
        <Card title="التارجت الشهري — الاجتماعات المنعقدة">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between"><span className="text-3xl font-extrabold tabular-nums">{fmtNum(st.meetings_completed)} <span className="text-base font-medium text-ink-500">من {fmtNum(target)}</span></span></div>
            <Progress value={st.meetings_completed} max={target} />
            <p className="text-xs text-ink-500">يُحتسب الاجتماع فقط بعد انعقاده فعليًا. الاجتماعات الملغاة وإعادة الجدولة لا تُحتسب.</p>
          </div>
        </Card>)}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat href={`/leads?month=${month.slice(0, 7)}`} label="عملاء أضفتهم هذا الشهر" value={st.new_leads} />
        <Stat label="خلّيتهم «مهتم» هذا الشهر" value={st.interested_leads} />
        <Stat href="/meetings" label="اجتماعات محجوزة" value={st.meetings_scheduled} />
        <Stat href="/meetings" label="اجتماعات مؤكدة" value={st.meetings_confirmed} />
        <Stat href="/meetings?tab=done" label="اجتماعات منعقدة" value={st.meetings_completed} tone="ok" />
        <Stat label="ملغاة / لم يحضر" value={`${st.meetings_cancelled} / ${st.meetings_no_show}`} />
        <Stat label="التحويل من عميل لاجتماع" value={fmtPct(st.lead_to_meeting_pct)} />
        <Stat label="عقود نتجت عن عملائك" value={st.contracts_generated} tone="ok" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="متابعات مفتوحة" right={<Link className="text-sm text-burgundy-600 underline" href="/follow-ups">الكل</Link>}>
          {overdue.length === 0 ? <p className="text-sm text-ink-500">لا توجد متابعات مفتوحة.</p> : (
            <ul className="divide-y divide-line">{overdue.slice(0, 6).map((f: any) => (
              <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/leads/${f.lead_id}`} className="font-medium hover:underline">{f.client_name}</Link>
                <span className={f.overdue ? "font-semibold text-bad" : "text-ink-500"}>{fmtDateTime(f.due_at)}</span>
              </li>))}</ul>)}
        </Card>
        <Card title="اجتماعاتك القادمة">
          {upcoming.length === 0 ? <p className="text-sm text-ink-500">لا توجد اجتماعات قادمة.</p> : (
            <ul className="divide-y divide-line">{upcoming.slice(0, 6).map((m: any) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>{m.client_name} <span className="text-ink-500">· مع {m.rep_name}</span></span>
                <span className="text-ink-500">{fmtDateTime(m.scheduled_at)}</span>
              </li>))}</ul>)}
        </Card>
      </div>
      <Card title="آخر عملائك" right={<Link className="text-sm text-burgundy-600 underline" href="/leads">الكل</Link>}>
        {recent.rows.length === 0 ? <Empty title="لا يوجد عملاء حاليًا" hint="ابدأ بتسجيل عميل. العملاء المحوّلون إلى Sales يظهرون في الجدول التالي." /> : (
          <Table head={["العميل", "الحالة", "المتابعة القادمة"]}>
            {recent.rows.slice(0, 6).map((l: any) => (
              <tr key={l.id}><td className={td}><Link className="font-medium hover:underline" href={`/leads/${l.id}`}>{l.name}</Link></td>
                <td className={td}><Badge tone={LEAD_STATUS_TONE[l.lead_status]}>{LEAD_STATUS[l.lead_status]}</Badge></td>
                <td className={td + " text-ink-500"}>{fmtDateTime(l.next_followup_at)}</td></tr>))}
          </Table>)}
      </Card>
      <Card title="العملاء الذين حوّلتهم إلى Sales ونتائجهم" right={<Link className="text-sm text-burgundy-600 underline" href="/leads?tab=handed">الكل</Link>}>
        {outcomes.length === 0 ? <p className="text-sm text-ink-500">لم تحوّل أي عميل بعد.</p> : (
          <Table head={["العميل", "التحويل", "المستلم", "الاجتماع", "نتيجة الصفقة"]}>
            {outcomes.slice(0, 8).map((o: any) => (
              <tr key={o.lead_id}><td className={td + " font-medium"}>{o.client_name}</td>
                <td className={td}><Badge tone={HANDOFF_TONE[o.handoff_status] ?? "neutral"}>{HANDOFF_STATUS[o.handoff_status] ?? "—"}</Badge></td>
                <td className={td}>{o.to_name ?? "—"}</td><td className={td}>{o.meeting_status ? MEETING_STATUS[o.meeting_status] : "—"}</td>
                <td className={td}>{o.deal_outcome === "won" ? <Badge tone="ok">تم التعاقد</Badge> : o.deal_outcome === "lost" ? <Badge tone="bad">خسرناه</Badge> : o.deal_outcome === "open" ? <Badge tone="warn">قيد التفاوض</Badge> : "—"}</td></tr>))}
          </Table>)}
      </Card>
    </div>
  );
}

async function SalesHome({ uid, month }: { uid: string; month: string }) {
  const [st, upcoming, fups, incoming] = await Promise.all([salesStats(uid, uid, month), listMeetings(uid, "upcoming", 8), listFollowUps(uid, "open"), assignedLeads(uid, "pending")]);
  return (
    <div className="space-y-6">
      {incoming.length > 0 && (
        <Link href="/assigned" className="flex items-center justify-between rounded-lg border-2 border-warn/50 bg-warn/5 px-4 py-3 hover:bg-warn/10">
          <span><b>{incoming.length}</b> {incoming.length === 1 ? "عميل بانتظار قرارك" : "عملاء بانتظار قرارك"} <span className="text-sm text-ink-500">— لا يُعتبرون مقبولين حتى تقرر</span></span>
          <span className="rounded-md bg-burgundy-600 px-3 py-1.5 text-sm font-semibold text-white">مراجعة وقبول أو رفض</span>
        </Link>)}
      <ProgressCard uid={uid} month={month} title="العملاء الذين أضفتهم هذا الشهر" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat href="/leads" label="عملائي" value={st.my_leads} />
        <Stat href="/meetings" label="اجتماعات قادمة" value={st.upcoming_meetings} />
        <Stat href="/meetings?tab=done" label="اجتماعات منعقدة" value={st.completed_meetings} />
        <Stat href="/pipeline" label="صفقات مفتوحة" value={st.open_deals} />
        <Stat href="/pipeline?stage=Financially%20Approved" label="صفقات مغلقة بالتوقيع" value={st.deals_won} tone="ok" sub={st.target ? `التارجت ${fmtNum(st.target)}` : undefined} />
        <Stat href="/pipeline?stage=Lost" label="صفقات خسرناها" value={st.deals_lost} />
        <Stat label="معدل الإغلاق" value={fmtPct(st.win_rate_pct)} />
        <Stat href="/pipeline" label="قيمة خط المبيعات" value={fmtMoney(st.pipeline_value)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="اجتماعاتك القادمة" right={<Link className="text-sm text-burgundy-600 underline" href="/meetings">الكل</Link>}>
          {upcoming.length === 0 ? <p className="text-sm text-ink-500">لا توجد اجتماعات قادمة.</p> : (
            <ul className="divide-y divide-line">{upcoming.slice(0, 6).map((m: any) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm"><span>{m.client_name}</span>
                <span className="text-ink-500">{fmtDateTime(m.scheduled_at)}</span></li>))}</ul>)}
        </Card>
        <Card title="متابعات مفتوحة" right={<Link className="text-sm text-burgundy-600 underline" href="/follow-ups">الكل</Link>}>
          {fups.length === 0 ? <p className="text-sm text-ink-500">لا توجد متابعات.</p> : (
            <ul className="divide-y divide-line">{fups.slice(0, 6).map((f: any) => (
              <li key={f.id} className="flex items-center justify-between py-2 text-sm"><Link href={`/leads/${f.lead_id}`} className="hover:underline">{f.client_name}</Link>
                <span className={f.overdue ? "font-semibold text-bad" : "text-ink-500"}>{fmtDateTime(f.due_at)}</span></li>))}</ul>)}
        </Card>
      </div>
    </div>
  );
}

async function TeleTeam({ uid, month, team }: { uid: string; month: string; team: any[] }) {
  const rows = await Promise.all(team.map(async (e) => ({ e, st: await teleStats(uid, e.id, month) })));
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-bold">أداء فريق التيلي سيلز</h2>
      {rows.length === 0 ? <Empty title="لا يوجد موظفون في فريقك" hint="أضف موظفين من صفحة الموظفين (مدير النظام)." /> : (
        <Table head={["الموظفة", "أضافت هذا الشهر", "محجوزة", "منعقدة", "ملغاة", "التحويل", "عقود", "التارجت"]}>
          {rows.map(({ e, st }) => (
            <tr key={e.id}>
              <td className={td + " font-medium"}>{e.full_name}</td><td className={td}>{st.new_leads}</td><td className={td}>{st.meetings_scheduled}</td>
              <td className={td}>{st.meetings_completed}</td><td className={td}>{st.meetings_cancelled}</td><td className={td}>{fmtPct(st.lead_to_meeting_pct)}</td>
              <td className={td}>{st.contracts_generated}</td>
              <td className={td + " min-w-36"}>{st.target == null ? <span className="text-ink-500">غير محدد</span> : <><span className="text-xs">{st.meetings_completed}/{fmtNum(st.target)}</span><Progress value={st.meetings_completed} max={Number(st.target)} /></>}</td>
            </tr>))}
        </Table>)}
    </section>
  );
}
async function SalesTeam({ uid, month, team }: { uid: string; month: string; team: any[] }) {
  const rows = await Promise.all(team.map(async (e) => ({ e, st: await salesStats(uid, e.id, month) })));
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-bold">أداء فريق المبيعات</h2>
      {rows.length === 0 ? <Empty title="لا يوجد موظفو السيلز في فريقك" /> : (
        <Table head={["السيلز", "عملاء", "اجتماعات منعقدة", "صفقات مفتوحة", "مغلقة", "خسرناها", "معدل الإغلاق", "قيمة الخط"]}>
          {rows.map(({ e, st }) => (
            <tr key={e.id}><td className={td + " font-medium"}>{e.full_name}</td><td className={td}>{st.my_leads}</td><td className={td}>{st.completed_meetings}</td>
              <td className={td}>{st.open_deals}</td><td className={td}>{st.deals_won}</td><td className={td}>{st.deals_lost}</td>
              <td className={td}>{fmtPct(st.win_rate_pct)}</td><td className={td}>{fmtMoney(st.pipeline_value)}</td></tr>))}
        </Table>)}
    </section>
  );
}
async function Company({ uid, month }: { uid: string; month: string }) {
  const o = await companyOverview(uid, month);
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-bold">الشركة — المرحلة الأولى</h2>
      {o.pendingDistribution > 0 && (
        <Link href="/distribution" className="mb-3 flex items-center justify-between rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm font-semibold text-warn hover:bg-warn/10">
          <span>{o.pendingDistribution} عميل بانتظار التوزيع على Sales</span><span>توزيع الآن ←</span></Link>)}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat href={o.hiddenLeads ? "/leads?hidden=all" : "/leads"} label="إجمالي العملاء" value={fmtNum(o.totalLeads)} sub={o.hiddenLeads ? `ظاهر ${fmtNum(o.totalLeads - o.hiddenLeads)} · مخفي ${fmtNum(o.hiddenLeads)}` : undefined} />
        <Stat href={`/leads?month=${month.slice(0, 7)}${o.leadsHidden ? "&hidden=all" : ""}`} label="عملاء أُضيفوا هذا الشهر" value={fmtNum(o.leads)} sub={o.leadsHidden ? `منهم ${fmtNum(o.leadsHidden)} مخفي` : undefined} />
        <Stat label="عملاء اتحوّلوا للسيلز هذا الشهر" value={o.handoffs} sub={o.handoffOps !== o.handoffs ? `${o.handoffOps} عملية تحويل` : undefined} /><Stat href="/meetings" label="اجتماعات هذا الشهر" value={o.meetingsMonth} />
        <Stat href="/meetings?tab=done" label="اجتماعات منعقدة" value={o.meetingsDone} tone="ok" /><Stat href="/meetings" label="اجتماعات قادمة" value={o.meetingsUpcoming} />
        <Stat href="/follow-ups" label="متابعات مفتوحة" value={o.followUpsOpen} /><Stat href="/follow-ups" label="متابعات متأخرة" value={o.overdue} tone={o.overdue ? "bad" : undefined} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="العملاء حسب الحالة (الظاهرون)">
          {o.byStatus.length === 0 ? <p className="text-sm text-ink-500">لا بيانات.</p> : (
            <ul className="space-y-2">{o.byStatus.map((r: any) => (
              <li key={r.s} className="flex items-center gap-3 text-sm"><span className="w-36 shrink-0"><Badge tone={LEAD_STATUS_TONE[r.s]}>{LEAD_STATUS[r.s] ?? r.s}</Badge></span>
                <div className="flex-1"><Progress value={r.n} max={o.byStatus[0].n} /></div><span className="w-10 tabular-nums">{r.n}</span></li>))}</ul>)}
        </Card>
        <Card title="العملاء الجدد حسب المصدر (هذا الشهر)">
          {o.bySource.length === 0 ? <p className="text-sm text-ink-500">لا بيانات هذا الشهر.</p> : (
            <ul className="space-y-2">{o.bySource.map((r: any) => (
              <li key={r.src} className="flex items-center gap-3 text-sm"><span className="w-32 shrink-0">{SOURCES[r.src] ?? r.src}</span>
                <div className="flex-1"><Progress value={r.n} max={o.bySource[0].n} /></div><span className="w-8 tabular-nums">{r.n}</span></li>))}</ul>)}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="العملاء حسب درجة التواصل (الظاهرون)">
          <ul className="space-y-2">{o.byTemperature.map((r: any) => (
            <li key={r.t} className="flex items-center gap-3 text-sm"><span className="w-28 shrink-0">{r.t === "none" ? "غير مصنّف" : TEMPERATURE[r.t]}</span>
              <div className="flex-1"><Progress value={r.n} max={Math.max(...o.byTemperature.map((x: any) => x.n))} /></div><span className="w-10 tabular-nums">{r.n}</span></li>))}</ul>
        </Card>
        <Card title="العملاء المحوّلون للسيلز هذا الشهر (حسب آخر حالة)">
          {o.handoffMonth.length === 0 ? <p className="text-sm text-ink-500">لا توجد تحويلات هذا الشهر.</p> : (
            <ul className="space-y-2">{o.handoffMonth.map((r: any) => (
              <li key={r.s} className="flex items-center justify-between text-sm"><Badge tone={HANDOFF_TONE[r.s]}>{HANDOFF_STATUS[r.s]}</Badge><span className="tabular-nums font-bold">{r.n}</span></li>))}</ul>)}
          {o.rejectedWaiting > 0 && <Link href="/leads?status=Rejected%20by%20Sales" className="mt-3 block rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm font-semibold text-bad hover:bg-bad/10">{o.rejectedWaiting} عميل مرفوض من السيلز بانتظار قرار ←</Link>}
        </Card>
      </div>
      <div className="mt-4"><Card title="توزيع العملاء وأداء كل موظف مقابل هدفه الشهري" right={<Link className="text-sm text-burgundy-600 underline" href="/archive">الأرشيف الشهري</Link>}>
        {o.perEmployee.length === 0 ? <p className="text-sm text-ink-500">لا يوجد موظفون.</p> : (
          <Table head={["الموظف", "الدور", "أضاف هذا الشهر", "استلم هذا الشهر", "عملاء نشطون حاليًا", "الهدف الشهري", "التقدم"]}>
            {o.perEmployee.map((e: any) => (
              <tr key={e.id}><td className={td + " font-medium"}>{e.full_name}</td><td className={td}>{e.role}</td><td className={td}>{e.added}</td><td className={td}>{e.received}</td><td className={td}>{e.active_owned}</td>
                <td className={td}>{e.goal == null ? <span className="text-ink-500">غير محدد</span> : fmtNum(e.goal)}</td>
                <td className={td + " min-w-36"}>{e.goal ? <Progress value={e.added} max={Number(e.goal)} /> : "—"}</td></tr>))}
          </Table>)}
      </Card></div>
    </section>
  );
}

const shiftDay = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** Admin default view: what happened on ONE day (today unless a past day is chosen), per employee, from the real event times in the company time zone. */
async function Daily({ uid, day }: { uid: string; day: string | null }) {
  const rows = await dailyReport(uid, day);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: getTimezone() }).format(new Date());
  const shown = day ?? today;
  const sum = (f: DailyRow["family"], k: keyof DailyRow) => rows.filter((r) => r.family === f).reduce((a, r) => a + Number(r[k]), 0);
  const block = (f: DailyRow["family"], title: string) => {
    const list = rows.filter((r) => r.family === f);
    return (
      <Card title={title}>
        {list.length === 0 ? <p className="text-sm text-ink-500">لا موظفين.</p> : (
          <Table head={f === "tele" ? ["الموظف", "أضاف", "تواصل مع", "حوّل للسيلز", "قُبل", "رُفض"] : ["الموظف", "استلم", "قبل", "رفض", "حجز اجتماعات"]}>
            {list.map((r) => (
              <tr key={r.emp_id}><td className={td + " font-medium"}>{r.emp_name}</td>
                {f === "tele" ? <><td className={td + " tabular-nums"}>{r.added}</td><td className={td + " tabular-nums"}>{r.contacted}</td><td className={td + " tabular-nums"}>{r.handed}</td><td className={td + " tabular-nums"}>{r.accepted}</td><td className={td + " tabular-nums"}>{r.rejected}</td></>
                  : <><td className={td + " tabular-nums"}>{r.received}</td><td className={td + " tabular-nums"}>{r.accepted}</td><td className={td + " tabular-nums"}>{r.rejected}</td><td className={td + " tabular-nums"}>{r.meetings_booked}</td></>}
              </tr>))}
            <tr className="bg-cream font-bold"><td className={td}>الإجمالي</td>
              {f === "tele" ? <><td className={td}>{sum(f, "added")}</td><td className={td}>{sum(f, "contacted")}</td><td className={td}>{sum(f, "handed")}</td><td className={td}>{sum(f, "accepted")}</td><td className={td}>{sum(f, "rejected")}</td></>
                : <><td className={td}>{sum(f, "received")}</td><td className={td}>{sum(f, "accepted")}</td><td className={td}>{sum(f, "rejected")}</td><td className={td}>{sum(f, "meetings_booked")}</td></>}
            </tr>
          </Table>)}
      </Card>);
  };
  return (
    <section className="mb-8" data-testid="daily-results">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">نتائج {shown === today ? "اليوم" : "يوم"} <span dir="ltr" className="tabular-nums">{shown}</span></h2>
        <form className="flex items-center gap-2" role="search">
          <input type="date" name="day" defaultValue={shown} max={today} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm" aria-label="اختر اليوم" />
          <button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-cream">عرض</button>
        </form>
        <Link className="text-sm underline" href={`/?day=${shiftDay(shown, -1)}`}>اليوم السابق</Link>
        {shown !== today && <><Link className="text-sm underline" href={`/?day=${shiftDay(shown, 1)}`}>اليوم التالي</Link><Link className="text-sm underline" href="/">اليوم</Link></>}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="عملاء أُضيفوا" value={sum("tele", "added") + sum("sales", "added")} />
        <Stat label="تواصل معهم" value={sum("tele", "contacted")} />
        <Stat label="حُوّلوا للسيلز" value={sum("tele", "handed")} />
        <Stat label="قبلهم السيلز" value={sum("sales", "accepted")} tone="ok" />
        <Stat label="رفضهم السيلز" value={sum("sales", "rejected")} tone={sum("sales", "rejected") ? "bad" : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">{block("tele", "التيلي سيلز — حسب الموظف")}{block("sales", "السيلز — حسب الموظف")}</div>
      <p className="mt-2 text-xs text-ink-500">الأرقام من وقت الحدث الفعلي بتوقيت الشركة. التقارير الشهرية في الأسفل كما هي.</p>
    </section>
  );
}
