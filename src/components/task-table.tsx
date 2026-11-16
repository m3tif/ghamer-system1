import Link from "next/link";
import { Badge, Table, td } from "@/components/ui";
import type { TaskRow } from "@/server/data";
import { fmtDate, fmtMins } from "@/lib/format";
import { TASK_PRIORITY, TASK_STATUS, TASK_STATUS_TONE } from "@/lib/labels";

export function TaskTable({ rows, showClient = true, showAssignee = true }: { rows: TaskRow[]; showClient?: boolean; showAssignee?: boolean }) {
  const head = ["التاسك", ...(showClient ? ["العميل"] : []), ...(showAssignee ? ["المنفّذ"] : []), "الحالة", "التسليم", "الوقت"];
  return (
    <Table head={head}>
      {rows.map((t) => (
        <tr key={t.id}>
          <td className={td}><Link href={`/tasks/${t.id}`} className="font-semibold text-burgundy-700 underline">{t.title}</Link>
            <div className="mt-0.5 text-xs text-ink-500">{[t.service_name, t.priority !== "normal" ? `أولوية ${TASK_PRIORITY[t.priority]}` : null, t.revisions ? `${t.revisions} تعديل` : null].filter(Boolean).join(" · ")}</div></td>
          {showClient && <td className={td}>{t.client_name}</td>}
          {showAssignee && <td className={td}>{t.assignee_name}<div className="text-xs text-ink-500">{t.role_name}</div></td>}
          <td className={td}><Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS[t.status]}</Badge>{t.running && <span className="ms-1 text-xs font-semibold text-ok">● العدّاد شغّال</span>}</td>
          <td className={td + " whitespace-nowrap"}>{t.due_date ? fmtDate(t.due_date) : "—"}{t.late && <div className="text-xs font-bold text-bad">متأخر</div>}</td>
          <td className={td + " whitespace-nowrap tabular-nums"}>{fmtMins(t.minutes)}{t.estimated_hours ? <span className="text-xs text-ink-500"> / {Number(t.estimated_hours)} س</span> : null}</td>
        </tr>))}
    </Table>
  );
}
