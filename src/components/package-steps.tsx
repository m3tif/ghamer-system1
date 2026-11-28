import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { ActionForm, Field, Hidden, SelectField } from "@/components/forms";
import { saveTaskAction } from "@/server/actions";
import type { OpsStep } from "@/server/data";
import { TASK_STATUS, TASK_STATUS_TONE } from "@/lib/labels";

/** The work steps of the client's packages, in order. The Account Manager sends each step to its employee himself. */
export function PackageSteps({ opsId, steps, assignees, manage }: { opsId: string; steps: OpsStep[]; manage: boolean;
  assignees: { id: string; full_name: string; role_name: string; open_tasks: number; role_code?: string }[] }) {
  const done = steps.filter((s) => s.task_status === "approved").length;
  let lastStage: string | null = null;
  return (
    <Card title={`مراحل الباقة (${done}/${steps.length})`}>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const head = s.stage && s.stage !== lastStage ? s.stage : null; lastStage = s.stage;
          const fit = assignees.filter((a) => !s.role_code || a.role_code === s.role_code), list = fit.length ? fit : assignees;
          return (
            <li key={s.template_id}>
              {head && <p className="mb-2 mt-1 text-xs font-bold uppercase tracking-wide text-burgundy-700">{head}</p>}
              <div className={`rounded-md border p-3 ${s.task_status === "approved" ? "border-ok/30 bg-ok/5" : "border-line"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="font-semibold">{i + 1}. {s.task_id ? <Link href={`/tasks/${s.task_id}`} className="text-burgundy-700 underline">{s.title}</Link> : s.title}</p>
                    <p className="mt-0.5 text-xs text-ink-500">{[s.role_name ? `ينفّذها: ${s.role_name}` : null, s.needs_client ? "محتاجة موافقة العميل" : null, s.assignee_name ? `مع ${s.assignee_name}` : null].filter(Boolean).join(" · ")}</p>
                    {s.description && !s.task_id && <p className="mt-1 text-sm text-ink-500">{s.description}</p>}</div>
                  {s.task_status ? <Badge tone={TASK_STATUS_TONE[s.task_status]}>{TASK_STATUS[s.task_status]}</Badge> : <Badge tone="neutral">لسه ماتبعتتش</Badge>}
                </div>
                {manage && (!s.task_id || s.task_status === "cancelled") && list.length > 0 && (
                  <details className="mt-3"><summary className="inline-flex cursor-pointer rounded-md bg-burgundy-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-burgundy-700">ابعت الخطوة دي</summary>
                    <div className="mt-3"><ActionForm action={saveTaskAction} submit="ابعت للموظف" className="grid gap-3 md:grid-cols-[1fr_11rem_auto] md:items-end">
                      <Hidden name="ops_id" value={opsId} /><Hidden name="template" value={s.template_id} /><Hidden name="title" value={s.title} /><Hidden name="description" value={s.description ?? ""} />
                      <Hidden name="needs_client" value={s.needs_client ? "1" : "0"} /><Hidden name="estimated_hours" value={s.estimated_hours ? String(Number(s.estimated_hours)) : ""} />
                      <SelectField label={`الموظف${s.role_name ? ` (${s.role_name})` : ""}`} name="assignee" required empty="اختار" defaultValue={list.length === 1 ? list[0].id : undefined}
                        options={list.map((a) => ({ value: a.id, label: `${a.full_name} — ${a.role_name} (${a.open_tasks} مفتوح)` }))} />
                      <Field label="تاريخ التسليم" name="due_date" type="date" />
                    </ActionForm></div></details>)}
              </div>
            </li>);
        })}
      </ol>
    </Card>
  );
}
