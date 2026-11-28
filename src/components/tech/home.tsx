import Link from "next/link";
import type { ReactNode } from "react";
import { dailyReportMyTasks, dailyReportTeam, dailyReports, opsAccountManagers, opsList, taskGet, taskList, techPerformance, type TaskRow } from "@/server/data";
import { ActionForm, Hidden } from "@/components/forms";
import { TaskTimer } from "@/components/task-timer";
import { pauseTaskAction, startTaskAction } from "@/server/actions";
import { getTimezone, monthStart } from "@/lib/format";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";

/* ───────── shared look (same family as the admin / finance dashboards) ───────── */
const NAVY = "#1b2a41";
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : String(v ?? "").slice(0, 10));
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: getTimezone() }).format(new Date());
const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
const hm = (m: number) => (m <= 0 ? "0 د" : m >= 60 ? `${Math.floor(m / 60)} س${m % 60 ? ` ${m % 60} د` : ""}` : `${m} د`);
const first = (name: string) => name.split(/\s+/)[0];
const greet = () => { const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: getTimezone() }).format(new Date())); return h < 12 ? "صباح الخير" : "مساء الخير"; };
const dayTitle = () => new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", timeZone: getTimezone() }).format(new Date());

function due(t: TaskRow, today: string): { text: string; tone: "bad" | "warn" | "muted" | "ok" } {
  if (t.status === "approved") return { text: "اتعمد", tone: "ok" };
  if (t.status === "cancelled") return { text: "اتلغى", tone: "muted" };
  if (t.status === "submitted") return { text: "اتسلّم", tone: "muted" };
  if (t.status === "client_review") return { text: "عند العميل", tone: "muted" };
  if (!t.due_date) return { text: "من غير ميعاد", tone: "muted" };
  const d = daysBetween(today, ymd(t.due_date));
  if (d < 0) return { text: `متأخر ${-d === 1 ? "يوم" : -d === 2 ? "يومين" : `${-d} أيام`}`, tone: "bad" };
  if (d === 0) return { text: "التسليم النهارده", tone: "warn" };
  if (d === 1) return { text: "التسليم بكرة", tone: "warn" };
  return { text: `فاضل ${d === 2 ? "يومين" : `${d} أيام`}`, tone: "muted" };
}
const DUE_CLS = { bad: "bg-bad/10 text-bad", warn: "bg-warn/10 text-warn", muted: "bg-cream text-ink-500", ok: "bg-ok/10 text-ok" };
const PRI_BAR: Record<string, string> = { urgent: "bg-bad", high: "bg-warn", normal: "bg-[#b8955a]/60", low: "bg-line" };
const STATUS_DOT: Record<string, string> = { todo: "bg-ink-300", in_progress: "bg-burgundy-600", paused: "bg-ink-300", submitted: "bg-warn", changes_requested: "bg-bad", client_review: "bg-warn", approved: "bg-ok" };

/** what to do first: changes asked → late → running → due today/tomorrow → in progress → the rest by date */
function rank(t: TaskRow, today: string) {
  const d = t.due_date ? daysBetween(today, ymd(t.due_date)) : 99;
  if (t.status === "changes_requested") return 0;
  if (t.late || d < 0) return 1;
  if (t.running) return 2;
  if (d <= 1) return 3;
  if (["in_progress", "paused"].includes(t.status)) return 4;
  return 5 + Math.min(d, 90) / 100;
}
const OPEN = (t: TaskRow) => !["submitted", "client_review", "approved", "cancelled"].includes(t.status);
const service = (t: TaskRow) => t.service_name ?? "";

function Hero({ kicker, title, sub, aside, stats }: { kicker: string; title: string; sub: string; aside?: ReactNode; stats: { label: string; value: ReactNode; href?: string; hot?: boolean }[] }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-[#1b2a41] via-[#22314b] to-[#2c1b28] p-5 text-white shadow-[0_20px_40px_-20px_rgba(27,42,65,.6)] sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-60 w-60 rounded-full bg-[#b8955a]/15 blur-2xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-[#d9bf8c]">{kicker}</p>
          <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-white/70">{sub}</p>
        </div>
        {aside}
      </div>
      <dl className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => {
          const body = (<><dt className="text-xs text-white/65">{s.label}</dt><dd className={`mt-1 text-2xl font-extrabold tabular-nums ${s.hot ? "text-[#ffb4b4]" : ""}`}>{s.value}</dd></>);
          return s.href
            ? <Link key={s.label} href={s.href} className={`rounded-2xl px-4 py-3 ring-1 transition hover:bg-white/10 ${s.hot ? "bg-[#7a1f2b]/40 ring-[#ffb4b4]/30" : "bg-white/5 ring-white/10"}`}>{body}</Link>
            : <div key={s.label} className="rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">{body}</div>;
        })}
      </dl>
    </div>
  );
}

function Panel({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-[#e7dfcf] bg-white p-4 shadow-[0_1px_2px_rgba(27,42,65,.04),0_8px_24px_-12px_rgba(27,42,65,.12)] sm:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-extrabold" style={{ color: NAVY }}><span className="h-4 w-1 rounded-full bg-[#b8955a]" />{title}</h2>{right}</div>
      {children}
    </section>
  );
}
const More = ({ href, children = "الكل" }: { href: string; children?: ReactNode }) => <Link href={href} className="text-xs font-semibold text-burgundy-700 underline">{children}</Link>;
const Quiet = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-cream/60 px-4 py-6 text-center text-sm text-ink-500">{children}</p>;

/** one task as a compact row: priority stripe, title, client, who, due chip */
function TaskLine({ t, today, who = false, extra }: { t: TaskRow; today: string; who?: boolean; extra?: ReactNode }) {
  const d = due(t, today);
  return (
    <li className="relative">
      <Link href={`/tasks/${t.id}`} className="group flex items-stretch gap-3 rounded-xl border border-transparent px-2 py-2.5 transition hover:border-[#e7dfcf] hover:bg-[#fbf8f2]">
        <span aria-hidden className={`w-1 shrink-0 rounded-full ${PRI_BAR[t.priority] ?? "bg-line"}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[t.status] ?? "bg-ink-300"} ${t.running ? "animate-pulse" : ""}`} />
            <span className="truncate font-semibold group-hover:text-burgundy-700">{t.title}</span></span>
          <span className="mt-0.5 block truncate text-xs text-ink-500">{t.client_name}{service(t) ? ` · ${service(t)}` : ""}{who ? ` · ${t.assignee_name}` : ""} · {t.running ? "العدّاد شغّال" : TASK_STATUS[t.status]}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end justify-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${DUE_CLS[d.tone]}`}>{d.text}</span>
          {extra}
        </span>
      </Link>
    </li>
  );
}

/** the daily report reminder (the report itself is optional) */
async function ReportNudge({ uid }: { uid: string }) {
  const today = todayStr();
  const [mine, worked] = await Promise.all([dailyReports(uid, today, today, null), dailyReportMyTasks(uid)]);
  const sent = mine[0];
  const minutes = worked.reduce((a: number, w: any) => a + Number(w.minutes), 0);
  return (
    <Panel title="التقرير اليومي">
      {sent ? (
        <div className="rounded-xl bg-ok/5 p-3 ring-1 ring-ok/20">
          <p className="text-sm font-bold text-ok">✓ بعت تقرير النهارده</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-charcoal">{sent.body}</p>
          <Link href="/reports" className="mt-2 inline-block text-xs font-semibold text-burgundy-700 underline">تعديل</Link>
        </div>
      ) : (
        <div>
          <p className="text-sm text-charcoal">اكتب في سطرين عملت إيه النهارده، عشان مديرك يشوف شغلك.</p>
          <Link href="/reports" className="mt-3 flex items-center justify-center rounded-xl bg-burgundy-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-burgundy-700">اكتب تقرير النهارده</Link>
        </div>)}
      {worked.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold text-ink-500">اشتغلت النهارده {hm(minutes)}</p>
          <ul className="space-y-1.5 text-sm">{worked.slice(0, 4).map((w: any) => (
            <li key={w.task_id} className="flex justify-between gap-2"><Link href={`/tasks/${w.task_id}`} className="truncate hover:underline">{w.title}</Link><span className="shrink-0 tabular-nums text-ink-500">{hm(Number(w.minutes))}</span></li>))}</ul>
        </div>)}
    </Panel>
  );
}

/** a running timer, live, with a pause button */
async function RunningTimer({ uid, task }: { uid: string; task: TaskRow }) {
  const t = await taskGet(uid, task.id);
  if (!t?.running_since) return null;
  const closed = (t.logs as any[]).filter((l) => l.ended_at).reduce((a, l) => a + Math.round((new Date(l.ended_at).getTime() - new Date(l.started_at).getTime()) / 1000), 0);
  return (
    <div className="w-full rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 sm:w-auto sm:min-w-72">
      <p className="flex items-center gap-2 text-xs font-semibold text-[#9be3b4]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#5fd38d]" />العدّاد شغّال</p>
      <div className="mt-1 text-white"><TaskTimer since={t.running_since} baseSeconds={closed} /></div>
      <Link href={`/tasks/${task.id}`} className="mt-1 block max-w-72 truncate text-sm text-white/80 hover:underline">{task.title} · {task.client_name}</Link>
      <div className="mt-3 [&_button]:!border-white/20 [&_button]:!bg-white/10 [&_button]:!text-white">
        <ActionForm action={pauseTaskAction} submit="⏸ إيقاف مؤقت" tone="quiet" className=""><Hidden name="task_id" value={task.id} /></ActionForm>
      </div>
    </div>
  );
}

/* ═════════ 1. technical employee (designer, SEO, developer, …) ═════════ */
export async function TechWorkspace({ uid, name, role }: { uid: string; name: string; role: string }) {
  const today = todayStr();
  const tasks = await taskList(uid, "mine");
  const open = tasks.filter(OPEN).sort((a, b) => rank(a, today) - rank(b, today));
  const waiting = tasks.filter((t) => ["submitted", "client_review"].includes(t.status));
  const done = tasks.filter((t) => t.status === "approved").sort((a, b) => String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? "")));
  const running = tasks.find((t) => t.running);
  const late = open.filter((t) => t.late).length, fix = open.filter((t) => t.status === "changes_requested").length;
  const next = open.find((t) => !t.running);
  const nd = next ? due(next, today) : null;
  return (
    <div className="space-y-6">
      <Hero kicker={`${role} · ${dayTitle()}`} title={`${greet()} يا ${first(name)}`}
        sub={open.length === 0 ? "مفيش شغل مفتوح عليك دلوقتي 👌" : `عندك ${open.length} ${open.length === 1 ? "تاسك مفتوحة" : "تاسكات مفتوحة"}${late ? ` — منهم ${late} متأخر` : ""}.`}
        aside={running ? <RunningTimer uid={uid} task={running} /> : undefined}
        stats={[
          { label: "شغلي المفتوح", value: open.length, href: "/tasks?f=open" },
          { label: "مطلوب تعديل", value: fix, href: "/tasks?f=open", hot: fix > 0 },
          { label: "متأخر", value: late, href: "/tasks?f=late", hot: late > 0 },
          { label: "اتعمدلي", value: done.length, href: "/tasks?f=done" },
        ]} />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {next && (
            <section className="relative overflow-hidden rounded-2xl border-2 border-[#b8955a]/50 bg-gradient-to-br from-[#fbf6ec] to-white p-5">
              <p className="text-xs font-bold text-[#8a6a35]">{running ? "بعد اللي شغّال عليه" : "ابدأ بدي"}</p>
              <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/tasks/${next.id}`} className="block text-xl font-extrabold hover:underline" style={{ color: NAVY }}>{next.title}</Link>
                  <p className="mt-1 text-sm text-ink-500">{next.client_name}{service(next) ? ` · ${service(next)}` : ""} · أولوية {TASK_PRIORITY[next.priority]}</p>
                  <p className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${DUE_CLS[nd!.tone]}`}>{nd!.text}</span>
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold ring-1 ring-line">{TASK_STATUS[next.status]}</span>
                    {next.minutes > 0 && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs ring-1 ring-line">اشتغلت عليها {hm(next.minutes)}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm action={startTaskAction} submit={next.minutes > 0 ? "▶ كمّل الشغل" : "▶ ابدأ الشغل"} className=""><Hidden name="task_id" value={next.id} /></ActionForm>
                  <Link href={`/tasks/${next.id}`} className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-cream">التفاصيل</Link>
                </div>
              </div>
            </section>)}

          <Panel title={`شغلي (${open.length})`} right={<More href="/tasks?f=open" />}>
            {open.length === 0 ? <Quiet>خلّصت كل اللي عليك. أي تاسك جديدة هتظهر هنا.</Quiet>
              : <ul className="-mx-2 space-y-0.5">{open.slice(0, 10).map((t) => <TaskLine key={t.id} t={t} today={today} />)}</ul>}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={`مستني رد (${waiting.length})`}>
              {waiting.length === 0 ? <Quiet>مفيش حاجة مستنية مراجعة.</Quiet>
                : <ul className="-mx-2 space-y-0.5">{waiting.slice(0, 6).map((t) => <TaskLine key={t.id} t={t} today={today} />)}</ul>}
            </Panel>
            <Panel title="اتعمدت" right={done.length > 5 ? <More href="/tasks?f=done" /> : undefined}>
              {done.length === 0 ? <Quiet>لسه مفيش تاسكات اتعمدت.</Quiet>
                : <ul className="-mx-2 space-y-0.5">{done.slice(0, 5).map((t) => <TaskLine key={t.id} t={t} today={today} />)}</ul>}
            </Panel>
          </div>
        </div>
        <aside className="space-y-6"><ReportNudge uid={uid} /><Legend /></aside>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <Panel title="الألوان">
      <ul className="space-y-1.5 text-xs text-ink-500">
        <li className="flex items-center gap-2"><span className="h-3 w-1 rounded-full bg-bad" />عاجلة</li>
        <li className="flex items-center gap-2"><span className="h-3 w-1 rounded-full bg-warn" />مهمة</li>
        <li className="flex items-center gap-2"><span className="h-3 w-1 rounded-full bg-[#b8955a]/60" />عادية</li>
        <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-bad" />مطلوب تعديل · <span className="h-2 w-2 rounded-full bg-warn" />مستني رد · <span className="h-2 w-2 rounded-full bg-ok" />اتعمد</li>
      </ul>
    </Panel>
  );
}

/* ═════════ 2. account manager ═════════ */
export async function AmWorkspace({ uid, name, role }: { uid: string; name: string; role: string }) {
  const today = todayStr();
  const [clients, tasks] = await Promise.all([opsList(uid, null), taskList(uid, "all")]);
  const mineIds = new Set(clients.map((c) => c.id));
  const ts = tasks.filter((t) => mineIds.has(t.ops_id));
  const review = ts.filter((t) => t.status === "submitted").sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")));
  const atClient = ts.filter((t) => t.status === "client_review");
  const late = ts.filter((t) => OPEN(t) && t.late).sort((a, b) => rank(a, today) - rank(b, today));
  const by = (id: string) => ts.filter((t) => t.ops_id === id && t.status !== "cancelled");
  return (
    <div className="space-y-6">
      <Hero kicker={`${role} · ${dayTitle()}`} title={`${greet()} يا ${first(name)}`}
        sub={review.length ? `فيه ${review.length} ${review.length === 1 ? "تاسك مستنية" : "تاسكات مستنية"} مراجعتك.` : "مفيش حاجة مستنية مراجعتك دلوقتي."}
        stats={[
          { label: "عملائي", value: clients.length, href: "/operations" },
          { label: "مستني مراجعتك", value: review.length, href: "/tasks?f=review", hot: review.length > 0 },
          { label: "متأخر", value: late.length, href: "/tasks?f=late", hot: late.length > 0 },
          { label: "مستني موافقة العميل", value: atClient.length },
        ]} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {(review.length > 0 || late.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title={`راجع وسلّم (${review.length})`} right={review.length ? <More href="/tasks?f=review" /> : undefined}>
                {review.length === 0 ? <Quiet>مفيش تسليمات مستنياك.</Quiet>
                  : <ul className="-mx-2 space-y-0.5">{review.slice(0, 6).map((t) => <TaskLine key={t.id} t={t} today={today} who />)}</ul>}
              </Panel>
              <Panel title={`متأخر (${late.length})`}>
                {late.length === 0 ? <Quiet>مفيش تأخير 👌</Quiet>
                  : <ul className="-mx-2 space-y-0.5">{late.slice(0, 6).map((t) => <TaskLine key={t.id} t={t} today={today} who />)}</ul>}
              </Panel>
            </div>)}

          <Panel title={`عملائي (${clients.length})`} right={<More href="/operations" />}>
            {clients.length === 0 ? <Quiet>لسه ماحدش اتحوّلك. أول ما المدير التقني يحوّلك عميل هيظهر هنا.</Quiet> : (
              <div className="grid gap-3 sm:grid-cols-2">{clients.map((c) => {
                const list = by(c.id), approved = list.filter((t) => t.status === "approved").length, lateN = list.filter((t) => OPEN(t) && t.late).length;
                const reviewN = list.filter((t) => t.status === "submitted").length;
                const pct = list.length ? Math.round((approved / list.length) * 100) : 0;
                const nextT = list.filter(OPEN).sort((a, b) => rank(a, today) - rank(b, today))[0];
                return (
                  <Link key={c.id} href={`/operations/${c.id}`} className={`group block rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${lateN ? "border-bad/40" : "border-[#e7dfcf]"} bg-white`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><p className="truncate font-extrabold group-hover:text-burgundy-700" style={{ color: NAVY }}>{c.client_name}</p>
                        {c.business_name && <p className="truncate text-xs text-ink-500">{c.business_name}</p>}</div>
                      {c.is_existing && <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-[11px] text-ink-500">عميل قائم</span>}
                    </div>
                    <p className="mt-2 flex flex-wrap gap-1">{(c.packages ?? []).slice(0, 3).map((p) => <span key={p} className="rounded-full bg-[#f6efe2] px-2 py-0.5 text-[11px] font-semibold text-[#8a6a35]">{p}</span>)}</p>
                    {list.length === 0 ? <p className="mt-3 text-xs font-semibold text-burgundy-700">لسه مفيش تاسكات — ابدأ الخطوات ←</p> : (<>
                      <div className="mt-3 flex items-center justify-between text-xs text-ink-500"><span>{approved} من {list.length} اتعمدوا</span><span className="font-bold tabular-nums" style={{ color: NAVY }}>{pct}%</span></div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-cream-dark/70"><div className="h-full rounded-full bg-gradient-to-l from-[#1b2a41] to-[#4a5d7c]" style={{ width: `${Math.max(pct, 3)}%` }} /></div>
                      <p className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        {reviewN > 0 && <span className="rounded-full bg-warn/10 px-2 py-0.5 font-semibold text-warn">{reviewN} مستني مراجعتك</span>}
                        {lateN > 0 && <span className="rounded-full bg-bad/10 px-2 py-0.5 font-semibold text-bad">{lateN} متأخر</span>}
                        {nextT && <span className="truncate text-ink-500">الجاي: {nextT.title}</span>}
                      </p></>)}
                  </Link>);
              })}</div>)}
          </Panel>

          {atClient.length > 0 && (
            <Panel title={`مستني موافقة العميل (${atClient.length})`}>
              <ul className="-mx-2 space-y-0.5">{atClient.slice(0, 6).map((t) => <TaskLine key={t.id} t={t} today={today} who />)}</ul>
            </Panel>)}
        </div>
        <aside className="space-y-6"><ReportNudge uid={uid} /></aside>
      </div>
    </div>
  );
}

/* ═════════ 3. technical manager ═════════ */
export async function TechManagerWorkspace({ uid, name, role }: { uid: string; name: string; role: string }) {
  const today = todayStr();
  const [waiting, working, ams, tasks, perf, team] = await Promise.all([
    opsList(uid, "new"), opsList(uid, "assigned"), opsAccountManagers(uid), taskList(uid, "all"), techPerformance(uid, monthStart()), dailyReportTeam(uid, null)]);
  const open = tasks.filter(OPEN), late = open.filter((t) => t.late).sort((a, b) => rank(a, today) - rank(b, today));
  const review = tasks.filter((t) => t.status === "submitted");
  const sent = team.filter((t: any) => t.sent).length;
  const maxOpen = Math.max(1, ...perf.map((p) => p.open_now));
  return (
    <div className="space-y-6">
      <Hero kicker={`${role} · ${dayTitle()}`} title={`${greet()} يا ${first(name)}`}
        sub={waiting.length ? `${waiting.length} ${waiting.length === 1 ? "عميل جديد مستني" : "عملاء جدد مستنيين"} تحوّليهم لأكاونت مانجر.` : "كل العملاء الجداد اتحوّلوا 👌"}
        stats={[
          { label: "مستنيين أكاونت مانجر", value: waiting.length, href: "/operations", hot: waiting.length > 0 },
          { label: "عملاء شغالين", value: working.length, href: "/operations?tab=assigned" },
          { label: "تاسكات متأخرة", value: late.length, href: "/tasks?f=late", hot: late.length > 0 },
          { label: "تقارير النهارده", value: `${sent}/${team.length}`, href: "/reports" },
        ]} />

      {waiting.length > 0 && (
        <Panel title="عملاء جدد — حوّليهم" right={<More href="/operations" />}>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{waiting.slice(0, 6).map((c) => (
            <li key={c.id}><Link href={`/operations/${c.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 hover:bg-bad/10">
              <span className="min-w-0"><span className="block truncate font-bold">{c.client_name}</span>
                <span className="block truncate text-xs text-ink-500">{(c.packages ?? []).join(" · ") || (c.is_existing ? "عميل قائم — حدّدي الباقات" : "—")}</span></span>
              <span className="shrink-0 rounded-lg bg-burgundy-600 px-3 py-1.5 text-xs font-bold text-white">حوّل</span>
            </Link></li>))}</ul>
        </Panel>)}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title="ضغط الشغل على الفريق" right={<More href="/tasks/performance">الأداء بالتفصيل</More>}>
            {perf.length === 0 ? <Quiet>مفيش موظفين تقنيين.</Quiet> : (
              <ul className="space-y-3">{[...perf].sort((a, b) => b.open_now - a.open_now).map((p) => {
                const onTime = p.on_time_base ? Math.round((p.on_time / p.on_time_base) * 100) : null;
                return (
                  <li key={p.employee_id}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate"><b>{p.full_name}</b> <span className="text-xs text-ink-500">{p.role_name}</span></span>
                      <span className="shrink-0 text-xs text-ink-500">
                        <b className="text-base tabular-nums" style={{ color: NAVY }}>{p.open_now}</b> مفتوحة
                        {p.late_now > 0 && <b className="ms-2 text-bad">{p.late_now} متأخرة</b>}
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-cream-dark/70"><div className={`h-full rounded-full ${p.late_now ? "bg-gradient-to-l from-[#7a1f2b] to-[#b4505e]" : "bg-gradient-to-l from-[#1b2a41] to-[#4a5d7c]"}`} style={{ width: `${p.open_now ? Math.max(4, (p.open_now / maxOpen) * 100) : 0}%` }} /></div>
                    <p className="mt-0.5 text-[11px] text-ink-500">الشهر ده: اتعمدله {p.approved}{p.minutes ? ` · ${hm(p.minutes)} شغل` : ""}{onTime != null ? ` · في الميعاد ${onTime}%` : ""}{p.revisions ? ` · ${p.revisions} تعديل` : ""}</p>
                  </li>);
              })}</ul>)}
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={`متأخر (${late.length})`} right={late.length > 6 ? <More href="/tasks?f=late" /> : undefined}>
              {late.length === 0 ? <Quiet>مفيش تأخير 👌</Quiet> : <ul className="-mx-2 space-y-0.5">{late.slice(0, 6).map((t) => <TaskLine key={t.id} t={t} today={today} who />)}</ul>}
            </Panel>
            <Panel title={`مستني مراجعة (${review.length})`} right={review.length > 6 ? <More href="/tasks?f=review" /> : undefined}>
              {review.length === 0 ? <Quiet>مفيش تسليمات مستنية.</Quiet> : <ul className="-mx-2 space-y-0.5">{review.slice(0, 6).map((t) => <TaskLine key={t.id} t={t} today={today} who />)}</ul>}
            </Panel>
          </div>
        </div>
        <aside className="space-y-6">
          <Panel title="تقارير النهارده" right={<More href="/reports">افتح</More>}>
            {team.length === 0 ? <Quiet>مفيش موظفين.</Quiet> : (<>
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-cream-dark/70"><div className="h-full rounded-full bg-ok" style={{ width: `${(sent / team.length) * 100}%` }} /></div>
              <ul className="flex flex-wrap gap-1.5">{team.map((t: any) => (
                <li key={t.employee_id}><Link href={`/reports?emp=${t.employee_id}`} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${t.sent ? "bg-ok/10 font-semibold text-ok" : "bg-cream text-ink-500"}`}>{t.sent ? "✓" : "○"} {first(t.full_name)}</Link></li>))}</ul></>)}
          </Panel>
          <Panel title="العملاء مع كل أكاونت مانجر">
            {ams.length === 0 ? <Quiet>مفيش أكاونت مانجر.</Quiet> : (
              <ul className="space-y-2.5">{ams.map((a) => (
                <li key={a.id}><div className="flex justify-between text-sm"><span>{a.full_name}</span><b className="tabular-nums">{a.clients}</b></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-dark/70"><div className="h-full rounded-full bg-[#b8955a]" style={{ width: `${(a.clients / Math.max(1, ...ams.map((x) => x.clients))) * 100}%` }} /></div></li>))}</ul>)}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
