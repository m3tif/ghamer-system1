"use client";
import { useActionState } from "react";
import { setOnboardingItemAction } from "@/server/actions";

/** One requirement of the onboarding checklist: a tick the Account Manager flips. */
export function ChecklistItem({ opsId, item, canEdit }: { opsId: string; item: { id: string; label: string; done: boolean; done_by: string | null }; canEdit: boolean }) {
  const [state, action, pending] = useActionState(setOnboardingItemAction, {});
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      {canEdit ? (
        <form action={action}>
          <input type="hidden" name="ops_id" value={opsId} /><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="done" value={item.done ? "0" : "1"} />
          <button type="submit" disabled={pending} aria-label={item.done ? "إلغاء العلامة" : "تم"} aria-pressed={item.done}
            className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${item.done ? "border-ok bg-ok text-white" : "border-line bg-white"} disabled:opacity-50`}>{item.done ? "✓" : ""}</button>
        </form>
      ) : <span className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${item.done ? "border-ok bg-ok text-white" : "border-line bg-white"}`}>{item.done ? "✓" : ""}</span>}
      <span className={item.done ? "text-ink-500 line-through" : ""}>{item.label}</span>
      {item.done && item.done_by && <span className="text-xs text-ink-500">· {item.done_by}</span>}
      {state?.error && <span className="text-xs text-bad">{state.error}</span>}
    </li>
  );
}
