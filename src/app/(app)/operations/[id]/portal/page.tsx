import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { portalStaffGet } from "@/server/data";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ActionForm, Field, Hidden, TextArea } from "@/components/forms";
import { CredentialsForm } from "@/components/portal/credentials-form";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { TASK_STATUS, TASK_STATUS_TONE } from "@/lib/labels";
import {
  portalActiveAction, portalEnableAction, portalFileVisibleAction, portalProjectAction, portalReplyAction, portalRequestAction, portalRequestCloseAction, portalResetAction,
  portalShareFileAction, portalStaffUploadAction, portalStageOpAction, portalStageSaveAction, portalTaskSetAction, portalTicketCloseStaffAction, portalUpdateAction,
} from "@/server/portal-staff-actions";

export const metadata = { title: "بوابة العميل" };
export const dynamic = "force-dynamic";

const TABS = [["overview", "المشروع والمراحل"], ["updates", "التحديثات"], ["requests", "مطلوب من العميل"], ["approvals", "التاسكات والموافقات"], ["support", "الدعم"], ["files", "الملفات"], ["log", "السجل"]] as const;
const REQ: Record<string, [string, "neutral" | "ok" | "warn" | "bad" | "brand"]> = { open: ["مستني العميل", "warn"], submitted: ["العميل رد — راجعه", "brand"], done: ["اتقفل ✓", "ok"], cancelled: ["اتلغى", "neutral"] };
const TK: Record<string, [string, "neutral" | "ok" | "warn" | "bad" | "brand"]> = { open: ["مستني ردك", "warn"], answered: ["اترد", "ok"], closed: ["مقفول", "neutral"] };

function Msgs({ list }: { list: any[] }) {
  if (!list.length) return null;
  return (
    <ul className="space-y-2">
      {list.map((m) => (
        <li key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.from_client ? "border border-burgundy-600/20 bg-burgundy-50" : "bg-cream/70"}`}>
          <p className="whitespace-pre-wrap">{m.body}</p>
          <p className="mt-0.5 text-xs text-ink-500">{m.from_client ? "العميل" : m.by} · {fmtDateTime(m.at)}</p>
        </li>))}
    </ul>
  );
}
function Reply({ ops, kind, id, label = "رد على العميل" }: { ops: string; kind: string; id: string; label?: string }) {
  return (
    <ActionForm action={portalReplyAction} submit={label} tone="quiet" className="space-y-2">
      <Hidden name="ops_id" value={ops} /><Hidden name="kind" value={kind} /><Hidden name="thread_id" value={id} />
      <TextArea label="الرد (العميل هيشوفه)" name="body" rows={2} required />
    </ActionForm>
  );
}
function FileLinks({ files }: { files: any[] }) {
  if (!files?.length) return null;
  return <ul className="mt-2 space-y-1 text-sm">{files.map((f) => <li key={f.id}><a href={`/portal-files/${f.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-burgundy-700 underline">{f.filename}</a> <span className="text-xs text-ink-500">{f.from_client ? "من العميل" : ""}</span></li>)}</ul>;
}

export default async function OpsPortal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const j = await portalStaffGet(s.userId, id);
  if (!j) notFound();
  const tab = (await searchParams).tab ?? "overview";
  const m = j.can_manage as boolean, on = !!j.project;
  const stages = j.stages as any[], cur = stages.find((x) => x.status === "current");
  const pendingReq = (j.requests as any[]).filter((r) => r.status === "submitted").length;
  const openTk = (j.tickets as any[]).filter((t) => t.status === "open").length;
  const back = <Link href={`/operations/${id}`} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">رجوع لملف العميل</Link>;

  if (!on) return (
    <>
      <PageHeader title={`بوابة العميل — ${j.client_name}`} sub="العميل يتابع مشروعه بنفسه: المراحل، التحديثات، المطلوب منه، والموافقات." actions={back} />
      <div className="max-w-2xl">
        <Card title="فعّل البوابة للعميل ده">
          {!j.contract_approved ? <p className="text-sm text-ink-500">العقد لسه ما اتعمدش من المالية.</p>
            : !j.account_manager_id ? <p className="text-sm text-ink-500">حوّل العميل لأكاونت مانجر الأول.</p>
            : !m ? <p className="text-sm text-ink-500">الأكاونت مانجر بتاع العميل أو المدير التقني هو اللي يفعّلها.</p> : (
            <CredentialsForm action={portalEnableAction} submit="فعّل البوابة">
              <Hidden name="ops_id" value={id} />
              <Field label="رقم جوال العميل (هيدخل بيه)" name="phone" dir="ltr" required defaultValue={j.client_phone ?? ""} hint="لو العميل عنده حساب من مشروع قبل كده، هيكمل بنفس بياناته." />
              <Field label="اسم المشروع زي ما العميل هيشوفه" name="title" defaultValue={j.client_name} />
              <p className="text-xs leading-6 text-ink-500">هيتعمل للمشروع {""}مراحل افتراضية (تقدر تعدلها بعدين)، وهيظهرلك كلمة مرور مؤقتة مرة واحدة تبعتها للعميل.</p>
            </CredentialsForm>)}
        </Card>
      </div>
    </>
  );

  return (
    <>
      <PageHeader title={`بوابة العميل — ${j.client_name}`} sub={`${j.project.title} · ${j.progress}% · ${cur ? `المرحلة: ${cur.name}` : "كل المراحل خلصت"}`}
        actions={<>{j.account.is_active ? <Badge tone="ok">الدخول شغال</Badge> : <Badge tone="bad">الدخول متوقف</Badge>}{back}</>} />
      <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="أقسام بوابة العميل">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/operations/${id}/portal?tab=${k}`} className={`rounded-md px-3 py-1.5 text-sm font-medium ${k === tab ? "bg-burgundy-600 text-white" : "border border-line bg-white hover:bg-cream"}`}>
            {l}{k === "requests" && pendingReq ? ` (${pendingReq})` : ""}{k === "support" && openTk ? ` (${openTk})` : ""}</Link>))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card title={`المراحل — ${j.progress}% اتنجز`} right={m && cur ? (
            <ActionForm action={portalStageOpAction} submit={`خلصت «${cur.name}» ← اللي بعدها`} className=""><Hidden name="ops_id" value={id} /><Hidden name="op" value="advance" /></ActionForm>) : undefined}>
            <ol className="space-y-2">
              {stages.map((st, i) => (
                <li key={st.id} className={`rounded-lg border p-3 ${st.status === "current" ? "border-burgundy-600 bg-burgundy-50" : st.status === "done" ? "border-ok/30 bg-ok/5" : "border-line"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0"><p className="font-semibold">{i + 1}. {st.name} {st.status === "current" && <Badge tone="brand">الحالية</Badge>}{st.status === "done" && <span className="text-sm text-ok"> ✓</span>}</p>
                      <p className="text-xs text-ink-500">{[st.planned_date ? `متوقعة ${fmtDate(st.planned_date)}` : null, st.done_at ? `خلصت ${fmtDate(st.done_at)}` : st.started_at ? `بدأت ${fmtDate(st.started_at)}` : null, st.tasks ? `${st.tasks_done}/${st.tasks} تاسك` : null].filter(Boolean).join(" · ") || " "}</p></div>
                    {m && (
                      <div className="flex flex-wrap items-center gap-1">
                        {st.status !== "current" && <ActionForm action={portalStageOpAction} submit="خليها الحالية" tone="quiet" className=""><Hidden name="ops_id" value={id} /><Hidden name="stage_id" value={st.id} /><Hidden name="op" value="current" /></ActionForm>}
                        <ActionForm action={portalStageOpAction} submit="↑" tone="quiet" className=""><Hidden name="ops_id" value={id} /><Hidden name="stage_id" value={st.id} /><Hidden name="op" value="up" /></ActionForm>
                        <ActionForm action={portalStageOpAction} submit="↓" tone="quiet" className=""><Hidden name="ops_id" value={id} /><Hidden name="stage_id" value={st.id} /><Hidden name="op" value="down" /></ActionForm>
                      </div>)}
                  </div>
                  {m && (
                    <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-500">تعديل</summary>
                      <div className="mt-2 grid gap-3 md:grid-cols-[1fr_auto]">
                        <ActionForm action={portalStageSaveAction} submit="حفظ" tone="quiet" className="grid gap-2 md:grid-cols-[1fr_10rem_auto] md:items-end">
                          <Hidden name="ops_id" value={id} /><Hidden name="stage_id" value={st.id} />
                          <Field label="الاسم" name="name" defaultValue={st.name} required /><Field label="التاريخ المتوقع" name="planned_date" type="date" defaultValue={st.planned_date ?? ""} />
                        </ActionForm>
                        {st.status !== "current" && <ActionForm action={portalStageOpAction} submit="امسح المرحلة" tone="quiet" className="md:self-end"><Hidden name="ops_id" value={id} /><Hidden name="stage_id" value={st.id} /><Hidden name="op" value="delete" /></ActionForm>}
                      </div></details>)}
                </li>))}
            </ol>
            {m && (
              <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-burgundy-700">+ ضيف مرحلة</summary>
                <ActionForm action={portalStageSaveAction} submit="إضافة" className="mt-3 grid gap-2 md:grid-cols-[1fr_10rem_auto] md:items-end">
                  <Hidden name="ops_id" value={id} /><Field label="اسم المرحلة" name="name" required /><Field label="التاريخ المتوقع" name="planned_date" type="date" />
                </ActionForm></details>)}
            {j.can_toggle && <p className="mt-3 text-xs"><Link href="/operations/portal-stages" className="text-burgundy-700 underline">المراحل الافتراضية لكل المشاريع الجديدة</Link></p>}
            <p className="mt-4 text-xs leading-6 text-ink-500">النسبة اللي العميل بيشوفها: كل مرحلة ليها نفس الوزن، المراحل اللي خلصت كاملة، والمرحلة الحالية بنسبة التاسكات المربوطة بيها اللي اتعمدت (من «التاسكات والموافقات»).</p>
          </Card>
          <div className="space-y-6">
            <Card title="حساب العميل">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-ink-500">رقم الدخول</dt><dd dir="ltr">{j.account.phone}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">آخر دخول</dt><dd>{j.account.last_login_at ? fmtDateTime(j.account.last_login_at) : "لسه مادخلش"}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">كلمة المرور</dt><dd>{j.account.must_change_password ? "مؤقتة (لسه ماغيّرهاش)" : "اختارها بنفسه"}</dd></div>
                {j.account.locked && <p className="text-bad">الحساب مقفول مؤقتًا بسبب محاولات غلط.</p>}
              </dl>
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                {j.is_super && <CredentialsForm action={portalResetAction} submit="كلمة مرور مؤقتة جديدة" tone="quiet" confirm="العميل هيخرج من أي جهاز داخل منه، وهتظهرلك كلمة مؤقتة جديدة تبعتهاله. تكمل؟"><Hidden name="ops_id" value={id} /></CredentialsForm>}
                {!j.is_super && <p className="text-xs text-ink-500">لو العميل نسي كلمة المرور، مدير النظام بيطلعله كلمة مؤقتة جديدة من هنا.</p>}
                {j.can_toggle && <ActionForm action={portalActiveAction} submit={j.account.is_active ? "وقّف دخول العميل" : "رجّع دخول العميل"} tone="quiet" className=""><Hidden name="ops_id" value={id} /><Hidden name="active" value={j.account.is_active ? "0" : "1"} /></ActionForm>}
              </div>
            </Card>
            <Card title="بيانات المشروع">
              {m ? (
                <ActionForm action={portalProjectAction} submit="حفظ" tone="quiet" className="space-y-3">
                  <Hidden name="ops_id" value={id} />
                  <Field label="اسم المشروع" name="title" defaultValue={j.project.title} required />
                  <div className="grid grid-cols-2 gap-3"><Field label="البداية" name="start_date" type="date" defaultValue={j.project.start_date ?? ""} /><Field label="التسليم المتوقع" name="expected_end" type="date" defaultValue={j.project.expected_end ?? ""} /></div>
                </ActionForm>) : <p className="text-sm">{j.project.title}</p>}
              <p className="mt-3 text-xs text-ink-500">اتفعّلت {fmtDateTime(j.project.enabled_at)}{j.project.enabled_by_name ? ` · ${j.project.enabled_by_name}` : ""}</p>
            </Card>
          </div>
        </div>)}

      {tab === "updates" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
          <Card title={`التحديثات اللي العميل شايفها (${j.updates.length})`}>
            {j.updates.length === 0 ? <Empty title="لسه مفيش تحديثات" /> : (
              <ul className="space-y-5">{(j.updates as any[]).map((u) => (
                <li key={u.id} className="border-b border-line pb-4 last:border-0">
                  <p className="font-semibold">{u.title} {u.auto && <span className="text-xs font-normal text-ink-500">(تلقائي)</span>}</p>
                  {u.body && <p className="mt-1 whitespace-pre-wrap text-sm">{u.body}</p>}
                  <p className="mt-1 text-xs text-ink-500">{u.by ?? "—"} · {fmtDateTime(u.at)}</p>
                  {u.messages.length > 0 && <div className="mt-3"><Msgs list={u.messages} /></div>}
                  {m && u.messages.some((x: any) => x.from_client) && <details className="mt-2 text-sm"><summary className="cursor-pointer text-burgundy-700">رد على تعليق العميل</summary><div className="mt-2"><Reply ops={id} kind="update" id={u.id} /></div></details>}
                </li>))}</ul>)}
          </Card>
          {m && <Card title="انشر تحديث للعميل">
            <ActionForm action={portalUpdateAction} submit="انشر" hiddenOnOk={false}>
              <Hidden name="ops_id" value={id} />
              <Field label="العنوان" name="title" required placeholder="مثال: خلصنا تصميم الصفحة الرئيسية" />
              <TextArea label="التفاصيل (اختياري)" name="body" rows={4} />
              <p className="text-xs text-ink-500">هيظهر للعميل فورًا ويوصله إشعار. اكتبه بلغة العميل — مفيش حاجة داخلية.</p>
            </ActionForm></Card>}
        </div>)}

      {tab === "requests" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
          <Card title="المطلوب من العميل">
            {j.requests.length === 0 ? <Empty title="مفيش طلبات" hint="اطلب من العميل اللوجو، الصور، الصلاحيات… من الفورم." /> : (
              <ul className="space-y-4">{(j.requests as any[]).map((r) => (
                <li key={r.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{r.title}</p><p className="text-xs text-ink-500">{r.by} · {fmtDateTime(r.at)}{r.due_date ? ` · مطلوب قبل ${fmtDate(r.due_date)}` : ""}</p></div><Badge tone={REQ[r.status][1]}>{REQ[r.status][0]}</Badge></div>
                  {r.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-500">{r.description}</p>}
                  {r.return_note && r.status === "open" && <p className="mt-2 text-sm text-warn">رجعناه للعميل: {r.return_note}</p>}
                  {r.response && <div className="mt-3 rounded-md bg-burgundy-50 p-3 text-sm"><p className="text-xs text-ink-500">رد العميل · {fmtDateTime(r.responded_at)}</p><p className="whitespace-pre-wrap">{r.response}</p></div>}
                  <FileLinks files={r.files} />
                  {m && r.status === "submitted" && (
                    <div className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
                      <ActionForm action={portalRequestCloseAction} submit="استلمناه ✓" className=""><Hidden name="ops_id" value={id} /><Hidden name="request_id" value={r.id} /><Hidden name="result" value="done" /></ActionForm>
                      <ActionForm action={portalRequestCloseAction} submit="رجّعه للعميل" tone="quiet" className="space-y-2"><Hidden name="ops_id" value={id} /><Hidden name="request_id" value={r.id} /><Hidden name="result" value="return" /><TextArea label="محتاجين إيه تاني؟" name="note" rows={2} required /></ActionForm>
                    </div>)}
                  {m && ["open", "submitted"].includes(r.status) && <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-500">إلغاء الطلب</summary><ActionForm action={portalRequestCloseAction} submit="الغيه" tone="quiet" className="mt-2"><Hidden name="ops_id" value={id} /><Hidden name="request_id" value={r.id} /><Hidden name="result" value="cancel" /></ActionForm></details>}
                </li>))}</ul>)}
          </Card>
          {m && <Card title="اطلب حاجة من العميل">
            <ActionForm action={portalRequestAction} submit="ابعت للعميل" hiddenOnOk={false}>
              <Hidden name="ops_id" value={id} />
              <Field label="المطلوب" name="title" required placeholder="مثال: ابعت اللوجو بجودة عالية" />
              <TextArea label="تفاصيل (اختياري)" name="description" rows={3} />
              <Field label="مطلوب قبل (اختياري)" name="due_date" type="date" />
            </ActionForm></Card>}
        </div>)}

      {tab === "approvals" && (
        <Card title="التاسكات — إيه اللي العميل يشوفه">
          <p className="mb-4 text-sm leading-7 text-ink-500">كل التاسكات داخلية لحد ما تعلّم «يظهر للعميل». العميل بيشوف العنوان والحالة والميعاد والمرحلة والملاحظة اللي تكتبهاله بس — مش اسم الموظف ولا الوقت ولا التعليقات الداخلية. التاسكات اللي «محتاجة موافقة العميل» بتروحله لوحدها أول ما تعتمدها، ويوافق أو يطلب تعديل من البوابة.</p>
          {j.tasks.length === 0 ? <Empty title="مفيش تاسكات" /> : (
            <ul className="divide-y divide-line">{(j.tasks as any[]).map((t) => (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0"><Link href={`/tasks/${t.id}`} className="font-semibold text-burgundy-700 underline">{t.title}</Link>
                    <p className="text-xs text-ink-500">{t.assignee}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ""}{t.needs_client ? " · محتاجة موافقة العميل" : ""}{t.client_decided_at ? ` · رد العميل ${fmtDateTime(t.client_decided_at)}${t.decided_in_portal ? " (من البوابة)" : ""}` : ""}</p></div>
                  <div className="flex items-center gap-2">{(t.client_visible || (t.needs_client && ["client_review", "approved"].includes(t.status))) ? <Badge tone="brand">ظاهر للعميل</Badge> : <Badge>داخلي</Badge>}<Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS[t.status]}</Badge></div>
                </div>
                {t.messages.length > 0 && <div className="mt-2"><Msgs list={t.messages} /></div>}
                {m && (
                  <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-500">إعدادات العميل{t.files.length ? ` · ملفات (${t.files.length})` : ""}</summary>
                    <ActionForm action={portalTaskSetAction} submit="حفظ" tone="quiet" className="mt-2 grid gap-2 md:grid-cols-[auto_12rem_1fr_auto] md:items-end">
                      <Hidden name="ops_id" value={id} /><Hidden name="task_id" value={t.id} />
                      <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="visible" value="1" defaultChecked={t.client_visible} /> يظهر للعميل</label>
                      <label className="text-sm">المرحلة<select name="stage_id" defaultValue={t.stage_id ?? ""} className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2"><option value="">بدون</option>{stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select></label>
                      <Field label="ملاحظة للعميل" name="client_note" defaultValue={t.client_note ?? ""} />
                    </ActionForm>
                    {t.files.length > 0 && <ul className="mt-2 space-y-1">{(t.files as any[]).map((f) => (
                      <li key={f.id} className="flex items-center gap-2">{f.filename} {f.shared ? <span className="text-xs text-ok">اتشارك ✓</span> :
                        <ActionForm action={portalShareFileAction} submit="شاركه مع العميل" tone="quiet" className=""><Hidden name="ops_id" value={id} /><Hidden name="attachment_id" value={f.id} /></ActionForm>}</li>))}</ul>}
                    {(t.client_visible || t.needs_client) && <div className="mt-2"><Reply ops={id} kind="task" id={t.id} label="ابعت رسالة للعميل عن التاسك ده" /></div>}
                  </details>)}
              </li>))}</ul>)}
        </Card>)}

      {tab === "support" && (
        <Card title={`طلبات الدعم (${j.tickets.length})`}>
          {j.tickets.length === 0 ? <Empty title="مفيش طلبات دعم من العميل" /> : (
            <ul className="space-y-4">{(j.tickets as any[]).map((t) => (
              <li key={t.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{t.subject}</p><Badge tone={TK[t.status][1]}>{TK[t.status][0]}</Badge></div>
                <p className="mb-2 text-xs text-ink-500">اتفتح {fmtDateTime(t.at)}{t.closed_by ? ` · قفله ${t.closed_by === "client" ? "العميل" : "الفريق"}` : ""}</p>
                <Msgs list={t.messages} /><FileLinks files={t.files} />
                {m && t.status !== "closed" && (
                  <div className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-[1fr_auto] md:items-end">
                    <Reply ops={id} kind="ticket" id={t.id} />
                    <ActionForm action={portalTicketCloseStaffAction} submit="قفل الطلب" tone="quiet" className=""><Hidden name="ops_id" value={id} /><Hidden name="ticket_id" value={t.id} /></ActionForm>
                  </div>)}
              </li>))}</ul>)}
        </Card>)}

      {tab === "files" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
          <Card title={`ملفات المشروع (${j.files.length})`}>
            {j.files.length === 0 ? <Empty title="مفيش ملفات" /> : (
              <ul className="divide-y divide-line">{(j.files as any[]).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="min-w-0"><a href={`/portal-files/${f.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-burgundy-700 underline">{f.filename}</a>
                    <span className="block text-xs text-ink-500">{f.by} · {fmtDateTime(f.at)}</span></span>
                  {f.from_client ? <Badge tone="brand">من العميل</Badge> : m ? (
                    <ActionForm action={portalFileVisibleAction} submit={f.visible ? "ظاهر للعميل — اخفيه" : "داخلي — اظهره للعميل"} tone="quiet" className="">
                      <Hidden name="ops_id" value={id} /><Hidden name="file_id" value={f.id} /><Hidden name="visible" value={f.visible ? "0" : "1"} /></ActionForm>) : <Badge>{f.visible ? "ظاهر للعميل" : "داخلي"}</Badge>}
                </li>))}</ul>)}
          </Card>
          {m && <Card title="ارفع ملف">
            <ActionForm action={portalStaffUploadAction} submit="رفع">
              <Hidden name="ops_id" value={id} />
              <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx" aria-label="الملف" className="w-full rounded-md border border-line px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="visible" value="1" /> يظهر للعميل (من غيرها الملف داخلي)</label>
            </ActionForm></Card>}
        </div>)}

      {tab === "log" && (
        <Card title="سجل كل اللي حصل في البوابة">
          {j.events.length === 0 ? <Empty title="لسه مفيش" /> : (
            <ul className="divide-y divide-line text-sm">{(j.events as any[]).map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span><b>{e.by ?? "النظام"}</b> · {e.action}{e.detail ? <span className="text-ink-500"> — {e.detail}</span> : null}</span><time className="text-xs text-ink-500">{fmtDateTime(e.at)}</time></li>))}</ul>)}
        </Card>)}
    </>
  );
}
