import { requirePerm, requireSession } from "@/lib/auth";
import { auditList } from "@/server/data";
import { Empty, PageHeader, Pager, Table, td } from "@/components/ui";
import { inputCls } from "@/components/forms";
import { fmtDateTime } from "@/lib/format";
import { ENTITY } from "@/lib/labels";

export const metadata = { title: "سجل التدقيق" };
export const dynamic = "force-dynamic";

export default async function Audit({ searchParams }: { searchParams: Promise<{ entity?: string; actor?: string; page?: string }> }) {
  const s = await requireSession(); await requirePerm(s, "audit.view");
  const sp = await searchParams;
  const { rows, total, page } = await auditList(s.userId, { entity: sp.entity, actor: sp.actor, page: Number(sp.page) || 1 });
  const base = `/audit?${new URLSearchParams({ ...(sp.entity ? { entity: sp.entity } : {}), ...(sp.actor ? { actor: sp.actor } : {}) })}`;
  return (
    <>
      <PageHeader title="سجل التدقيق" sub="سجل لا يمكن تعديله أو حذفه. يُسجَّل فيه كل تغيير حساس." />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <select name="entity" defaultValue={sp.entity ?? ""} className={inputCls + " max-w-48"} aria-label="الكيان"><option value="">كل الكيانات</option>
          {Object.entries(ENTITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input name="actor" defaultValue={sp.actor} placeholder="اسم الموظف" className={inputCls + " max-w-56"} aria-label="الموظف" />
        <button className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-cream">تصفية</button>
      </form>
      {rows.length === 0 ? <Empty title="لا توجد سجلات مطابقة" /> : (
        <Table head={["الوقت", "الموظف", "الإجراء", "الكيان", "التفاصيل", "السبب"]}>
          {rows.map((a: any) => (
            <tr key={a.id}>
              <td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(a.at)}</td><td className={td}>{a.actor_name ?? "النظام"}</td>
              <td className={td}>{a.action === "INSERT" ? "إنشاء" : a.action === "UPDATE" ? "تعديل" : "حذف"}</td><td className={td}>{ENTITY[a.entity_type] ?? a.entity_type}</td>
              <td className={td}>
                <details><summary className="cursor-pointer text-xs text-burgundy-600">عرض القيم</summary>
                  <pre dir="ltr" className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-cream p-2 text-start text-xs">
                    {a.old_value ? `قبل: ${JSON.stringify(a.old_value, null, 1)}\n` : ""}{a.new_value ? `بعد: ${JSON.stringify(a.new_value, null, 1)}` : ""}</pre></details></td>
              <td className={td}>{a.reason ?? "—"}</td>
            </tr>))}
        </Table>)}
      <Pager base={base} page={page} total={total} />
    </>
  );
}
