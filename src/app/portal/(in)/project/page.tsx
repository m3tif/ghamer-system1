import { requirePortal } from "@/lib/portal-auth";
import { pickProject } from "@/server/portal-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Bar, NoProject, PageTitle, Panel, ProjectSwitch, Thread, Timeline } from "@/components/portal/ui";

export const metadata = { title: "مشروعي" };

export default async function PortalProject({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ps = await requirePortal();
  const { list, cur, project: j } = await pickProject(ps.accountId, (await searchParams).p);
  if (!cur || !j) return <NoProject />;
  const stages = j.stages as any[];
  const done = stages.filter((s) => s.status === "done").length;
  return (
    <>
      <ProjectSwitch list={list} cur={cur.ops_id} base="/portal/project" />
      <PageTitle title={j.title} sub={(j.services as string[]).join(" · ") || undefined} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel>
            <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-semibold">نسبة الإنجاز</span><span className="text-2xl font-extrabold tabular-nums">{j.progress}%</span></div>
            <Bar value={j.progress} />
            <p className="mt-2 text-xs text-ink-500">{done} من {stages.length} مراحل خلصت</p>
            <dl className="mt-4 space-y-2 border-t border-line/70 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500">بداية المشروع</dt><dd className="font-semibold">{fmtDate(j.start_date)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">التسليم المتوقع</dt><dd className="font-semibold">{fmtDate(j.expected_end)}</dd></div>
              {j.account_manager && <div className="flex justify-between"><dt className="text-ink-500">مدير حسابك</dt><dd className="font-semibold">{j.account_manager}</dd></div>}
            </dl>
          </Panel>
          <Panel title="مراحل المشروع"><Timeline stages={stages} /></Panel>
        </div>
        <Panel title={`سجل التحديثات (${j.updates.length})`}>
          {j.updates.length === 0 ? <p className="text-sm text-ink-500">لسه مفيش تحديثات. أول ما الفريق ينشر تحديث هيظهر هنا وهيوصلك إشعار.</p> : (
            <ol className="space-y-6">
              {(j.updates as any[]).map((u) => (
                <li key={u.id} id={`u-${u.id}`} className="scroll-mt-28">
                  <div className="flex items-start gap-3">
                    <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${u.auto ? "bg-ink-300" : "bg-burgundy-600"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{u.title}</p>
                      {u.body && <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-charcoal/90">{u.body}</p>}
                      <p className="mt-1 text-xs text-ink-500">{u.by} · {fmtDateTime(u.at)}{u.stage ? ` · ${u.stage}` : ""}</p>
                      {!u.auto && <div className="mt-3"><Thread kind="update" id={u.id} messages={u.messages} placeholder="علّق على التحديث ده…" /></div>}
                    </div>
                  </div>
                </li>))}
            </ol>)}
        </Panel>
      </div>
    </>
  );
}
