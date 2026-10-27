import { can, requirePerm, requireSession } from "@/lib/auth";
import { employeeList } from "@/server/data";
import { createEmployeeAction, resetPasswordAction, setActiveAction, setManagerAction } from "@/server/actions";
import { Badge, Card, PageHeader, Table, td } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { tx } from "@/lib/db";

export const metadata = { title: "الموظفون" };
export const dynamic = "force-dynamic";

export default async function Employees() {
  const s = await requireSession(); await requirePerm(s, "employees.view");
  const rows = await employeeList(s.userId);
  const manage = can(s, "employees.manage");
  const roles = manage ? (await tx(s.userId, (c) => c.query("select code, name_ar from roles order by name_ar"))).rows : [];
  const managers = rows.filter((r) => r.is_active && ["tele_sales_manager", "sales_manager"].includes(r.role_code));
  return (
    <>
      <PageHeader title="الموظفون" sub={`${rows.length} موظف ضمن صلاحياتك`} />
      <Table head={["الاسم", "البريد", "الدور", "المدير", "التحقق بخطوتين", "الحالة", ...(manage ? ["إدارة"] : [])]}>
        {rows.map((e) => (
          <tr key={e.id}>
            <td className={td + " font-semibold"}>{e.full_name}</td><td className={td} dir="ltr">{e.email}</td><td className={td}>{e.role_name_ar}</td>
            <td className={td}>{e.manager_name ?? "—"}</td>
            <td className={td}>{e.mfa_enabled ? <Badge tone="ok">مفعّل</Badge> : <Badge>غير مفعّل</Badge>}</td>
            <td className={td}>{e.is_active ? <Badge tone="ok">نشط</Badge> : <Badge tone="bad">موقوف</Badge>}</td>
            {manage && (
              <td className={td}>
                <div className="flex flex-col gap-1.5">
                  <details><summary className="cursor-pointer text-xs text-burgundy-600">الفريق</summary>
                    <ActionForm action={setManagerAction} submit="حفظ" tone="quiet" className="mt-2 w-56 space-y-2">
                      <Hidden name="id" value={e.id} />
                      <SelectField label="المدير المباشر" name="manager" defaultValue={e.manager_id ?? ""} empty="بدون مدير" options={managers.filter((m) => m.id !== e.id).map((m) => ({ value: m.id, label: m.full_name }))} />
                    </ActionForm></details>
                  <details><summary className="cursor-pointer text-xs text-burgundy-600">كلمة مرور جديدة</summary>
                    <ActionForm action={resetPasswordAction} submit="تعيين" tone="quiet" className="mt-2 w-56 space-y-2">
                      <Hidden name="id" value={e.id} /><Field label="كلمة المرور المؤقتة" name="password" type="password" dir="ltr" required /></ActionForm></details>
                  {e.id !== s.userId && (
                    <details><summary className="cursor-pointer text-xs text-burgundy-600">{e.is_active ? "إيقاف الحساب" : "إعادة التفعيل"}</summary>
                      <ActionForm action={setActiveAction} submit="تأكيد" tone="quiet" className="mt-2 w-56 space-y-2">
                        <Hidden name="id" value={e.id} /><Hidden name="active" value={e.is_active ? "0" : "1"} /><TextArea label="السبب" name="reason" required rows={2} /></ActionForm></details>)}
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
