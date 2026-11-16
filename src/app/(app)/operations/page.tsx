import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { opsAccountManagers, opsList, type OpsRow } from "@/server/data";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { ActionForm, Hidden, SelectField, TextArea } from "@/components/forms";
import { assignOpsAction } from "@/server/actions";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const metadata = { title: "العملاء المعتمدين" };
export const dynamic = "force-dynamic";

export default async function Operations({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession();
  if (!can(s, "ops.view")) notFound();
  const assigner = can(s, "ops.assign");
  const sp = await searchParams;
  const tab = assigner ? (sp.tab === "assigned" ? "assigned" : "new") : null;
  const [rows, ams, waiting] = await Promise.all([
    opsList(s.userId, tab), assigner ? opsAccountManagers(s.userId) : Promise.resolve([]),
    assigner ? opsList(s.userId, "new") : Promise.resolve([] as OpsRow[])]);
  const tabCls = (on: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${on ? "bg-burgundy-600 text-white" : "border border-line bg-white hover:bg-cream"}`;
  return (
    <>
      <PageHeader title={assigner ? "العملاء المعتمدين ماليًا" : "عملائي"}
        sub={assigner ? "كل عميل المالية اعتمدته بيوصل هنا. حوّله لأكاونت مانجر يستلمه." : "العملاء اللي المدير التقني حوّلهم ليك."} />
      {assigner && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Link href="/operations" className={tabCls(tab === "new")}>مستني تحويل ({waiting.length})</Link>
          <Link href="/operations?tab=assigned" className={tabCls(tab === "assigned")}>اتحوّل لأكاونت مانجر</Link>
        </div>)}
      {assigner && ams.length === 0 && (
        <div className="mb-5 rounded-md border border-warn/40 bg-warn/5 px-4 py-3 text-sm">مفيش أكاونت مانجر عنده حساب شغّال لسه. مدير النظام يضيفهم من «الموظفون» بدور «أكاونت مانجر».</div>)}
      {rows.length === 0 ? (
        <Empty title={tab === "new" ? "مفيش عملاء مستنيين تحويل" : assigner ? "مفيش عملاء اتحوّلوا لسه" : "مفيش عملاء مسندين ليك لسه"}
          hint={tab === "new" ? "أول ما المالية تعتمد عقد، العميل هيظهر هنا." : undefined} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => <ClientCard key={r.id} r={r} ams={ams} assigner={assigner} />)}
        </div>)}
    </>
  );
}

function ClientCard({ r, ams, assigner }: { r: OpsRow; ams: { id: string; full_name: string; clients: number }[]; assigner: boolean }) {
  const row = (k: string, v: ReactNode) => (<div className="flex justify-between gap-3"><dt className="shrink-0 text-ink-500">{k}</dt><dd className="min-w-0 break-words text-end" dir="auto">{v || "—"}</dd></div>);
  return (
    <section className="min-w-0 rounded-lg border border-line bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-lg font-bold"><Link href={`/operations/${r.id}`} className="underline decoration-burgundy-600/40 hover:text-burgundy-700">{r.client_name}</Link></h2>{r.business_name && <p className="text-sm text-ink-500">{r.business_name}</p>}</div>
        {r.status === "new" ? <Badge tone="warn">مستني تحويل</Badge> : <Badge tone="ok">مع {r.account_manager_name}</Badge>}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">{r.packages.map((p) => <span key={p} className="rounded-md border border-burgundy-600/30 bg-burgundy-600/5 px-2 py-0.5 text-xs font-medium">✓ {p}</span>)}</div>
      <dl className="space-y-1.5 text-sm">
        {row("رقم الجوال", r.phone ? <a href={`tel:${r.phone}`} dir="ltr" className="underline">{r.phone}</a> : null)}
        {row("المتجر", r.store_url ? <a href={/^https?:/.test(r.store_url) ? r.store_url : `https://${r.store_url}`} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all underline">{r.store_url}</a> : null)}
        {row("مدة التعاقد", r.start_date ? `${fmtDate(r.start_date)} ← ${r.end_date ? fmtDate(r.end_date) : "—"}${r.duration_months ? ` (${r.duration_months} شهر)` : ""}` : null)}
        {row("السيلز", r.sales_name)}
        {row("اعتمدته المالية", r.approved_at ? fmtDateTime(r.approved_at) : null)}
        {r.contract_notes && row("ملاحظات العقد", r.contract_notes)}
        {r.status === "assigned" && row("اتحوّل", `${r.assigned_by_name ?? ""} · ${r.assigned_at ? fmtDateTime(r.assigned_at) : ""}`)}
        {r.assign_note && row("ملاحظة التحويل", r.assign_note)}
      </dl>
      <div className="mt-4"><Link href={`/operations/${r.id}`} className="inline-flex rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700">ملف العميل والتاسكات</Link></div>
      {assigner && ams.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <ActionForm action={assignOpsAction} submit={r.status === "new" ? "تحويل للأكاونت مانجر" : "تغيير الأكاونت مانجر"} tone="quiet">
            <Hidden name="ops_id" value={r.id} />
            <SelectField label="الأكاونت مانجر" name="account_manager" required empty="اختار" options={ams.filter((a) => a.id !== r.account_manager_id).map((a) => ({ value: a.id, label: `${a.full_name} (${a.clients} عميل)` }))} />
            <TextArea label="ملاحظة للأكاونت (اختياري)" name="note" rows={2} />
          </ActionForm>
        </div>)}
    </section>
  );
}
