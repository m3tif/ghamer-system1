import Link from "next/link";
import { can, requirePerm, requireSession } from "@/lib/auth";
import { addedCounts, employeeList, hasManualOrder, listLeads, myOutcomes, salesReps } from "@/server/data";
import { Badge, ButtonLink, Empty, PageHeader, Table, td } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { QuickAdd } from "@/components/quick-add";
import { LeadsTable } from "@/components/leads-table";
import { CopyToolbar } from "@/components/copy-toolbar";
import { MoreRows } from "@/components/leads-more";
import { LeadsHScroll } from "@/components/leads-hscroll";
import { LeadsMarks } from "@/components/leads-marks";
import { normalizeLeadQuery } from "@/server/leads-view";
import { DeleteMonth, HideMonth } from "@/components/leads-cells";
import { inputCls } from "@/components/forms";
import { fmtDate, fmtDateTime, getTimezone, tzLabel } from "@/lib/format";
import { HANDOFF_STATUS, HANDOFF_TONE, LEAD_STATUS, MEETING_STATUS, TEMPERATURE } from "@/lib/labels";

export const metadata = { title: "العملاء اللي ضفتهم" };
export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; month?: string; creator?: string; sales?: string; tab?: string; handed?: string; temp?: string; sort?: string; dir?: string; hidden?: string };
const CHUNK = 40;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession(); await requirePerm(s, "leads.view");
  const sp = await searchParams;
  const manualOrder = await hasManualOrder(s.userId);
  const f = normalizeLeadQuery(s, sp, manualOrder);
  const { employee, wide, canHide, month, creator, sales: salesF, temp, status, sort, dir, hidden: hiddenF } = f;
  const isTele = s.role === "tele_sales";
  const tab = sp.tab === "handed" && can(s, "leads.handoff") ? "handed" : sp.tab === "received" && isTele ? "received" : "mine";
  const inList = tab !== "handed";
  const emps = wide ? (await employeeList(s.userId)).filter((e: any) => ["tele_sales", "sales_rep", "tele_sales_manager", "sales_manager"].includes(e.role_code)) : [];
  const canHand = can(s, "leads.handoff");
  const [list, counts, outcomes, reps] = await Promise.all([
    inList ? listLeads(s.userId, { q: f.q, status, size: CHUNK, offset: 0, month, creator, sales: salesF, temp, sort, dir, hidden: hiddenF, scope: f.scope }) : { rows: [], total: 0 },
    employee ? addedCounts(s.userId, s.userId) : null,
    tab === "handed" ? myOutcomes(s.userId) : [],
    canHand ? salesReps(s.userId) : [],
  ]);
  const { rows, total } = list;
  const tz = tzLabel(getTimezone());
  const q = { q: f.q, status, month: sp.month, creator, sales: salesF, temp, sort, dir, hidden: hiddenF, tab: tab === "received" ? "received" : undefined };
  const filtered = !!(sp.q || status || sp.month || temp || creator || salesF || hiddenF);
  const tabCls = (on: boolean) => `rounded-md px-3.5 py-2 text-sm ${on ? "bg-burgundy-600 font-semibold text-white" : "border border-line bg-white hover:bg-cream"}`;
  return (
    <>
      <PageHeader title={tab === "received" ? "الداتا المستلمة" : employee ? "العملاء اللي ضفتهم" : "العملاء"}
        sub={tab !== "received" && counts && employee ? `أضفت ${counts.total} عميل · ${counts.this_month} هذا الشهر · حوّلت ${counts.handed_off} (قُبل ${counts.accepted}، رُفض ${counts.rejected})` : tab === "received" ? `${total} عميل وصلوك من الإدارة عن طريق توزيع الداتا (منفصلين عن اللي ضفتهم بنفسك)` : tab === "mine" ? `${total} سجل ضمن صلاحياتك` : undefined}
        actions={can(s, "leads.create") ? <ButtonLink href="/leads/new">+ تسجيل عميل جديد</ButtonLink> : null} />
      {sp.handed && <p role="status" className="mb-4 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">تم إرسال العميل إلى السيلز. لا يُعتبر مقبولًا حتى يقرر السيلز، وستصلك نتيجة القرار في الإشعارات.</p>}
      {(canHand || isTele) && (
        <div className="mb-4 flex gap-2" role="tablist">
          <Link href="/leads" role="tab" aria-selected={tab === "mine"} className={tabCls(tab === "mine")}>{isTele ? "العملاء اللي ضفتهم" : "عملائي الحاليون"}</Link>
          {isTele && <Link href="/leads?tab=received" role="tab" aria-selected={tab === "received"} className={tabCls(tab === "received")}>الداتا المستلمة</Link>}
          <Link href="/leads?tab=handed" role="tab" aria-selected={tab === "handed"} className={tabCls(tab === "handed")}>تم تحويلها إلى السيلز</Link>
        </div>)}
      {inList ? (<>
        {tab === "mine" && can(s, "leads.create") && <QuickAdd today={fmtDate(new Date())} />}
        <form className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" role="search">
          {tab === "received" && <input type="hidden" name="tab" value="received" />}
          <SearchBox className="col-span-2 sm:min-w-64 sm:max-w-md sm:flex-1" />
          <select name="status" defaultValue={status ?? ""} className={inputCls + " w-full sm:w-auto"} aria-label="الحالة">
            <option value="">كل الحالات</option>{Object.entries(LEAD_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select name="temp" defaultValue={temp ?? ""} className={inputCls + " w-full sm:w-auto"} aria-label="درجة العميل">
            <option value="">كل الدرجات</option>{Object.entries(TEMPERATURE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input type="month" name="month" defaultValue={sp.month} className={inputCls + " w-full sm:w-auto"} aria-label="الشهر والسنة" />
          {wide && emps.length > 0 && (
            <select name="creator" defaultValue={creator ?? ""} className={inputCls + " w-full sm:w-auto"} aria-label="الموظف الذي أضاف">
              <option value="">كل الموظفين (Hunter)</option>{emps.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>)}
          {wide && emps.length > 0 && (
            <select name="sales" defaultValue={salesF ?? ""} className={inputCls + " w-full sm:w-auto"} aria-label="السيلز المسؤول">
              <option value="">كل السيلز</option>{emps.filter((e: any) => ["sales_rep", "sales_manager"].includes(e.role_code)).map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>)}
          {canHide && (
            <select name="hidden" defaultValue={hiddenF ?? ""} className={inputCls + " w-full sm:w-auto"} aria-label="الإخفاء">
              <option value="">العملاء الظاهرون</option><option value="hidden">المخفيون فقط</option><option value="all">الظاهرون + المخفيون</option>
            </select>)}
          <input type="hidden" name="sort" value={sort} /><input type="hidden" name="dir" value={dir} />
          <button className="rounded-md bg-burgundy-600 px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy-700">تصفية</button>
          {filtered && <Link href="/leads" className="text-sm text-burgundy-600 underline">مسح الفلاتر</Link>}
        </form>
        <p className="mb-2 text-xs text-ink-500">{total} نتيجة · التواريخ بـ{tz} · اضغط على اسم العميل لفتحه، وعلى الحالة أو الدرجة أو الشهر لتصفية الجدول، وعلى الملاحظات لتعديلها.</p>
        {canHide && creator && month && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
            <span className="text-ink-500">إجراء جماعي لهذا الموظف والشهر:</span>
            <HideMonth emp={creator} empName={emps.find((e: any) => e.id === creator)?.full_name ?? "الموظف"} month={sp.month!} hide={hiddenF !== "hidden"} count={total} />
            {s.role === "super_admin" && <DeleteMonth emp={creator} empName={emps.find((e: any) => e.id === creator)?.full_name ?? "الموظف"} month={sp.month!} count={total} />}
          </div>)}
        {rows.length > 0 && (
          // both tool bars stay on screen while scrolling the list
          <div className="sticky top-14 z-20 mb-2 space-y-1.5 rounded-lg bg-cream/95 pb-1 shadow-md backdrop-blur lg:top-2" data-testid="leads-tools">
            <CopyToolbar total={Number(total)} />
            <LeadsMarks manualActive={sort === "manual"} />
          </div>)}
        {rows.length > 0 && <LeadsHScroll />}
        {rows.length === 0 ? <Empty title="لا توجد نتائج" hint={filtered ? "جرّب تغيير البحث أو الفلاتر." : "سجّل أول عميل ليظهر هنا."} /> : (
          <LeadsTable rows={rows} q={q} sort={sort} dir={dir} canHide={canHide} canDelete={s.role === "super_admin"} me={s.userId} canEdit={can(s, "leads.edit")} canSend={canHand} reps={reps} tz={tz} wide={wide}
            more={<MoreRows key={JSON.stringify(q) + ':' + total} query={q} initialCount={rows.length} total={Number(total)} stamp={Date.now()} />} />)}
      </>) : outcomes.length === 0 ? <Empty title="لم تحوّل أي عميل بعد" hint="أرسل العميل للسيلز من زر «إرسال للسيلز» في الجدول أو من صفحة العميل." /> : (
        <Table head={["العميل", "وقت التحويل", "حالة التحويل", "السيلز", "وقت القرار", "الاجتماع", "نتيجة الصفقة"]}>
          {outcomes.map((o: any) => (
            <tr key={o.lead_id}><td className={td + " font-medium"}>{o.client_name}</td><td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(o.handed_off_at)}</td>
              <td className={td}><Badge tone={HANDOFF_TONE[o.handoff_status] ?? "neutral"}>{HANDOFF_STATUS[o.handoff_status] ?? "—"}</Badge></td>
              <td className={td}>{o.to_name ?? "—"}</td><td className={td + " whitespace-nowrap text-ink-500"}>{fmtDateTime(o.decided_at)}</td>
              <td className={td}>{o.meeting_status ? MEETING_STATUS[o.meeting_status] : "—"}</td>
              <td className={td}>{o.deal_outcome === "won" ? <Badge tone="ok">تم التعاقد</Badge> : o.deal_outcome === "lost" ? <Badge tone="bad">خسرناه</Badge> : o.deal_outcome === "open" ? <Badge tone="warn">قيد التفاوض</Badge> : "—"}</td></tr>))}
        </Table>)}
    </>
  );
}
