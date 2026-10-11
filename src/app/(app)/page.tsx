import Link from "next/link";
import { can, requireSession } from "@/lib/auth";
import { companyOverview, employeeList, listFollowUps, listMeetings, myOutcomes, listLeads, salesStats, teleStats } from "@/server/data";
import { Badge, Card, Empty, PageHeader, Progress, Stat, Table, td } from "@/components/ui";
import { fmtDateTime, fmtNum, fmtPct, fmtMoney, monthStart } from "@/lib/format";
import { LEAD_STATUS, MEETING_STATUS, SOURCES } from "@/lib/labels";

export const metadata = { title: "لوحة التحكم" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
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
      {(s.role === "tele_sales_manager" || isAdmin) && <TeleTeam uid={s.userId} month={month} team={teleTeam} />}
      {(s.role === "sales_manager" || isAdmin) && <SalesTeam uid={s.userId} month={month} team={salesTeam} />}
      {isAdmin && <Company uid={s.userId} month={month} />}
      {!["tele_sales", "sales_rep", "tele_sales_manager", "sales_manager", "super_admin", "general_manager"].includes(s.role) && (
        <Empty title="لا توجد لوحة لدورك في هذه المرحلة" hint="وحدات المالية والتشغيل والمهام تُضاف في المراحل القادمة." />
      )}
    </>
  );
}

async function TeleHome({ uid, month }: { uid: string; month: string }) {
  const [st, upcoming, overdue, recent, outcomes] = await Promise.all([
    teleStats(uid, uid, month), listMeetings(uid, "upcoming"), listFollowUps(uid, "open"), listLeads(uid, {}), myOutcomes(uid),
  ]);
  const target = st.target == null ? null : Number(st.target);
  return (
    <div className="space-y-6">
      <Card title="التارجت الشهري — الاجتماعات المنعقدة">
        {target == null ? <p className="text-sm text-ink-500">لم يحدد المدير تارجت لهذا الشهر بعد.</p> : (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between"><span className="text-3xl font-extrabold tabular-nums">{fmtNum(st.meetings_completed)} <span className="text-base font-medium text-ink-500">من {fmtNum(target)}</span></span></div>
            <Progress value={st.meetings_completed} max={target} />
            <p className="text-xs text-ink-500">يُحتسب الاجتماع فقط بعد انعقاده فعليًا. الاجتماعات الملغاة وإعادة الجدولة لا تُحتسب.</p>
          </div>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="عملاء جدد" value={st.new_leads} />
        <Stat label="مهتمون" value={st.interested_leads} />
        <Stat label="اجتماعات محجوزة" value={st.meetings_scheduled} />
        <Stat label="اجتماعات مؤكدة" value={st.meetings_confirmed} />
        <Stat label="اجتماعات منعقدة" value={st.meetings_completed} tone="ok" />
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
      <Card title="آخر عملائك ونتائجهم" right={<Link className="text-sm text-burgundy-600 underline" href="/leads">الكل</Link>}>
        {recent.rows.length === 0 ? <Empty title="لم تسجل أي عميل بعد" hint="ابدأ بتسجيل أول عميل من صفحة العملاء." /> : (
          <Table head={["العميل", "الحالة", "الاجتماع", "نتيجة الصفقة"]}>
            {recent.rows.slice(0, 8).map((l: any) => { const o = outcomes.get(l.id); return (
              <tr key={l.id}>
                <td className={td}><Link className="font-medium hover:underline" href={`/leads/${l.id}`}>{l.name}</Link></td>
                <td className={td}><Badge>{LEAD_STATUS[l.lead_status]}</Badge></td>
                <td className={td}>{o?.meeting_status ? MEETING_STATUS[o.meeting_status] : "—"}</td>
                <td className={td}>{o?.deal_outcome === "won" ? <Badge tone="ok">تم التعاقد</Badge> : o?.deal_outcome === "lost" ? <Badge tone="bad">خسرناه</Badge> : o?.deal_outcome === "open" ? <Badge tone="warn">قيد التفاوض</Badge> : "—"}</td>
              </tr>); })}
          </Table>)}
      </Card>
    </div>
  );
}

async function SalesHome({ uid, month }: { uid: string; month: string }) {
  const [st, upcoming, fups] = await Promise.all([salesStats(uid, uid, month), listMeetings(uid, "upcoming"), listFollowUps(uid, "open")]);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="عملائي" value={st.my_leads} />
        <Stat label="اجتماعات قادمة" value={st.upcoming_meetings} />
        <Stat label="اجتماعات منعقدة" value={st.completed_meetings} />
        <Stat label="صفقات مفتوحة" value={st.open_deals} />
        <Stat label="صفقات مغلقة بالتوقيع" value={st.deals_won} tone="ok" sub={st.target ? `التارجت ${fmtNum(st.target)}` : undefined} />
        <Stat label="صفقات خسرناها" value={st.deals_lost} />
        <Stat label="معدل الإغلاق" value={fmtPct(st.win_rate_pct)} />
        <Stat label="قيمة خط المبيعات" value={fmtMoney(st.pipeline_value)} />
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
        <Table head={["الموظفة", "عملاء جدد", "محجوزة", "منعقدة", "ملغاة", "التحويل", "عقود", "التارجت"]}>
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
      {rows.length === 0 ? <Empty title="لا يوجد مندوبو مبيعات في فريقك" /> : (
        <Table head={["المندوب", "عملاء", "اجتماعات منعقدة", "صفقات مفتوحة", "مغلقة", "خسرناها", "معدل الإغلاق", "قيمة الخط"]}>
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
      <h2 className="mb-3 text-lg font-bold">الشركة — هذا الشهر</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="عملاء جدد" value={o.leads} /><Stat label="اجتماعات منعقدة" value={o.meetingsDone} /><Stat label="اجتماعات قادمة" value={o.meetingsUpcoming} />
        <Stat label="صفقات مفتوحة" value={o.openDeals} /><Stat label="صفقات موقعة" value={o.won} tone="ok" /><Stat label="صفقات خسرناها" value={o.lost} />
        <Stat label="متابعات متأخرة" value={o.overdue} tone={o.overdue ? "bad" : undefined} /><Stat label="طلبات مراجعة ملكية" value={o.openReviews} />
      </div>
      <div className="mt-4"><Card title="العملاء الجدد حسب المصدر">
        {o.bySource.length === 0 ? <p className="text-sm text-ink-500">لا بيانات هذا الشهر.</p> : (
          <ul className="space-y-2">{o.bySource.map((r: any) => (
            <li key={r.src} className="flex items-center gap-3 text-sm"><span className="w-32 shrink-0">{SOURCES[r.src] ?? r.src}</span>
              <div className="flex-1"><Progress value={r.n} max={o.bySource[0].n} /></div><span className="w-8 tabular-nums">{r.n}</span></li>))}</ul>)}
      </Card></div>
      <p className="mt-3 text-xs text-ink-500">مؤشرات المالية والتحصيل والربحية تُضاف في المرحلتين 2 و4.</p>
    </section>
  );
}
