import { Card } from "@/components/ui";
import { ActionForm, Field, Hidden, TextArea } from "@/components/forms";
import { ChecklistItem } from "@/components/onboarding-checklist";
import { addOnboardingItemAction, saveOnboardingAction } from "@/server/actions";
import { fmtDateTime, toLocalInput, tzLabel } from "@/lib/format";

const BRIEF: [string, string][] = [["goals", "أهداف العميل"], ["audience", "الجمهور المستهدف"], ["brand_identity", "الهوية البصرية"], ["competitors", "المنافسين"],
  ["products", "المنتجات والخدمات"], ["channels", "قنوات التسويق"], ["kpis", "مؤشرات النجاح (KPIs)"], ["priorities", "الأولويات"], ["links", "الملفات والروابط"], ["plan", "خطة التنفيذ"]];

/** Client onboarding: kickoff meeting, operational brief, and the checklist of what is needed from the client. */
export function OnboardingCards({ opsId, data }: { opsId: string; data: { brief: any | null; items: any[]; can_edit: boolean } }) {
  const b = data.brief ?? {}, done = data.items.filter((i) => i.done).length;
  return (
    <>
      <Card title={`المطلوب من العميل (${done}/${data.items.length})`}>
        {data.items.length === 0 ? <p className="text-sm text-ink-500">مفيش بنود لسه.</p> : <ul className="divide-y divide-line/60">{data.items.map((i) => <ChecklistItem key={i.id} opsId={opsId} item={i} canEdit={data.can_edit} />)}</ul>}
        {data.can_edit && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            {data.items.length === 0 && <ActionForm action={addOnboardingItemAction} submit="أضف القايمة الجاهزة (صلاحيات، لوجو، منتجات…)" tone="quiet" className="" hiddenOnOk><Hidden name="ops_id" value={opsId} /><Hidden name="seed" value="1" /></ActionForm>}
            <ActionForm action={addOnboardingItemAction} submit="إضافة بند" tone="quiet" className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end"><Hidden name="ops_id" value={opsId} /><Field label="بند جديد" name="label" placeholder="مثال: صلاحية Google Analytics" /></ActionForm>
          </div>)}
      </Card>
      <Card title="استلام العميل — الـ Kickoff والبريف التشغيلي" right={b.updated_at ? <span className="text-xs text-ink-500">آخر تعديل: {b.updated_by_name} · {fmtDateTime(b.updated_at)}</span> : undefined}>
        {data.can_edit ? (
          <ActionForm action={saveOnboardingAction} submit="حفظ" className="grid gap-3 md:grid-cols-2">
            <Hidden name="ops_id" value={opsId} />
            <Field label={`ميعاد اجتماع الـ Kickoff (${tzLabel()})`} name="kickoff_at" type="datetime-local" defaultValue={b.kickoff_at ? toLocalInput(b.kickoff_at) : ""} />
            <Field label="رابط الاجتماع" name="kickoff_link" dir="ltr" placeholder="https://meet.google.com/..." defaultValue={b.kickoff_link ?? ""} />
            {BRIEF.map(([k, label]) => <TextArea key={k} label={label} name={k} rows={k === "plan" ? 4 : 2} defaultValue={b[k] ?? ""} className={k === "plan" ? "md:col-span-2" : undefined} />)}
          </ActionForm>
        ) : !data.brief ? <p className="text-sm text-ink-500">الأكاونت مانجر لسه ماكتبش البريف.</p> : (
          <dl className="space-y-3 text-sm">
            {b.kickoff_at && <div><dt className="text-ink-500">ميعاد الـ Kickoff</dt><dd>{fmtDateTime(b.kickoff_at)}{b.kickoff_link && <> · <a href={b.kickoff_link} target="_blank" rel="noopener noreferrer" className="underline">رابط الاجتماع</a></>}</dd></div>}
            {BRIEF.filter(([k]) => b[k]).map(([k, label]) => <div key={k}><dt className="text-ink-500">{label}</dt><dd className="whitespace-pre-wrap">{b[k]}</dd></div>)}
          </dl>)}
      </Card>
    </>
  );
}
export const BRIEF_FIELDS = BRIEF;
