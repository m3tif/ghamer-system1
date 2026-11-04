import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { importBatch, importRows } from "@/server/data";
import { cancelImportAction, fixImportRowAction, remapImportAction, rollbackImportAction, skipImportRowAction, updateExistingAction } from "@/server/actions";
import { Badge, ButtonLink, Card, Empty, PageHeader, Pager, Stat, Table, td } from "@/components/ui";
import { ActionForm, Field, Hidden } from "@/components/forms";
import { PhoneField } from "@/components/phone-field";
import { RunImport } from "@/components/import-client";
import { FIELDS } from "@/lib/import-parse";
import { fmtDateTime } from "@/lib/format";
import { IMPORT_STATUS as ST } from "@/lib/import-labels";

export const metadata = { title: "عملية استيراد" };
export const dynamic = "force-dynamic";
const ROW_ST: Record<string, [string, "neutral" | "ok" | "warn" | "bad"]> = {
  new: ["جديد", "ok"], duplicate: ["مكرر", "warn"], invalid: ["غير صالح", "bad"], review: ["يحتاج مراجعة", "warn"], imported: ["تم", "ok"], skipped: ["تخطّي", "neutral"],
  updated: ["تم تحديث الموجود", "ok"], error: ["خطأ", "bad"], rolled_back: ["تم التراجع", "neutral"],
};
const TABS: [string, string][] = [["", "الكل"], ["new", "جديد"], ["duplicate", "مكرر"], ["review", "للمراجعة"], ["invalid", "غير صالح"], ["imported", "تم"], ["error", "أخطاء"], ["skipped", "متخطّى"]];

export default async function ImportBatch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ st?: string; page?: string }> }) {
  const s = await requireSession();
  if (!can(s, "import.own") && !can(s, "import.any")) notFound();
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await importBatch(s.userId, id); if (!b) notFound();
  const st = TABS.some((t) => t[0] === (sp.st ?? "")) ? (sp.st ?? "") : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await importRows(s.userId, id, st || null, page);
  const any = can(s, "import.any"), staged = b.status === "staged", [lbl, tone] = ST[b.status] ?? [b.status, "neutral" as const];
  const headers: string[] = b.mapping?.headers ?? [];
  const fixable = b.c_review + b.c_invalid;
  const base = `/import/${id}${st ? `?st=${st}` : ""}`;
  return (
    <>
      <PageHeader title={b.file_name} sub={`صاحب البيانات: ${b.data_owner_name} · الموظف الأصلي في الملف: ${b.original_employee_name ?? "—"} · استورده: ${b.imported_by_name} · ${fmtDateTime(b.created_at)}`}
        actions={<span className="flex items-center gap-2"><Badge tone={tone}>{lbl}</Badge><ButtonLink href="/import">كل العمليات</ButtonLink></span>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="import-summary">
        <Stat label="إجمالي الصفوف" value={b.rows_total} /><Stat label="جديد (سيُستورد)" value={b.c_new} tone="ok" /><Stat label="مكرر بالرقم" value={b.c_duplicate} />
        <Stat label="غير صالح" value={b.c_invalid} tone={b.c_invalid ? "bad" : undefined} /><Stat label="يحتاج مراجعة" value={b.c_review} /><Stat label="قابل للإصلاح" value={fixable} sub="مراجعة + غير صالح" />
        <Stat label="تم استيراده" value={b.c_imported} tone="ok" /><Stat label="أخطاء تنفيذ" value={b.c_error} tone={b.c_error ? "bad" : undefined} />
      </div>

      {staged && (
        <div className="mb-6 grid gap-4 xl:grid-cols-2">
          <Card title="الخطوة 1 — ربط الأعمدة">
            <ActionForm action={remapImportAction} submit="تطبيق الربط وإعادة الفحص" tone="quiet" className="grid gap-3 sm:grid-cols-2">
              <Hidden name="id" value={id} />
              {FIELDS.filter((f) => !f.distOnly).map((f) => (
                <label key={f.key} className="block"><span className="mb-1 block text-sm font-medium">{f.label}{f.required && <b className="text-burgundy-600"> *</b>}</span>
                  <select name={`map_${f.key}`} defaultValue={b.mapping?.[f.key] ?? ""} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"><option value="">— غير موجود —</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select>
                  <span className="text-xs text-ink-500">{f.hint}</span></label>))}
            </ActionForm>
          </Card>
          <Card title="الخطوة 2 — تأكيد الاستيراد">
            <ul className="mb-4 list-disc space-y-1 ps-5 text-sm leading-6">
              <li><b>{b.c_new}</b> عميل جديد سيُضاف باسم <b>{b.data_owner_name}</b>{b.original_employee_name ? <> (الاسم الأصلي في الملف: {b.original_employee_name})</> : null}.</li>
              <li><b>{b.c_duplicate}</b> صف مكرر بالرقم <b>لن يُضاف</b> ولن يُستبدل الموجود.</li>
              <li><b>{fixable}</b> صف ناقص/مشكوك فيه <b>لن يُستورد</b> حتى تصلحه أو تتخطاه.</li>
            </ul>
            <RunImport id={id} total={b.rows_total} newCount={b.c_new} />
            <form action={cancelImportAction} className="mt-4"><input type="hidden" name="id" value={id} /><button className="text-sm text-ink-500 underline">إلغاء هذه العملية</button></form>
          </Card>
        </div>)}

      {b.status === "importing" && <Card title="الاستيراد لم يكتمل"><RunImport id={id} total={b.rows_total} newCount={b.c_new} /></Card>}

      {!staged && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <ButtonLink href={`/api/import/${id}/report?kind=issues`}>تنزيل تقرير المكرر والأخطاء (CSV)</ButtonLink>
          <ButtonLink href={`/api/import/${id}/report?kind=all`}>تقرير كامل (CSV)</ButtonLink>
          {b.rollback_note && <span className="text-sm text-ink-500">{b.rollback_note}</span>}
        </div>)}
      {staged && <div className="mb-3"><ButtonLink href={`/api/import/${id}/report?kind=issues`}>تنزيل تقرير المكرر والأخطاء (CSV)</ButtonLink></div>}

      <nav className="mb-3 flex flex-wrap gap-2" aria-label="تصفية الصفوف">
        {TABS.map(([k, l]) => <Link key={k} href={`/import/${id}${k ? `?st=${k}` : ""}`} className={`rounded-md px-3 py-1.5 text-sm ${st === k ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`}>{l}</Link>)}
      </nav>
      {rows.length === 0 ? <Empty title="لا توجد صفوف" /> : (
        <Table head={["#", "الاسم", "الهاتف", "التاريخ الأصلي", "الحالة", "السبب / الاختلافات", ...(staged ? ["إجراء"] : [])]}>
          {rows.map((r) => { const [l, t] = ROW_ST[r.status] ?? [r.status, "neutral" as const]; return (
            <tr key={r.id}>
              <td className={td + " tabular-nums"}>{r.row_no}</td><td className={td}>{r.name ?? <span className="text-bad">—</span>}{r.business_name && <div className="text-xs text-ink-500">{r.business_name}</div>}</td>
              <td className={td} dir="ltr"><div>{r.phone_raw || "—"}</div>{r.phone_e164 && r.phone_e164 !== r.phone_raw && <div className="text-xs text-ink-500">{r.phone_e164}</div>}</td>
              <td className={td}>{r.original_added ? String(r.original_added).slice(0, 10) : r.date_text ? <span className="text-warn">غير مفهوم: {r.date_text}</span> : <span className="text-ink-500">غير معروف</span>}</td>
              <td className={td}><Badge tone={t}>{l}</Badge></td>
              <td className={td + " text-xs leading-5"}>{r.reason}{r.existing_owner_name && <> — لدى <b>{r.existing_owner_name}</b></>}{r.error && <div className="text-bad">{r.error}</div>}
                {r.diff && Object.entries(r.diff as Record<string, { existing: string | null; file: string }>).map(([k, d]) => <div key={k}>• {({ name: "الاسم", business_name: "النشاط", store: "المتجر" } as Record<string, string>)[k] ?? k}: الموجود «{d.existing ?? "—"}» ← الملف «{d.file}»</div>)}</td>
              {staged && (
                <td className={td}><div className="flex flex-col gap-1.5">
                  {["invalid", "review", "duplicate", "new"].includes(r.status) && (
                    <details><summary className="cursor-pointer text-xs text-burgundy-600">تعديل</summary>
                      <ActionForm action={fixImportRowAction} submit="حفظ وإعادة الفحص" tone="quiet" className="mt-2 w-64 space-y-2">
                        <Hidden name="id" value={id} /><Hidden name="row" value={String(r.id)} />
                        <Field label="الاسم" name="name" defaultValue={r.name ?? ""} />
                        <label className="block text-sm font-medium">الهاتف<PhoneField name="phone" defaultValue={r.phone_raw ?? ""} /></label>
                      </ActionForm></details>)}
                  {r.status === "duplicate" && any && r.existing_owner_name !== null && (
                    <ActionForm action={updateExistingAction} submit="ملء الفراغات في الموجود" tone="quiet" className="inline"><Hidden name="id" value={id} /><Hidden name="row" value={String(r.id)} /></ActionForm>)}
                  {["invalid", "review", "duplicate", "new"].includes(r.status) && <ActionForm action={skipImportRowAction} submit="تخطّي" tone="quiet" className="inline"><Hidden name="id" value={id} /><Hidden name="row" value={String(r.id)} /></ActionForm>}
                  {r.status === "skipped" && <ActionForm action={skipImportRowAction} submit="إرجاع" tone="quiet" className="inline"><Hidden name="id" value={id} /><Hidden name="row" value={String(r.id)} /><Hidden name="skip" value="0" /></ActionForm>}
                </div></td>)}
            </tr>); })}
        </Table>)}
      <Pager base={base} page={page} total={total} size={50} />

      {(b.status === "completed" || b.status === "importing") && (
        <div className="mt-8 max-w-xl"><Card title="التراجع عن هذه العملية">
          <p className="mb-3 text-sm text-ink-500">يُخفي العملاء المستوردين الذين لم يلمسهم أحد بعد الاستيراد ويحرّر أرقامهم. من عُدّل بعد الاستيراد (حالة، ملاحظة، تحويل، اجتماع…) يبقى كما هو. لا يُحذف أي سجل.</p>
          <ActionForm action={rollbackImportAction} submit="تراجع" className="space-y-3">
            <Hidden name="id" value={id} /><Field label="السبب" name="reason" required />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" value="1" /> أؤكد التراجع عن هذه العملية</label>
          </ActionForm></Card></div>)}
    </>
  );
}
