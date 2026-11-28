import Link from "next/link";
import { requirePortal } from "@/lib/portal-auth";
import { pickProject } from "@/server/portal-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { NoProject, Panel, Pill, ProjectSwitch, Ring, Timeline } from "@/components/portal/ui";

export const metadata = { title: "الرئيسية" };

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ps = await requirePortal();
  const { list, cur, project: j } = await pickProject(ps.accountId, (await searchParams).p);
  if (!cur || !j) return <NoProject />;
  const q = `?p=${cur.ops_id}`;
  const stages = j.stages as any[];
  const current = stages.find((s) => s.status === "current");
  const next = stages[stages.findIndex((s) => s.status === "current") + 1];
  const open = (j.requests as any[]).filter((r) => r.status === "open");
  const reviews = (j.tasks as any[]).filter((t) => t.needs_you);
  const last = (j.updates as any[])[0];
  const allDone = stages.length > 0 && stages.every((s) => s.status === "done");
  return (
    <>
      <ProjectSwitch list={list} cur={cur.ops_id} base="/portal" />
      <div className="mb-6">
        <p className="text-sm text-ink-500">أهلًا {ps.clientName} 👋</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-[28px]">{j.title}</h1>
        {j.services.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{(j.services as string[]).map((sv) => <span key={sv} className="rounded-full border border-line bg-white px-2.5 py-0.5 text-xs font-medium">{sv}</span>)}</div>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel className="bg-gradient-to-br from-white to-burgundy-50/40">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <Ring value={j.progress} />
            <div className="w-full min-w-0 space-y-3">
              <div><p className="text-xs font-semibold text-ink-500">{allDone ? "المشروع" : "المرحلة الحالية"}</p><p className="text-xl font-extrabold">{allDone ? "خلص ✓" : current?.name ?? "—"}</p></div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-white/80 p-3"><dt className="text-xs text-ink-500">بداية المشروع</dt><dd className="mt-0.5 font-semibold">{fmtDate(j.start_date)}</dd></div>
                <div className="rounded-xl bg-white/80 p-3"><dt className="text-xs text-ink-500">التسليم المتوقع</dt><dd className="mt-0.5 font-semibold">{fmtDate(j.expected_end)}</dd></div>
              </dl>
              {!allDone && next && <p className="text-sm text-ink-500">الخطوة الجاية: <b className="text-charcoal">{next.name}</b></p>}
            </div>
          </div>
          <details className="mt-4 text-xs text-ink-500"><summary className="cursor-pointer">النسبة دي بتتحسب إزاي؟</summary>
            <p className="mt-2 leading-6">المشروع متقسم {stages.length} مراحل، وكل مرحلة ليها نفس الوزن. المراحل اللي خلصت بتتحسب كاملة، والمرحلة الحالية بتتحسب بنسبة الشغل اللي خلص فيها.</p></details>
        </Panel>

        <Panel title="مطلوب منك" right={open.length + reviews.length > 0 ? <span className="rounded-full bg-warn/10 px-2.5 py-1 text-xs font-bold text-warn">{open.length + reviews.length}</span> : undefined}>
          {open.length + reviews.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">مفيش حاجة مطلوبة منك دلوقتي 👌</p> : (
            <ul className="space-y-2">
              {reviews.slice(0, 3).map((t) => (
                <li key={t.id}><Link href={`/portal/approvals${q}#t-${t.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3 hover:bg-warn/10">
                  <span className="min-w-0"><span className="block truncate font-semibold">{t.title}</span><span className="text-xs text-ink-500">راجع الشغل ووافق أو اطلب تعديل</span></span><Pill state="your_review" /></Link></li>))}
              {open.slice(0, 4).map((r) => (
                <li key={r.id}><Link href={`/portal/tasks${q}#r-${r.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 hover:bg-cream/60">
                  <span className="min-w-0"><span className="block truncate font-semibold">{r.title}</span><span className="text-xs text-ink-500">{r.due_date ? `مطلوب قبل ${fmtDate(r.due_date)}` : "من غير ميعاد"}</span></span><Pill state="open" /></Link></li>))}
            </ul>)}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="آخر التحديثات" right={<Link href={`/portal/project${q}`} className="text-sm font-semibold text-burgundy-700">كل التحديثات</Link>}>
          {!last ? <p className="text-sm text-ink-500">لسه مفيش تحديثات.</p> : (
            <ul className="space-y-4">
              {(j.updates as any[]).slice(0, 3).map((u) => (
                <li key={u.id} className="border-s-2 border-burgundy-200 ps-4">
                  <p className="font-semibold">{u.title}</p>
                  {u.body && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-ink-500">{u.body}</p>}
                  <p className="mt-1 text-xs text-ink-500">{u.by} · {fmtDateTime(u.at)}</p>
                </li>))}
            </ul>)}
        </Panel>
        <Panel title="مراحل المشروع" right={<Link href={`/portal/project${q}`} className="text-sm font-semibold text-burgundy-700">التفاصيل</Link>}>
          <Timeline stages={stages} compact />
        </Panel>
      </div>
      {j.account_manager && <p className="mt-6 text-center text-sm text-ink-500">مدير حسابك: <b className="text-charcoal">{j.account_manager}</b> · عندك سؤال؟ <Link href="/portal/support" className="font-semibold text-burgundy-700 underline">افتح طلب دعم</Link></p>}
    </>
  );
}
