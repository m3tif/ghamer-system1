import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePortal } from "@/lib/portal-auth";
import { portalTicket } from "@/server/portal-data";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, Hidden } from "@/components/forms";
import { portalTicketCloseAction } from "@/server/portal-actions";
import { Files, PageTitle, Panel, Pill, Thread, Upload } from "@/components/portal/ui";

export const metadata = { title: "طلب دعم" };

export default async function PortalTicket({ params }: { params: Promise<{ id: string }> }) {
  const ps = await requirePortal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await portalTicket(ps.accountId, id);
  if (!t) notFound();
  const open = t.status !== "closed";
  return (
    <>
      <Link href="/portal/support" className="mb-3 inline-block text-sm text-ink-500 hover:text-charcoal">→ كل الطلبات</Link>
      <PageTitle title={t.subject} sub={`اتفتح ${fmtDateTime(t.created_at)}`} right={<Pill state={t.status} />} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <Panel title="المحادثة">
          <Thread kind="ticket" id={t.id} messages={t.messages} canWrite={open} placeholder="اكتب ردك…" />
          {!open && <p className="mt-4 rounded-xl bg-cream p-3 text-center text-sm text-ink-500">الطلب ده اتقفل {fmtDateTime(t.closed_at)}. لو محتاج حاجة تانية افتح طلب جديد.</p>}
        </Panel>
        <div className="space-y-5">
          <Panel title="ملفات الطلب">
            <Files files={t.files} empty="مفيش ملفات." />
            {open && <div className="mt-3"><Upload ops={t.ops_id} kind="ticket" thread={t.id} label="رفع" /></div>}
          </Panel>
          {open && (
            <Panel>
              <p className="mb-3 text-sm text-ink-500">اتحلت؟ اقفل الطلب.</p>
              <ActionForm action={portalTicketCloseAction} submit="اتحلت، اقفل الطلب" tone="quiet"><Hidden name="ticket_id" value={t.id} /></ActionForm>
            </Panel>)}
        </div>
      </div>
    </>
  );
}
