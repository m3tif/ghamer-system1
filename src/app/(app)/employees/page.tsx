import { can, requirePerm, requireSession } from "@/lib/auth";
import { employeeLinks, employeeList, employeeNameHistory } from "@/server/data";
import Link from "next/link";
import { createEmployeeAction, reassignEmployeeAction, renameEmployeeAction, deleteEmployeeAction, resetPasswordAction, setActiveAction, setManagerAction } from "@/server/actions";
import { Badge, Card, PageHeader, Table, td } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { tx } from "@/lib/db";
import { Dialog } from "@/components/dialog";

export const metadata = { title: "الموظفون" };
export const dynamic = "force-dynamic";

const family = (r: string) => (["tele_sales", "tele_sales_manager"].includes(r) ? "tele" : ["sales_rep", "sales_manager"].includes(r) ? "sales" : r);

export default async function Employees({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession(); await requirePerm(s, "employees.view");
  const sp = await searchParams;
  const all = await employeeList(s.userId);
  const tab = sp.tab === "disabled" ? "disabled" : "active";
  const rows = all.filter((e: any) => (tab === "active") === e.is_active);
  const nActive = all.filter((e: any) => e.is_active).length;
  const manage = can(s, "employees.manage");
  const links = manage ? await employeeLinks(s.userId) : new Map<string, any>();
  const hist = manage ? new Map(await Promise.all(rows.map(async (e: any) => [e.id, await employeeNameHistory(s.userId, e.id)] as const))) : new Map<string, any[]>();
  const tabCls = (on: boolean) => `rounded-md px-3.5 py-2 text-sm ${on ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`;
  const roles = manage ? (await tx(s.userId, (c) => c.query("select code, name_ar from roles order by name_ar"))).rows : [];
  const managers = all.filter((r) => r.is_active && ["tele_sales_manager", "sales_manager"].includes(r.role_code));
  return (
    <>
      <PageHeader title="الموظفون" sub={`${nActive} نشط · ${all.length - nActive} موقوف`} />
      <div className="mb-4 flex gap-2" role="tablist">
        <Link href="/employees" role="tab" aria-selected={tab === "active"} className={tabCls(tab === "active")}>النشطون ({nActive})</Link>
        <Link href="/employees?tab=disabled" role="tab" aria-selected={tab === "disabled"} className={tabCls(tab === "disabled")}>الموقوفون ({all.length - nActive})</Link>
      </div>
      <Table head={["الاسم", "البريد", "الدور", "المدير", "التحقق بخطوتين", "الحالة", ...(manage ? ["العمل المرتبط", "إدارة"] : [])]}>
        {rows.map((e) => (
          <tr key={e.id}>
            <td className={td + " font-semibold"}>{e.full_name}</td><td className={td} dir="ltr">{e.email}</td><td className={td}>{e.role_name_ar}</td>
            <td className={td}>{e.manager_name ?? "—"}</td>
            <td className={td}>{e.mfa_enabled ? <Badge tone="ok">مفعّل</Badge> : <Badge>غير مفعّل</Badge>}</td>
            <td className={td}>{e.is_active ? <Badge tone="ok">نشط</Badge> : <Badge tone="bad">موقوف</Badge>}</td>
            {manage && (() => { const l = links.get(e.id); return (
              <td className={td + " text-xs leading-6"}>
                {l ? <>أضاف {l.leads_created} · مسؤول عن {l.leads_owned + l.leads_sales}<br />متابعات {l.open_followups} · اجتماعات {l.upcoming_meetings} · صفقات {l.open_deals}{l.pending_handoffs > 0 && <><br />قرارات معلّقة {l.pending_handoffs}</>}</> : "—"}
              </td>); })()}
            {manage && (
              <td className={td}>
                <div className="flex flex-col gap-1.5">
                  <details><summary className="cursor-pointer text-xs text-burgundy-600">تعديل الاسم</summary>
                    <ActionForm action={renameEmployeeAction} submit="حفظ الاسم" tone="quiet" className="mt-2 w-56 space-y-2">
                      <Hidden name="id" value={e.id} /><Field label="الاسم الكامل" name="full_name" required defaultValue={e.full_name} />
                      {(hist.get(e.id) ?? []).length > 0 && <ul className="text-xs text-ink-500">{(hist.get(e.id) ?? []).slice(0, 5).map((h: any, i: number) => <li key={i}>{h.old_name} ← {h.new_name} ({h.actor_name ?? "—"}، {String(h.at).slice(0, 10)})</li>)}</ul>}
                    </ActionForm></details>
                  {e.is_active && ["tele_sales", "sales_rep", "tele_sales_manager", "sales_manager"].includes(e.role_code) && (
                    <details><summary className="cursor-pointer text-xs text-burgundy-600">نقل العمل المفتوح</summary>
                      <ActionForm action={reassignEmployeeAction} submit="نقل" tone="quiet" className="mt-2 w-56 space-y-2">
                        <Hidden name="id" value={e.id} />
                        <SelectField label="إلى الموظف" name="to" required empty="اختر" options={all.filter((x: any) => x.is_active && x.id !== e.id && family(x.role_code) === family(e.role_code)).map((x: any) => ({ value: x.id, label: x.full_name }))} />
                        <TextArea label="السبب" name="reason" required rows={2} />
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" value="1" /> أؤكد نقل العملاء والمتابعات والاجتماعات المفتوحة (التاريخ يبقى باسم الموظف الأصلي)</label>
                      </ActionForm></details>)}
                  <details><summary className="cursor-pointer text-xs text-burgundy-600">الفريق</summary>
                    <ActionForm action={setManagerAction} submit="حفظ" tone="quiet" className="mt-2 w-56 space-y-2">
                      <Hidden name="id" value={e.id} />
                      <SelectField label="المدير المباشر" name="manager" defaultValue={e.manager_id ?? ""} empty="بدون مدير" options={managers.filter((m) => m.id !== e.id).map((m) => ({ value: m.id, label: m.full_name }))} />
                    </ActionForm></details>
                  <details><summary className="cursor-pointer text-xs text-burgundy-600">كلمة مرور جديدة</summary>
                    <ActionForm action={resetPasswordAction} submit="تعيين" tone="quiet" className="mt-2 w-56 space-y-2">
                      <Hidden name="id" value={e.id} /><Field label="كلمة المرور المؤقتة" name="password" type="password" dir="ltr" required /></ActionForm></details>
                  {e.id !== s.userId && (
                    <details><summary className="cursor-pointer text-xs text-burgundy-600">{e.is_active ? "إيقاف الحساب (بدون حذف)" : "إعادة التفعيل"}</summary>
                      <ActionForm action={setActiveAction} submit="تأكيد" tone="quiet" className="mt-2 w-56 space-y-2">
                        <Hidden name="id" value={e.id} /><Hidden name="active" value={e.is_active ? "0" : "1"} /><TextArea label="السبب" name="reason" required rows={2} /></ActionForm></details>)}
                  {s.role === "super_admin" && e.id !== s.userId && (
                    <Dialog trigger="حذف الموظف نهائيًا" title={`حذف نهائي: ${e.full_name}`} tone="danger">
                      <ActionForm action={deleteEmployeeAction} submit="حذف الموظف نهائيًا" className="grid gap-4">
                        <Hidden name="id" value={e.id} />
                        <p className="text-sm text-bad">يُحذف الحساب نهائيًا ولا يمكن التراجع. وكل العملاء اللي أضافهم هذا الموظف يُحذفون معه بالكامل (بنشاطاتهم واجتماعاتهم وصفقاتهم)، وأي أثر له على عملاء موظفين آخرين يُفصل عنه. لو عاوز تحتفظ بعملائه انقل عمله لموظف آخر ثم «إيقاف الحساب» بدل الحذف.</p>
                        <TextArea label="السبب" name="reason" rows={2} required />
                        <Field label="اكتب كلمة «حذف» للتأكيد" name="confirm" required />
                      </ActionForm>
                    </Dialog>)}
                </div>
              </td>)}
          </tr>))}
      </Table>
      {manage && (
        <div className="mt-6 max-w-2xl"><Card title="إضافة موظف">
          <ActionForm action={createEmployeeAction} submit="إنشاء الحساب" className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم الكامل" name="full_name" required /><Field label="البريد الإلكتروني" name="email" type="email" dir="ltr" required />
            <SelectField label="الدور" name="role" required empty="اختر الدور" options={roles.map((r: any) => ({ value: r.code, label: r.name_ar }))} />
            <SelectField label="المدير المباشر" name="manager" empty="بدون" options={managers.map((m) => ({ value: m.id, label: m.full_name }))} />
            <Field label="الجوال" name="phone" dir="ltr" /><Field label="المسمى الوظيفي" name="job_title" />
            <div className="sm:col-span-2"><Field label="كلمة مرور مؤقتة" name="password" type="password" dir="ltr" required hint="10 أحرف على الأقل. سيُطلب من الموظف تغييرها عند أول دخول. الأدوار الإدارية والمالية تُفعَّل لها المصادقة الثنائية تلقائيًا." /></div>
          </ActionForm>
        </Card></div>)}
    </>
  );
}
