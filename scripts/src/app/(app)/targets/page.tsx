import { can, requirePerm, requireSession } from "@/lib/auth";
import { employeeList, listTargets, salesStats, teleStats } from "@/server/data";
import { Card, Empty, PageHeader, Progress, Table, td } from "@/components/ui";
import { ActionForm, Field, SelectField } from "@/components/forms";
import { setTargetAction } from "@/server/actions";
import { fmtNum, monthStart } from "@/lib/format";
import { METRIC } from "@/lib/labels";

export const metadata = { title: "التارجت" };
export const dynamic = "force-dynamic";

export default async function Targets() {
  const s = await requireSession(); await requirePerm(s, "targets.view");
  const month = monthStart();
  const emps: any[] = (await employeeList(s.userId)).filter((e) => e.is_active && ["tele_sales", "sales_rep"].includes(e.role_code));
  const targets = await listTargets(s.userId, month);
  const rows = await Promise.all(emps.map(async (e) => {
    const tele = e.role_code === "tele_sales";
    const st = tele ? await teleStats(s.userId, e.id, month) : await salesStats(s.userId, e.id, month);
    const done = tele ? st.meetings_completed : st.deals_won;
    const t = targets.find((x: any) => x.employee_id === e.id && x.metric === (tele ? "completed_meetings" : "deals_won"));
    return { e, tele, done, target: t ? Number(t.target_value) : null };
  }));
  const editable = can(s, "targets.edit");
  return (
    <>
      <PageHeader title="التارجت" sub="الأساس: الاجتماعات المنعقدة فعليًا للتيلي سيلز، والصفقات الموقعة للمبيعات." />
      {rows.length === 0 ? <Empty title="لا يوجد موظفون لعرض تارجتهم" /> : (
        <Table head={["الموظف", "الدور", "المقياس", "المنجز", "التارجت", "التقدم"]}>
          {rows.map(({ e, tele, done, target }) => (
            <tr key={e.id}><td className={td + " font-medium"}>{e.full_name}</td><td className={td}>{e.role_name_ar}</td>
              <td className={td}>{METRIC[tele ? "completed_meetings" : "deals_won"]}</td><td className={td}>{fmtNum(done)}</td>
              <td className={td}>{target == null ? <span className="text-ink-500">غير محدد</span> : fmtNum(target)}</td>
              <td className={td + " min-w-40"}>{target ? <Progress value={done} max={target} /> : "—"}</td></tr>))}
        </Table>)}
      {editable && rows.length > 0 && (
        <div className="mt-6 max-w-xl"><Card title="تحديد تارجت لهذا الشهر">
          <ActionForm action={setTargetAction} submit="حفظ التارجت" className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="month" value={month} />
            <SelectField label="الموظف" name="employee" required empty="اختر" options={rows.map(({ e }) => ({ value: e.id, label: e.full_name }))} />
            <SelectField label="المقياس" name="metric" required options={[{ value: "new_leads", label: METRIC.new_leads }, { value: "completed_meetings", label: METRIC.completed_meetings }, { value: "deals_won", label: METRIC.deals_won }]} />
            <Field label="القيمة" name="value" type="number" min="0" step="1" required />
          </ActionForm>
          <p className="mt-3 text-xs text-ink-500">كل تعديل على التارجت يُسجَّل في سجل التدقيق.</p>
        </Card></div>)}
    </>
  );
}
