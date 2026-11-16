import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { client360 } from "@/server/data";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMins, fmtSar } from "@/lib/format";
import { CONTRACT_STATUS, CONTRACT_STATUS_TONE, DEAL_STAGE, LEAD_STATUS, MEETING_STATUS, PAYMENT_METHOD, SOURCES, TASK_STATUS, TASK_STATUS_TONE } from "@/lib/labels";

export const metadata = { title: "ملف العميل الكامل" };
export const dynamic = "force-dynamic";

const EVENT = (e: any): [string, string | null] => {
  switch (e.kind) {
    case "client_created": return ["تسجيل العميل", null];
    case "activity": return [e.a ? `الحالة: ${LEAD_STATUS[e.a] ?? e.a}` : "ملاحظة / نشاط", e.b];
    case "meeting": return [`اجتماع — ${MEETING_STATUS[e.a] ?? e.a}`, null];
    case "stage": return [`الصفقة: ${DEAL_STAGE[e.a] ?? e.a}`, e.b];
    case "contract_created": return [`إنشاء العقد ${e.a}`, null];
    case "contract_approved": return [`اعتماد مالي للعقد ${e.a}`, null];
    case "ops_assigned": return [`تحويل للأكاونت مانجر: ${e.a}`, e.b];
    case "kickoff": return ["اجتماع الـ Kickoff", null];
    case "task_created": return [`تاسك جديد: ${e.a}`, null];
    case "task_approved": return [`اعتماد تاسك: ${e.a}`, null];
    default: return [e.kind, e.b];
  }
};

export default async function Client360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await client360(s.userId, id);
  if (!d) notFound();
  const c = d.client, ops = d.ops[0];
  const row = (k: string, v: React.ReactNode) => (<div className="flex justify-between gap-3"><dt className="shrink-0 text-ink-500">{k}</dt><dd className="min-w-0 break-words text-end" dir="auto">{v || "—"}</dd></div>);
  return (
    <>
      <PageHeader title={c.name} sub={`ملف العميل الكامل${c.business_name ? " · " + c.business_name : ""}`}
        actions={ops ? <Link href={`/operations/${ops.id}`} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">التاسكات والتشغيل</Link> : undefined} />
      {ops && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="التاسكات المعتمدة" value={`${ops.tasks_done} / ${ops.tasks_all}`} />
          <Stat label="تاسكات متأخرة" value={ops.tasks_late} tone={ops.tasks_late ? "bad" : undefined} />
          <Stat label="ساعات الشغل" value={fmtMins(ops.minutes)} />
          <Stat label="المطلوب من العميل" value={`${ops.checklist_done} / ${ops.checklist_all}`} />
        </div>)}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="العقود">
            {d.contracts.length === 0 ? <p className="text-sm text-ink-500">مفيش عقود.</p> : (
              <ul className="space-y-3 text-sm">{(d.contracts as any[]).map((k) => (
                <li key={k.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {d.show_money ? <Link href={`/contracts/${k.id}`} className="font-semibold text-burgundy-700 underline" dir="ltr">{k.contract_no}</Link> : <span className="font-semibold" dir="ltr">{k.contract_no}</span>}
                    <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Badge></div>
                  <div className="mt-2 flex flex-wrap gap-1.5">{(k.packages as string[]).map((p) => <span key={p} className="rounded-md border border-burgundy-600/30 bg-burgundy-600/5 px-2 py-0.5 text-xs font-medium">✓ {p}</span>)}</div>
                  <p className="mt-2 text-ink-500">{k.start_date ? `${fmtDate(k.start_date)} ← ${k.end_date ? fmtDate(k.end_date) : "—"}` : "—"} · السيلز: {k.sales ?? "—"}{k.tele ? ` · التيلي: ${k.tele}` : ""}</p>
                  {d.show_money && <p className="mt-1 font-semibold tabular-nums">{fmtSar(k.total)}{k.payment_method ? ` · ${PAYMENT_METHOD[k.payment_method] ?? k.payment_method}` : ""}</p>}
                </li>))}</ul>)}
          </Card>
          <Card title={`التاسكات (${d.tasks.length})`}>
            {d.tasks.length === 0 ? <p className="text-sm text-ink-500">مفيش تاسكات لسه.</p> : (
              <ul className="divide-y divide-line text-sm">{(d.tasks as any[]).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/tasks/${t.id}`} className="font-medium text-burgundy-700 underline">{t.title}</Link> <span className="text-xs text-ink-500">· {t.assignee}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ""}</span></span>
                  <span className="flex items-center gap-2">{t.delivery_link && <a href={t.delivery_link} target="_blank" rel="noopener noreferrer" className="text-xs underline">التسليم</a>}<Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS[t.status]}</Badge></span>
                </li>))}</ul>)}
          </Card>
          <Card title="الاجتماعات">
            {d.meetings.length === 0 ? <p className="text-sm text-ink-500">مفيش اجتماعات.</p> : (
              <ul className="divide-y divide-line text-sm">{(d.meetings as any[]).map((m, i) => (
                <li key={i} className="py-2"><div className="flex justify-between gap-2"><span>{fmtDateTime(m.at)}</span><span className="font-medium">{MEETING_STATUS[m.status] ?? m.status}</span></div>
                  <div className="text-xs text-ink-500">التيلي: {m.tele ?? "—"} · السيلز: {m.sales ?? "—"}</div>{m.notes && <p className="mt-1 whitespace-pre-wrap">{m.notes}</p>}</li>))}</ul>)}
          </Card>
          <Card title="كل اللي حصل مع العميل (الأحدث فوق)">
            <ol className="space-y-3 text-sm">{(d.timeline as any[]).map((e, i) => { const [t, note] = EVENT(e); return (
              <li key={i} className="border-s-2 border-burgundy-600/30 ps-3"><p className="font-medium">{t}</p>{note && <p className="whitespace-pre-wrap text-ink-500">{note}</p>}
                <p className="text-xs text-ink-500">{fmtDateTime(e.at)}{e.by ? ` · ${e.by}` : ""}</p></li>); })}</ol>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title="بيانات العميل">
            <dl className="space-y-1.5 text-sm">
              {row("النشاط", c.business_name)}{row("المجال", c.industry)}{row("المدينة", [c.city, c.country].filter(Boolean).join(" — "))}{row("الشخص المسؤول", c.contact_person)}
              {row("الجوال", (d.phones as string[]).map((p) => <div key={p} dir="ltr">{p}</div>))}
              {row("المتجر", (d.stores as string[]).map((u) => <div key={u}><a href={/^https?:/.test(u) ? u : `https://${u}`} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all underline">{u}</a></div>))}
              {row("المصدر", SOURCES[c.source] ?? c.source)}{row("أضافه", c.creator)}{row("بداية العلاقة", fmtDate(c.created_at))}
            </dl>
          </Card>
          <Card title="المسؤولين">
            <dl className="space-y-1.5 text-sm">
              {(d.leads as any[]).slice(0, 1).map((l) => <div key={l.id} className="space-y-1.5">{row("التيلي سيلز (المصدر)", l.creator)}{row("المسؤول الحالي", l.owner)}{row("السيلز", l.sales)}{row("حالة العميل", LEAD_STATUS[l.status] ?? l.status)}</div>)}
              {(d.deals as any[]).slice(-1).map((x) => <div key={x.id} className="space-y-1.5">{row("مرحلة الصفقة", DEAL_STAGE[x.stage] ?? x.stage)}{row("اللي قفل الصفقة", x.closer)}</div>)}
              {ops && <>{row("الأكاونت مانجر", ops.account_manager)}{row("ميعاد الـ Kickoff", ops.kickoff_at ? fmtDateTime(ops.kickoff_at) : null)}</>}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
