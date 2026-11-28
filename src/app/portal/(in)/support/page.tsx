import Link from "next/link";
import { requirePortal } from "@/lib/portal-auth";
import { portalProjects, portalTickets } from "@/server/portal-data";
import { fmtDateTime } from "@/lib/format";
import { ActionForm } from "@/components/forms";
import { portalTicketAction } from "@/server/portal-actions";
import { PageTitle, Panel, Pill } from "@/components/portal/ui";

export const metadata = { title: "الدعم" };

export default async function PortalSupport() {
  const ps = await requirePortal();
  const [projects, tickets] = await Promise.all([portalProjects(ps.accountId), portalTickets(ps.accountId)]);
  return (
    <>
      <PageTitle title="الدعم" sub="عندك سؤال أو مشكلة؟ افتح طلب وهنرد عليك هنا، وهيوصلك إشعار." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <Panel title={`طلباتك (${tickets.length})`}>
          {tickets.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">مفيش طلبات دعم لسه.</p> : (
            <ul className="divide-y divide-line/70">
              {tickets.map((t: any) => (
                <li key={t.id}><Link href={`/portal/support/${t.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-cream/40">
                  <span className="min-w-0"><span className="block truncate font-semibold">{t.subject}</span><span className="text-xs text-ink-500">{projects.length > 1 ? `${t.project} · ` : ""}{t.messages} رسالة · آخر نشاط {fmtDateTime(t.last_activity_at)}</span></span>
                  <Pill state={t.status} /></Link></li>))}
            </ul>)}
        </Panel>
        <Panel title="طلب جديد">
          {projects.length === 0 ? <p className="text-sm text-ink-500">مفيش مشروع مفتوح.</p> : (
            <ActionForm action={portalTicketAction} submit="ابعت الطلب" className="space-y-3">
              {projects.length === 1 ? <input type="hidden" name="ops_id" value={projects[0].ops_id} /> : (
                <label className="block text-sm font-medium">المشروع
                  <select name="ops_id" required className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2">{projects.map((p) => <option key={p.ops_id} value={p.ops_id}>{p.title}</option>)}</select></label>)}
              <label className="block text-sm font-medium">العنوان<input name="subject" required maxLength={160} placeholder="مثال: عاوز أغير صورة البنر" className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[15px] font-normal placeholder:text-ink-300 focus:border-burgundy-600" /></label>
              <label className="block text-sm font-medium">التفاصيل<textarea name="body" required rows={5} maxLength={4000} className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[15px] font-normal focus:border-burgundy-600" /></label>
              <label className="block text-sm font-medium">ملف (اختياري)<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx" className="mt-1 w-full rounded-xl border border-dashed border-line bg-cream/40 px-3 py-2 text-sm font-normal file:me-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-1" /></label>
            </ActionForm>)}
        </Panel>
      </div>
    </>
  );
}
