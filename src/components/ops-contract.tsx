import { ActionForm, Hidden, inputCls } from "@/components/forms";
import { deleteOpsContractAction, uploadOpsContractAction } from "@/server/actions";
import { opsContractFiles } from "@/server/data";
import { fmtDateTime } from "@/lib/format";

/** The client's uploaded contract files, and an upload form for who may add one (the database decides). */
export async function OpsContract({ uid, opsId, canUpload }: { uid: string; opsId: string; canUpload: boolean }) {
  const files = await opsContractFiles(uid, opsId);
  return (
    <div className="space-y-3">
      {files.length > 0 ? (
        <ul className="divide-y divide-line text-sm">{files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0"><a href={`/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-burgundy-700 underline">{f.filename}</a>
              <span className="block text-xs text-ink-500">{f.by_name ?? "—"} · {fmtDateTime(f.created_at)}</span></span>
            {f.can_delete && <ActionForm action={deleteOpsContractAction} submit="امسح" tone="quiet" className=""><Hidden name="file_id" value={f.id} /></ActionForm>}
          </li>))}</ul>) : <p className="text-sm text-ink-500">لسه مفيش عقد مرفوع.</p>}
      {canUpload && (
        <ActionForm action={uploadOpsContractAction} submit="ارفع العقد" tone="quiet" className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Hidden name="ops_id" value={opsId} />
          <div><input name="file" type="file" required aria-label="ملف العقد" accept="application/pdf,image/jpeg,image/png,image/webp" className={inputCls + " text-sm file:me-3 file:rounded file:border-0 file:bg-cream file:px-3 file:py-1"} />
            <p className="mt-1 text-xs text-ink-500">PDF أو صورة، لحد 4 ميجا.</p></div>
        </ActionForm>)}
    </div>
  );
}
