"use client";
import { useActionState } from "react";
import { deleteContractFileAction } from "@/server/actions";

/** Small «مسح» button beside an uploaded file; asks before deleting. */
export function DeleteFile({ contractId, fileId, name }: { contractId: string; fileId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteContractFileAction, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="contract_id" value={contractId} />
      <input type="hidden" name="file_id" value={fileId} />
      <button type="submit" disabled={pending} className="rounded border border-bad/40 px-2 py-0.5 text-xs font-medium text-bad hover:bg-bad/5 disabled:opacity-50"
        onClick={(e) => { if (!window.confirm(`تمسح الملف «${name}»؟ مش هيرجع تاني.`)) e.preventDefault(); }}>{pending ? "…" : "مسح"}</button>
      {state?.error && <span className="text-bad">{state.error}</span>}
    </form>
  );
}
