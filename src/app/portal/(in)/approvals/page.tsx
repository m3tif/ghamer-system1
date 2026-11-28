import { requirePortal } from "@/lib/portal-auth";
import { pickProject } from "@/server/portal-data";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, Hidden } from "@/components/forms";
import { portalDecideAction } from "@/server/portal-actions";
import { Files, NoProject, PageTitle, Panel, Pill, ProjectSwitch, Thread } from "@/components/portal/ui";

export const metadata = { title: "المراجعة والموافقات" };

export default async function PortalApprovals({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ps = await requirePortal();
  const { list, cur, project: j } = await pickProject(ps.accountId, (await searchParams).p);
  if (!cur || !j) return <NoProject />;
  const all = j.tasks as any[];
  const waiting = all.filter((t) => t.needs_you), past = all.filter((t) => !t.needs_you && (t.decided_at || t.messages.length));
  return (
    <>
      <ProjectSwitch list={list} cur={cur.ops_id} base="/portal/approvals" />
      <PageTitle title="المراجعة والموافقات" sub="الشغل اللي الفريق خلّصه ومستني رأيك. وافق، أو اطلب تعديل واكتب المطلوب." />
      {waiting.length === 0 && <Panel><p className="py-8 text-center text-ink-500">مفيش شغل مستني موافقتك دلوقتي 👌 أول ما يجهز حاجة هيوصلك إشعار.</p></Panel>}
      <div className="space-y-5">
        {waiting.map((t) => (
          <Panel key={t.id} id={`t-${t.id}`} className="scroll-mt-28 border-warn/40" title={t.title} right={<Pill state="your_review" />}>
            {t.note && <p className="mb-3 whitespace-pre-wrap text-sm leading-7">{t.note}</p>}
            {t.link && <a href={t.link} target="_blank" rel="noopener noreferrer" className="mb-3 inline-flex items-center gap-2 rounded-xl bg-charcoal px-4 py-2.5 text-sm font-semibold text-white hover:bg-black">افتح الشغل ↗</a>}
            {t.files.length > 0 && <div className="mb-3"><Files files={t.files} /></div>}
            {t.messages.length > 0 && <div className="mb-4"><Thread kind="task" id={t.id} messages={t.messages} canWrite={false} /></div>}
            <div className="grid gap-3 border-t border-line/70 pt-4 md:grid-cols-2">
              <ActionForm action={portalDecideAction} submit="موافق ✓" className="space-y-2 rounded-xl bg-ok/5 p-3">
                <Hidden name="task_id" value={t.id} /><Hidden name="decision" value="ok" />
                <textarea name="note" rows={2} maxLength={2000} placeholder="كلمة للفريق (اختياري)" aria-label="ملاحظة مع الموافقة" className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[15px] placeholder:text-ink-300 focus:border-burgundy-600" />
              </ActionForm>
              <ActionForm action={portalDecideAction} submit="اطلب تعديل" tone="quiet" className="space-y-2 rounded-xl bg-cream/60 p-3">
                <Hidden name="task_id" value={t.id} /><Hidden name="decision" value="changes" />
                <textarea name="note" rows={2} required maxLength={2000} placeholder="اكتب التعديل المطلوب بالتفصيل" aria-label="التعديل المطلوب" className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[15px] placeholder:text-ink-300 focus:border-burgundy-600" />
              </ActionForm>
            </div>
          </Panel>))}
      </div>
      {past.length > 0 && (
        <Panel title="اللي راجعته قبل كده" className="mt-6">
          <ul className="divide-y divide-line/70">
            {past.map((t) => (
              <li key={t.id} id={`t-${t.id}`} className="py-3">
                <div className="flex items-center justify-between gap-3"><span className="font-semibold">{t.title}</span><Pill state={t.state} /></div>
                {t.decided_at && <p className="text-xs text-ink-500">ردك اتسجل {fmtDateTime(t.decided_at)}</p>}
                {t.messages.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-500">المحادثة ({t.messages.length})</summary><div className="mt-2"><Thread kind="task" id={t.id} messages={t.messages} /></div></details>}
              </li>))}
          </ul>
        </Panel>)}
    </>
  );
}
