import { ActionForm, Field, Hidden, SelectField, TextArea } from "@/components/forms";
import { saveTaskAction } from "@/server/actions";
import { TASK_PRIORITY } from "@/lib/labels";

/** Create / edit a task. Used by the Account Manager and the Technical Manager. */
export function TaskForm({ opsId, assignees, services, task }: { opsId: string; assignees: { id: string; full_name: string; role_name: string; open_tasks: number }[];
  services: { code: string; name_ar: string }[]; task?: any }) {
  const d = (v: unknown) => (v ? String(v).slice(0, 10) : "");
  return (
    <ActionForm action={saveTaskAction} submit={task ? "حفظ التعديل" : "إنشاء التاسك"} className="grid gap-3 md:grid-cols-2">
      <Hidden name="ops_id" value={opsId} />{task && <Hidden name="task_id" value={task.id} />}
      <Field label="عنوان التاسك" name="title" required defaultValue={task?.title} className="md:col-span-2" placeholder="مثال: تصميم 5 بنرات للمتجر" />
      <SelectField label="الموظف المنفّذ" name="assignee" required empty="اختار" defaultValue={task?.assignee_id}
        options={assignees.map((a) => ({ value: a.id, label: `${a.full_name} — ${a.role_name} (${a.open_tasks} تاسك مفتوح)` }))} />
      <SelectField label="الباقة / الخدمة" name="service" empty="—" defaultValue={task?.service_code ?? ""} options={services.map((s) => ({ value: s.code, label: s.name_ar }))} />
      <SelectField label="الأولوية" name="priority" defaultValue={task?.priority ?? "normal"} options={Object.entries(TASK_PRIORITY).map(([value, label]) => ({ value, label }))} />
      <Field label="الساعات المتوقعة" name="estimated_hours" type="number" min="0.25" step="0.25" dir="ltr" defaultValue={task?.estimated_hours ? String(Number(task.estimated_hours)) : ""} />
      <Field label="تاريخ البداية" name="start_date" type="date" defaultValue={d(task?.start_date)} />
      <Field label="تاريخ التسليم" name="due_date" type="date" defaultValue={d(task?.due_date)} />
      <TextArea label="الوصف والمطلوب" name="description" rows={3} defaultValue={task?.description ?? ""} className="md:col-span-2" />
    </ActionForm>
  );
}
