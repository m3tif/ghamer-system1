import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { servicesList, taskAssignees, taskGet } from "@/server/data";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Alert, Field, Hidden, TextArea } from "@/components/forms";
import { TaskForm } from "@/components/task-form";
import { TaskTimer } from "@/components/task-timer";
import { uploadTaskFileAction } from "@/server/actions";
import { DeleteFile } from "@/components/delete-file";
import { BRIEF_FIELDS } from "@/components/onboarding-card";
import { inputCls } from "@/components/forms";
import { clientNoTaskAction, clientOkTaskAction } from "@/server/actions";
import { addTaskTimeAction, approveTaskAction, commentTaskAction, pauseTaskAction, rejectTaskAction, startTaskAction, submitTaskAction } from "@/server/actions";
import { fmtDate, fmtDateTime, fmtMins } from "@/lib/format";
import { TASK_PRIORITY, TASK_STATUS, TASK_STATUS_TONE } from "@/lib/labels";

export const metadata = { title: "تاسك" };
export const dynamic = "force-dynamic";

export default async function Task({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await taskGet(s.userId, id);
  if (!t) notFound();
  const mine = t.is_assignee, workable = mine && !["submitted", "client_review", "approved"].includes(t.status), running = !!t.running_since;
  const editable = t.can_manage && t.status !== "approved";
  const [assignees, services] = editable ? await Promise.all([taskAssignees(s.userId), servicesList(s.userId)]) : [[], []];
  const closedSeconds = (t.logs as any[]).filter((l) => l.ended_at).reduce((a, l) => a + Math.round((new Date(l.ended_at).getTime() - new Date(l.started_at).getTime()) / 1000), 0);
  const row = (k: string, v: React.ReactNode) => (<div className="flex justify-between gap-3"><dt className="shrink-0 text-ink-500">{k}</dt><dd className="min-w-0 break-words text-end" dir="auto">{v || "—"}</dd></div>);
  return (
    <>
      <PageHeader title={t.title} sub={`${t.client_name}${t.service_name ? " · " + t.service_name : ""}`}
        actions={<><Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS[t.status]}</Badge>{t.late && <Badge tone="bad">متأخر</Badge>}
          <Link href={t.can_manage ? `/operations/${t.ops_id}` : "/tasks"} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">رجوع</Link></>} />
      {t.status === "changes_requested" && <div className="mb-4"><Alert kind="error">مطلوب تعديل: {t.review_note} — {t.reviewed_by_name} · {fmtDateTime(t.reviewed_at)}</Alert></div>}
      {t.status === "approved" && <div className="mb-4"><Alert kind="ok">التاسك معتمد — {t.reviewed_by_name} · {fmtDateTime(t.reviewed_at)}{t.review_note ? ` — ${t.review_note}` : ""}</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {t.description && <Card title="المطلوب"><p className="whitespace-pre-wrap text-sm leading-7">{t.description}</p></Card>}

          {mine && t.status !== "approved" && (
            <Card title="وقت الشغل">
              <div className="flex flex-wrap items-center gap-4">
                {running ? <TaskTimer since={t.running_since} baseSeconds={closedSeconds} /> : <span className="text-2xl font-bold tabular-nums">{fmtMins(t.minutes)}</span>}
                {workable && (running
                  ? <ActionForm action={pauseTaskAction} submit="⏸ إيقاف مؤقت" tone="quiet" className=""><Hidden name="task_id" value={id} /></ActionForm>
                  : <ActionForm action={startTaskAction} submit={t.logs.length ? "▶ كمّل الشغل" : "▶ ابدأ الشغل"} className=""><Hidden name="task_id" value={id} /></ActionForm>)}
              </div>
              {workable && (
                <details className="mt-4 text-sm"><summary className="cursor-pointer text-ink-500">نسيت تشغّل العدّاد؟ ضيف وقت يدوي</summary>
                  <div className="mt-3"><ActionForm action={addTaskTimeAction} submit="إضافة الوقت" tone="quiet" className="grid gap-3 md:grid-cols-[8rem_1fr_auto] md:items-end">
                    <Hidden name="task_id" value={id} />
                    <Field label="الدقايق" name="minutes" type="number" min="1" dir="ltr" required />
                    <Field label="السبب" name="reason" required placeholder="مثال: اشتغلت والنت فاصل" />
                  </ActionForm></div></details>)}
            </Card>)}

          {workable && (
            <Card title="تسليم التاسك">
              <ActionForm action={submitTaskAction} submit="تسليم للمراجعة" hiddenOnOk>
                <Hidden name="task_id" value={id} />
                <Field label="رابط التسليم (اختياري)" name="link" dir="ltr" placeholder="https://drive.google.com/..." defaultValue={t.delivery_link ?? ""} hint="رابط الملف أو الفولدر لو فيه (درايف، فيجما…). ممكن تسلّم من غير رابط وترفع الملف تحت في «ملفات»." />
                <TextArea label="ملاحظة (اختياري)" name="note" rows={2} />
              </ActionForm>
            </Card>)}

          {(t.delivery_link || ["submitted", "client_review", "approved"].includes(t.status)) && (
            <Card title="التسليم">
              {t.delivery_link ? <p className="text-sm"><a href={t.delivery_link} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all font-medium text-burgundy-700 underline">{t.delivery_link}</a></p> : <p className="text-sm text-ink-500">اتسلّم من غير رابط — شوف الملفات والملاحظة.</p>}
              {t.delivery_note && <p className="mt-2 whitespace-pre-wrap text-sm">{t.delivery_note}</p>}
              <p className="mt-2 text-xs text-ink-500">سلّمه {t.assignee_name} · {fmtDateTime(t.submitted_at)}</p>
              {t.can_review && t.status === "submitted" && (
                <div className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
                  <ActionForm action={approveTaskAction} submit={t.needs_client ? "اعتماد وإرسال للعميل" : "اعتماد ✓"} hiddenOnOk><Hidden name="task_id" value={id} /><TextArea label="ملاحظة (اختياري)" name="note" rows={2} /></ActionForm>
                  <ActionForm action={rejectTaskAction} submit="طلب تعديل" tone="quiet" hiddenOnOk><Hidden name="task_id" value={id} /><TextArea label="التعديل المطلوب" name="note" rows={2} required /></ActionForm>
                </div>)}
              {t.can_review && t.status === "client_review" && (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="mb-3 text-sm font-medium">ابعت الشغل للعميل، ولما يرد سجّل رده هنا:</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ActionForm action={clientOkTaskAction} submit="العميل وافق ✓" hiddenOnOk><Hidden name="task_id" value={id} /><TextArea label="ملاحظة (اختياري)" name="note" rows={2} /></ActionForm>
                    <ActionForm action={clientNoTaskAction} submit="العميل طلب تعديل" tone="quiet" hiddenOnOk><Hidden name="task_id" value={id} /><TextArea label="التعديل اللي العميل طلبه" name="note" rows={2} required /></ActionForm>
                  </div>
                </div>)}
            </Card>)}

          <Card title={`ملفات (${t.files.length})`}>
            {t.files.length > 0 && <ul className="mb-4 divide-y divide-line text-sm">{(t.files as any[]).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><a href={`/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-burgundy-700 underline">{f.filename}</a>
                <span className="flex items-center gap-3 text-xs text-ink-500"><span>{Math.max(1, Math.round(Number(f.size_bytes) / 1024))} ك.ب · {f.by} · {fmtDateTime(f.at)}</span>{f.can_delete && <DeleteFile taskId={id} fileId={f.id} name={f.filename} />}</span></li>))}</ul>}
            {(mine || t.can_manage) && t.status !== "approved" ? (
              <ActionForm action={uploadTaskFileAction} submit="رفع الملف" tone="quiet" className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <Hidden name="task_id" value={id} />
                <div><label htmlFor="file" className="mb-1 block text-sm font-medium">ملف (مرجع أو تسليم)</label>
                  <input id="file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={inputCls + " file:me-3 file:rounded file:border-0 file:bg-cream file:px-3 file:py-1 file:text-sm"} />
                  <p className="mt-1 text-xs text-ink-500">PDF أو صورة — لحد 4 ميجا. الملفات الكبيرة حطها على درايف وابعت الرابط في التسليم.</p></div>
              </ActionForm>) : t.files.length === 0 ? <p className="text-sm text-ink-500">مفيش ملفات.</p> : null}
          </Card>

          {t.brief && BRIEF_FIELDS.some(([k]) => t.brief[k]) && (
            <Card title="بريف العميل"><details className="text-sm"><summary className="cursor-pointer font-medium text-burgundy-700">اعرض البريف (الهوية، الجمهور، الروابط…)</summary>
              <dl className="mt-3 space-y-3">{BRIEF_FIELDS.filter(([k]) => t.brief[k]).map(([k, label]) => <div key={k}><dt className="text-ink-500">{label}</dt><dd className="whitespace-pre-wrap">{t.brief[k]}</dd></div>)}</dl></details></Card>)}

          <Card title={`التعليقات (${t.comments.length})`}>
            {t.comments.length > 0 && <ul className="mb-4 space-y-3 text-sm">{(t.comments as any[]).map((c, i) => (
              <li key={i} className="rounded-md bg-cream/60 p-3"><p className="whitespace-pre-wrap">{c.body}</p><p className="mt-1 text-xs text-ink-500">{c.by} · {fmtDateTime(c.at)}</p></li>))}</ul>}
            <ActionForm action={commentTaskAction} submit="إضافة تعليق" tone="quiet"><Hidden name="task_id" value={id} /><TextArea label="تعليق أو سؤال" name="body" rows={2} required /></ActionForm>
          </Card>

          {editable && <Card title="تعديل التاسك"><TaskForm opsId={t.ops_id} assignees={assignees} services={services} task={t} /></Card>}
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="بيانات التاسك">
            <dl className="space-y-1.5 text-sm">
              {row("العميل", t.client_name)}
              {row("المتجر", t.store_url ? <a href={/^https?:/.test(t.store_url) ? t.store_url : `https://${t.store_url}`} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all underline">{t.store_url}</a> : null)}
              {row("المنفّذ", t.assignee_name)}
              {row("الأكاونت مانجر", t.account_manager_name)}
              {row("الأولوية", TASK_PRIORITY[t.priority])}
              {row("تاريخ البداية", t.start_date ? fmtDate(t.start_date) : null)}
              {row("تاريخ التسليم", t.due_date ? fmtDate(t.due_date) : null)}
              {row("الساعات المتوقعة", t.estimated_hours ? `${Number(t.estimated_hours)} س` : null)}
              {row("الوقت الفعلي", fmtMins(t.minutes))}
              {row("موافقة العميل", t.needs_client ? (t.client_decided_at && t.status === "approved" ? `وافق · ${fmtDateTime(t.client_decided_at)}` : "مطلوبة") : "مش مطلوبة")}
              {row("عدد مرات التعديل", String(t.revisions))}
              {row("أنشأه", `${t.created_by_name} · ${fmtDateTime(t.created_at)}`)}
            </dl>
          </Card>
          <Card title="سجل الوقت">
            {t.logs.length === 0 ? <p className="text-sm text-ink-500">مفيش وقت متسجل لسه.</p> : (
              <ul className="divide-y divide-line text-sm">{(t.logs as any[]).map((l, i) => (
                <li key={i} className="py-2"><div className="flex justify-between gap-2"><span>{fmtDateTime(l.started_at)}</span><span className="font-semibold tabular-nums">{l.ended_at ? fmtMins(l.minutes) : "شغّال…"}</span></div>
                  <div className="text-xs text-ink-500">{l.by}{l.manual ? ` · يدوي: ${l.reason}` : ""}</div></li>))}</ul>)}
          </Card>
        </div>
      </div>
    </>
  );
}
