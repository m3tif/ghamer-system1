import { requirePortal } from "@/lib/portal-auth";
import { pickProject } from "@/server/portal-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ActionForm, Hidden } from "@/components/forms";
import { portalRespondAction } from "@/server/portal-actions";
import { Files, NoProject, PageTitle, Panel, Pill, ProjectSwitch, Thread } from "@/components/portal/ui";

export const metadata = { title: "المهام" };

export default async function PortalTasks({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ps = await requirePortal();
  const { list, cur, project: j } = await pickProject(ps.accountId, (await searchParams).p);
  if (!cur || !j) return <NoProject />;
  const reqs = j.requests as any[], team = j.tasks as any[];
  const mine = reqs.filter((r) => r.status !== "done"), closed = reqs.filter((r) => r.status === "done");
  return (
    <>
      <ProjectSwitch list={list} cur={cur.ops_id} base="/portal/tasks" />
      <PageTitle title="المهام" sub="اللي مطلوب منك، واللي الفريق شغال عليه في مشروعك." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`مطلوب منك (${mine.length})`}>
          {mine.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">مفيش حاجة مطلوبة منك دلوقتي 👌</p> : (
            <ul className="space-y-4">
              {mine.map((r) => (
                <li key={r.id} id={`r-${r.id}`} className="scroll-mt-28 rounded-xl border border-line p-4">
                  <div className="flex items-start justify-between gap-3"><p className="font-semibold">{r.title}</p><Pill state={r.status} /></div>
                  {r.description && <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-ink-500">{r.description}</p>}
                  <p className="mt-1 text-xs text-ink-500">{r.due_date ? `مطلوب قبل ${fmtDate(r.due_date)}` : "من غير ميعاد محدد"}</p>
                  {r.return_note && <p className="mt-3 rounded-lg bg-warn/10 p-3 text-sm text-warn">الفريق محتاج: {r.return_note}</p>}
                  {r.response && <p className="mt-3 rounded-lg bg-cream p-3 text-sm"><span className="text-xs text-ink-500">ردك · {fmtDateTime(r.responded_at)}</span><span className="mt-1 block whitespace-pre-wrap">{r.response}</span></p>}
                  {r.files.length > 0 && <div className="mt-2"><Files files={r.files} /></div>}
                  {r.status === "open" && (
                    <div className="mt-3 border-t border-line/70 pt-3">
                      <ActionForm action={portalRespondAction} submit="ابعت ردك" className="space-y-2">
                        <Hidden name="request_id" value={r.id} /><Hidden name="ops_id" value={cur.ops_id} />
                        <textarea name="text" rows={2} maxLength={4000} placeholder="اكتب ردك، أو حط رابط…" aria-label="ردك" className="w-full rounded-xl border border-line px-3 py-2 text-[15px] placeholder:text-ink-300 focus:border-burgundy-600" />
                        <input name="file" type="file" aria-label="ملف (اختياري)" accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx" className="w-full rounded-xl border border-dashed border-line bg-cream/40 px-3 py-2 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-1 file:text-sm" />
                      </ActionForm>
                    </div>)}
                  {r.messages.length > 0 && <div className="mt-3"><Thread kind="request" id={r.id} messages={r.messages} canWrite={false} /></div>}
                </li>))}
            </ul>)}
          {closed.length > 0 && (
            <details className="mt-4 text-sm"><summary className="cursor-pointer text-ink-500">اللي خلص ({closed.length})</summary>
              <ul className="mt-2 divide-y divide-line/70">{closed.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span>{r.title}</span><span className="text-xs text-ok">استلمناه ✓ {fmtDate(r.closed_at)}</span></li>)}</ul></details>)}
        </Panel>
        <Panel title={`شغل الفريق (${team.length})`}>
          {team.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">لما الفريق يبدأ شغل يخصك هيظهر هنا.</p> : (
            <ul className="divide-y divide-line/70">
              {team.map((t) => (
                <li key={t.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-semibold">{t.title}</p><p className="text-xs text-ink-500">{[t.stage, t.due_date ? `التسليم ${fmtDate(t.due_date)}` : null].filter(Boolean).join(" · ") || " "}</p></div>
                    <Pill state={t.state} />
                  </div>
                  {t.note && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-500">{t.note}</p>}
                </li>))}
            </ul>)}
        </Panel>
      </div>
    </>
  );
}
