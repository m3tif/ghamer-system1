import Link from "next/link";
import { Dialog } from "@/components/dialog";
import { ActionForm, Field, Hidden, TextArea } from "@/components/forms";
import { moveDealAction } from "@/server/actions";
import { pipeOf } from "@/lib/labels";
import { toLocalInput } from "@/lib/format";

/** The three things a Sales rep does with a deal: follow it up (with a date), write the contract, or mark it lost. */
export function DealActions({ deal, compact = false }: { deal: { id: string; stage: string; client_name: string; has_contract?: boolean }; compact?: boolean }) {
  const g = pipeOf(deal.stage);
  if (g === "won" || g === "lost") return null;
  const btn = compact ? "px-2! py-1! text-xs!" : "";
  const tomorrow = toLocalInput(new Date(Date.now() + 864e5)).slice(0, 10) + "T11:00";
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "" : "gap-2"}`}>
      {g !== "contract" && (
        <Dialog trigger={g === "follow" ? "متابعة جديدة" : "بتابعه"} title={`متابعة — ${deal.client_name}`} tone="quiet" triggerClass={btn}>
          <ActionForm action={moveDealAction} submit="حفظ" className="space-y-3">
            <Hidden name="deal_id" value={deal.id} /><Hidden name="to" value="Follow-up" />
            <Field label="هتكلمه إمتى؟" name="followup_at" type="datetime-local" required defaultValue={tomorrow} />
            <TextArea label="ملاحظة (اتكلمتوا في إيه / هتكلمه في إيه)" name="followup_reason" rows={3} required />
          </ActionForm>
        </Dialog>)}
      <Link href={`/contracts/new?deal=${deal.id}`} className={`rounded-md bg-burgundy-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-burgundy-700 ${btn}`}>{g === "contract" ? "فتح العقد" : "اعمل عقد"}</Link>
      <Dialog trigger="خسرناه" title={`خسرناه — ${deal.client_name}`} tone="danger" triggerClass={btn}>
        <ActionForm action={moveDealAction} submit="تأكيد" className="space-y-3">
          <Hidden name="deal_id" value={deal.id} /><Hidden name="to" value="Lost" />
          <TextArea label="السبب" name="reason" rows={2} required placeholder="مثال: السعر عالي / اختار شركة تانية / مش مهتم" />
          <p className="text-xs text-ink-500">العميل هيختفي من الخط ويفضل محفوظ في «خسرناهم». لو كان فيه عقد لسه ماتبعتش للمالية بيتلغي.</p>
        </ActionForm>
      </Dialog>
    </div>
  );
}
