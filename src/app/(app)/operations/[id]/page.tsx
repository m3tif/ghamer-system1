import Link from "next/link";
import { OpsClientEdit } from "@/components/ops-client-edit";
import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { opsSteps } from "@/server/data";
import { PackageSteps } from "@/components/package-steps";
import { onboardingGet, opsList, servicesList, taskAssignees, taskList, taskTemplates } from "@/server/data";
import { OnboardingCards } from "@/components/onboarding-card";
import { TemplatePicker } from "@/components/template-picker";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { TaskForm } from "@/components/task-form";
import { TaskTable } from "@/components/task-table";
import { fmtDate, fmtMins } from "@/lib/format";

export const metadata = { title: "ملف العميل — التشغيل" };
export const dynamic = "force-dynamic";

export default async function OpsClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (!can(s, "ops.view") || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = (await opsList(s.userId, null)).find((x) => x.id === id);
  if (!r) notFound();
  const manage = can(s, "tasks.manage") && (s.role !== "account_manager" || r.account_manager_id === s.userId);
  const [tasks, assignees, services, templates, onboarding] = await Promise.all([taskList(s.userId, "all", id), manage ? taskAssignees(s.userId) : Promise.resolve([]), manage ? servicesList(s.userId) : Promise.resolve([]),
    manage ? taskTemplates(s.userId) : Promise.resolve([]), onboardingGet(s.userId, id)]);
  const steps = await opsSteps(s.userId, id);
  const done = tasks.filter((t) => t.status === "approved").length, mins = tasks.reduce((a, t) => a + t.minutes, 0);
  const row = (k: string, v: React.ReactNode) => (<div className="flex justify-between gap-3"><dt className="shrink-0 text-ink-500">{k}</dt><dd className="min-w-0 break-words text-end" dir="auto">{v || "—"}</dd></div>);
  return (
    <>
      <PageHeader title={r.client_name} sub={r.business_name ?? undefined}
        actions={<>{r.status === "new" ? <Badge tone="warn">مستني تحويل</Badge> : <Badge tone="ok">مع {r.account_manager_name}</Badge>}
          {r.status !== "new" && <Link href={`/operations/${id}/portal`} className="rounded-md bg-burgundy-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-burgundy-700">بوابة العميل</Link>}
          <Link href={`/clients/${r.client_id}`} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">الملف الكامل 360°</Link>
          <Link href="/operations" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">رجوع</Link></>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {steps.length > 0 && <PackageSteps opsId={id} steps={steps} assignees={assignees} manage={manage} />}
          <Card title={`التاسكات (${tasks.length})`} right={tasks.length ? <span className="text-sm text-ink-500">{done} معتمد · {fmtMins(mins)} شغل</span> : undefined}>
            {tasks.length === 0 ? <Empty title="مفيش تاسكات لسه" hint={manage ? "اعمل أول تاسك من الفورم اللي تحت." : undefined} /> : <TaskTable rows={tasks} showClient={false} />}
          </Card>
          {manage && (assignees.length === 0
            ? <div className="rounded-md border border-warn/40 bg-warn/5 px-4 py-3 text-sm">مفيش موظفين تقنيين عندهم حسابات شغّالة لسه. مدير النظام يضيفهم من «الموظفون» (ديزاينر، SEO، مبرمج…).</div>
            : <Card title="تاسك جديد"><TemplatePicker templates={templates} /><TaskForm opsId={id} assignees={assignees} services={services} /></Card>)}
          {onboarding && <OnboardingCards opsId={id} data={onboarding} />}
        </div>
        <div className="min-w-0">
          <Card title="بيانات العميل" right={<OpsClientEdit uid={s.userId} opsId={id} label="✎ تعديل" />}>
            <div className="mb-3 flex flex-wrap gap-1.5">{r.packages.map((p) => <span key={p} className="rounded-md border border-burgundy-600/30 bg-burgundy-600/5 px-2 py-0.5 text-xs font-medium">✓ {p}</span>)}</div>
            <dl className="space-y-1.5 text-sm">
              {row("رقم الجوال", r.phone ? <a href={`tel:${r.phone}`} dir="ltr" className="underline">{r.phone}</a> : null)}
              {row("المتجر", r.store_url ? <a href={/^https?:/.test(r.store_url) ? r.store_url : `https://${r.store_url}`} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all underline">{r.store_url}</a> : null)}
              {row("بداية التعاقد", r.start_date ? fmtDate(r.start_date) : null)}
              {row("نهاية التعاقد", r.end_date ? fmtDate(r.end_date) : null)}
              {row("السيلز", r.sales_name)}
              {r.contract_notes && row("ملاحظات العقد", r.contract_notes)}
              {r.assign_note && row("ملاحظة التحويل", r.assign_note)}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
