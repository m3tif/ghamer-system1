import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { distBreakdown, distCandidates, distGet, distRows } from "@/server/data";
import { cancelDistributionAction, remapDistributionAction, skipDistributionRowAction } from "@/server/actions";
import { Badge, ButtonLink, Card, Empty, PageHeader, Pager, Stat, Table, td } from "@/components/ui";
import { ActionForm, Hidden } from "@/components/forms";
import { DistributionPanel } from "@/components/distribution-client";
import { FIELDS } from "@/lib/import-parse";
import { fmtDateTime } from "@/lib/format";
import { IMPORT_STATUS as ST } from "@/lib/import-labels";

export const metadata = { title: "عملية توزيع" };
export const dynamic = "force-dynamic";
const ROW_ST: Record<string, [string, "neutral" | "ok" | "warn" | "bad"]> = {
  new: ["جديد", "ok"], duplicate: ["مكرر (مستبعد)", "warn"], invalid: ["غير صالح (مستبعد)", "bad"], review: ["للمراجعة (مستبعد)", "warn"], imported: ["تم توزيعه", "ok"], skipped: ["استبعدته", "neutral"], error: ["خطأ", "bad"],
};
const TABS: [string, string][] = [["", "الكل"], ["new", "جديد"], ["duplicate", "مكرر"], ["review", "للمراجعة"], ["invalid", "غير صالح"], ["imported", "تم توزيعه"], ["skipped", "مستبعد"]];

export default async function DistributionBatch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ st?: string; page?: string }> }) {
  const s = await requireSession();
  if (!can(s, "leads.bulk_distribute")) notFound();
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await distGet(s.userId, id); if (!b) notFound();
  const st = TABS.some((t) => t[0] === (sp.st ?? "")) ? (sp.st ?? "") : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const staged = b.status === "staged", [lbl, tone] = ST[b.status] ?? [b.status, "neutral" as const];
  const [{ rows, total }, cands, split] = await Promise.all([distRows(s.userId, id, st || null, page), staged ? distCandidates(s.userId) : [], !staged ? distBreakdown(s.userId, id) : []]);
  const headers: string[] = b.mapping?.headers ?? [];
  const base = `/bulk-distribution/${id}${st ? `?st=${st}` : ""}`;
  return (
    <>
      <PageHeader title={b.file_name} sub={`نفّذها: ${b.imported_by_name} · ${fmtDateTime(b.finished_at ?? b.created_at)}`} actions={<span className="flex items-center gap-2"><Badge tone={tone}>{lbl}</Badge><ButtonLink href="/bulk-distribution">كل العمليات</ButtonLink></span>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="إجمالي الصفوف" value={b.rows_total} /><Stat label={staged ? "جديد (سيُوزَّع)" : "تم توزيعه"} value={staged ? b.c_new : b.c_imported} tone="ok" />
        <Stat label="مكرر (مستبعد)" value={b.c_duplicate} /><Stat label="غير صالح" value={b.c_invalid} tone={b.c_invalid ? "bad" : undefined} /><Stat label="للمراجعة (مستبعد)" value={b.c_review} />
      </div>
      {staged && (
        <div className="mb-6 grid gap-4 xl:grid-cols-2">
          <Card title="الخطوة 1 — ربط الأعمدة">
            <ActionForm action={remapDistributionAction} submit="تطبيق الربط وإعادة الفحص" tone="quiet" className="grid gap-3 sm:grid-cols-2">
              <Hidden name="id" value={id} />
              {FIELDS.filter((f) => !["alt_phone", "business_name", "source"].includes(f.key) || b.mapping?.[f.key]).map((f) => (
                <label key={f.key} className="block"><span className="mb-1 block text-sm font-medium">{f.label}{f.key === "phone" && <b className="text-burgundy-600"> *</b>}</span>
                  <select name={`map_${f.key}`} defaultValue={b.mapping?.[f.key] ?? ""} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"><option value="">— غير موجود —</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></label>))}
            </ActionForm>
          </Card>
          <Card title="الخطوة 2 — الموظفون والمعاينة والتأكيد">
            <DistributionPanel id={id} candidates={cands} initial={{ c_new: b.c_new, c_duplicate: b.c_duplicate, c_invalid: b.c_invalid, c_review: b.c_review, rows_total: b.rows_total }} />
            <form action={cancelDistributionAction} className="mt-4"><input type="hidden" name="id" value={id} /><button className="text-sm text-ink-500 underline">إلغاء هذه العملية</button></form>
          </Card>
        </div>)}
      {!staged && split.length > 0 && (
        <div className="mb-6 max-w-xl"><Card title="توزيع العملاء على الموظفين">
          <Table head={["الموظف", "عدد العملاء"]}>{split.map((x: any) => <tr key={x.employee_id}><td className={td}>{x.employee_name}</td><td className={td + " tabular-nums font-semibold"}>{x.assigned}</td></tr>)}</Table></Card></div>)}
      {b.source_url && <p className="mb-3 text-xs text-ink-500" dir="ltr">المصدر: {b.source_url}</p>}
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="تصفية الصفوف">
        {TABS.map(([k, l]) => <Link key={k} href={`/bulk-distribution/${id}${k ? `?st=${k}` : ""}`} className={`rounded-md px-3 py-1.5 text-sm ${st === k ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>{l}</Link>)}
      </nav>
      {rows.length === 0 ? <Empty title="لا توجد صفوف" /> : (
        <Table head={["#", "الاسم", "الهاتف", "Hunter", "تاريخ الـ Hunt", "الحالة", "السبب", ...(staged ? ["إجراء"] : [])]}>
          {rows.map((r) => { const [l, t] = ROW_ST[r.status] ?? [r.status, "neutral" as const]; return (
            <tr key={r.id}><td className={td + " tabular-nums"}>{r.row_no}</td><td className={td}>{r.name ?? <span className="text-ink-500">بدون اسم</span>}</td>
              <td className={td} dir="ltr"><div>{r.phone_raw || "—"}</div>{r.phone_e164 && r.phone_e164 !== r.phone_raw && <div className="text-xs text-ink-500">{r.phone_e164}</div>}</td>
              <td className={td}>{r.hunter ?? "—"}</td><td className={td}>{r.original_added ? String(r.original_added).slice(0, 10) : "—"}</td>
              <td className={td}><Badge tone={t}>{l}</Badge></td>
              <td className={td + " text-xs leading-5"}>{r.reason}{r.existing_owner_name && <> — لدى <b>{r.existing_owner_name}</b></>}</td>
              {staged && <td className={td}>
                {["new", "review", "invalid"].includes(r.status) && <ActionForm action={skipDistributionRowAction} submit="استبعاد" tone="quiet" className="inline"><Hidden name="id" value={id} /><Hidden name="row" value={String(r.id)} /></ActionForm>}
                {r.status === "skipped" && <ActionForm action={skipDistributionRowAction} submit="إرجاع" tone="quiet" className="inline"><Hidden name="id" value={id} /><Hidden name="row" value={String(r.id)} /><Hidden name="skip" value="0" /></ActionForm>}
              </td>}</tr>); })}
        </Table>)}
      <Pager base={base} page={page} total={total} size={50} />
    </>
  );
}
