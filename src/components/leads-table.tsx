import Link from "next/link";
import { Badge } from "@/components/ui";
import { CopyPhone, DeleteLead, HideLead, QuickEdit, SendToSales } from "@/components/leads-cells";
import { fmtDate, fmtDateTime, toLocalInput } from "@/lib/format";
import { hostOf, safeHttpUrl } from "@/lib/url";
import { LEAD_STATUS, LEAD_STATUS_TONE, TEMPERATURE, TEMPERATURE_TONE } from "@/lib/labels";
import type { LeadRow } from "@/server/data";

type Q = Record<string, string | undefined>;
const th = "whitespace-nowrap border-b border-l border-white/10 bg-charcoal px-2.5 py-2 text-start text-xs font-semibold text-white";
const cell = "border-b border-l border-line px-2.5 py-1 align-middle text-[13px] leading-5";
const SENDABLE_DEAD = ["Not Interested", "Invalid Contact", "Pending Sales Review", "Accepted by Sales", "Meeting Scheduled", "Meeting Completed"];

/** Builds a /leads link that keeps the current filters and changes `over` (page always resets). */
const href = (base: Q, over: Q) => {
  const merged: Q = { ...base, ...over, page: undefined };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  return `/leads${p.toString() ? `?${p}` : ""}`;
};
const chip = "rounded-full outline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2";

function SortTh({ label, field, q, sort, dir, className = "" }: { label: string; field?: string; q: Q; sort: string; dir: string; className?: string }) {
  if (!field) return <th scope="col" className={`${th} ${className}`}>{label}</th>;
  const on = sort === field;
  const nextDir = on && dir === "asc" ? "desc" : "asc";
  return (
    <th scope="col" aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"} className={`${th} ${className}`}>
      <Link href={href({ ...q, sort: undefined, dir: undefined }, { sort: field, dir: nextDir })} className="inline-flex items-center gap-1 hover:underline">
        {label}<span aria-hidden className={on ? "text-amber-300" : "opacity-40"}>{on ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </Link>
    </th>
  );
}

export type RowsCtx = { q: Q; canEdit: boolean; canSend: boolean; reps: { id: string; full_name: string }[]; wide: boolean; canHide: boolean; canDelete?: boolean };

/** Table rows only (used for the first chunk and for the chunks loaded while scrolling). */
export function LeadRows({ rows, startIndex = 0, q, canEdit, canSend, reps, wide, canHide, canDelete = false }: RowsCtx & { rows: LeadRow[]; startIndex?: number }) {
  return (<>{rows.map((r, i0) => {
            const i = i0 + startIndex;
            const url = safeHttpUrl(r.store_url);
            const month = toLocalInput(r.created_at).slice(0, 7);
            const followLabel = r.next_followup_at ? toLocalInput(r.next_followup_at).replace("T", " ") : undefined;
            const zebra = r.hidden_at ? "bg-bad/5 opacity-75" : i % 2 ? "bg-cream/40" : "bg-white";
            const sendable = canSend && !r.handed_off && !SENDABLE_DEAD.includes(r.lead_status);
            const editable = canEdit;
            return (
              <tr key={r.id} data-row data-lead={r.id} data-name={r.name} data-phone={r.phone ?? ""} data-store={r.store_url ?? ""} data-status={LEAD_STATUS[r.lead_status] ?? r.lead_status}
                data-notes={r.call_notes ?? ""} data-creator={r.creator_name ?? ""} data-date={fmtDate(r.created_at)} className={`${zebra} hover:bg-burgundy-600/5`}>
                <td data-col="name" data-color={r.colors?.name} className={`${cell} sticky right-0 z-10 min-w-52 ${zebra} font-semibold`}>
                  <div className="flex items-center gap-1.5">
                    <span className="flex shrink-0 items-center gap-0.5 text-ink-300 print:hidden">
                      <span data-drag-handle draggable="true" aria-hidden title="اسحب لتغيير الترتيب" className="cursor-grab select-none text-sm leading-none hover:text-burgundy-600 active:cursor-grabbing">⠿</span>
                      <span className="flex flex-col leading-[9px]">
                        <button type="button" data-move="up" aria-label="تحريك لأعلى" title="تحريك لأعلى" className="text-[8px] leading-[9px] hover:text-burgundy-600">▲</button>
                        <button type="button" data-move="down" aria-label="تحريك لأسفل" title="تحريك لأسفل" className="text-[8px] leading-[9px] hover:text-burgundy-600">▼</button>
                      </span>
                    </span>
                    <input type="checkbox" className="row-sel h-4 w-4 shrink-0 accent-burgundy-600" aria-label={`تحديد الصف ${i + 1}`} />
                    <span data-idx className="w-5 shrink-0 text-start text-[11px] font-normal text-ink-300" aria-hidden>{i + 1}</span>
                    <Link href={`/leads/${r.id}`} className="truncate text-burgundy-600 hover:underline">{r.name}</Link>
                  </div>
                  {r.business_name && <div className="ps-[3.6rem] text-[11px] font-normal text-ink-500">{r.business_name}</div>}
                  {r.hidden_at && <div className="mt-0.5"><Badge tone="bad">مخفي عن الموظفين</Badge><span className="ms-1 text-[11px] font-normal text-ink-500" title={r.hidden_reason ?? ""}>{r.hidden_by_name}</span></div>}
                </td>
                <td data-col="store" data-color={r.colors?.store} className={`${cell} max-w-56`}>
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" title={url} className="block truncate text-burgundy-600 underline">{hostOf(url)}</a>
                    : r.store_url ? <span dir="ltr" className="block truncate text-ink-500" title="رابط غير صالح للفتح">{r.store_url}</span> : <span className="text-ink-300">—</span>}
                </td>
                <td data-col="phone" data-color={r.colors?.phone} className={`${cell} whitespace-nowrap`}>{r.phone ? <CopyPhone phone={r.phone} /> : <span className="text-ink-300">—</span>}</td>
                <td data-col="hunter" data-color={r.colors?.hunter} className={`${cell} whitespace-nowrap`}>
                  {wide ? <Link href={href(q, { creator: r.original_creator_id })} className="hover:text-burgundy-600 hover:underline" title="تصفية بعملاء هذا الموظف">{r.creator_name}</Link> : r.creator_name}
                </td>
                <td data-col="date" data-color={r.colors?.date} className={`${cell} whitespace-nowrap`}>
                  <Link href={href(q, { month })} className="hover:text-burgundy-600 hover:underline" title="تصفية بنفس الشهر">{fmtDate(r.created_at)}</Link>
                </td>
                <td data-col="status" data-color={r.colors?.status} className={cell}>
                  <Link href={href(q, { status: r.lead_status })} className={chip} title="تصفية بهذه الحالة"><Badge tone={LEAD_STATUS_TONE[r.lead_status]}>{LEAD_STATUS[r.lead_status] ?? r.lead_status}</Badge></Link>
                </td>
                <td data-col="notes" data-color={r.colors?.notes} className={`${cell} max-w-72`}>
                  {editable ? (
                    <QuickEdit lead={{ id: r.id, name: r.name, lead_status: r.lead_status, lead_temperature: r.lead_temperature, call_notes: r.call_notes, next_followup_at: r.next_followup_at, handed_off: r.handed_off }}
                      followupLabel={followLabel} className="!block !w-full !whitespace-normal !border-transparent !bg-transparent !px-1 !py-0 !text-start !font-normal hover:!bg-cream">
                      {r.call_notes ? <span className="line-clamp-1 text-start">{r.call_notes}</span> : <span className="text-ink-300">＋ أضف ملاحظة</span>}
                    </QuickEdit>
                  ) : r.call_notes ? <span className="line-clamp-1">{r.call_notes}</span> : <span className="text-ink-300">—</span>}
                </td>
                <td data-col="dup" data-color={r.colors?.dup} className={`${cell} whitespace-nowrap`}>
                  {r.dup_attempts > 0
                    ? <Link href={`/leads/${r.id}`} title="عدد محاولات تسجيل هذا العميل مرة أخرى"><Badge tone="warn">مكرر · {r.dup_attempts} محاولة</Badge></Link>
                    : <Badge tone="ok">فريد</Badge>}
                </td>
                <td data-col="time" data-color={r.colors?.time} className={`${cell} whitespace-nowrap text-ink-500`}>{fmtDateTime(r.created_at)}</td>
                <td data-col="temp" data-color={r.colors?.temp} className={cell}>
                  {r.lead_temperature
                    ? <Link href={href(q, { temp: r.lead_temperature })} className={chip} title="تصفية بهذه الدرجة"><Badge tone={TEMPERATURE_TONE[r.lead_temperature]}>{TEMPERATURE[r.lead_temperature]}</Badge></Link>
                    : <span className="text-ink-300">—</span>}
                </td>
                <td data-col="sales" data-color={r.colors?.sales} className={`${cell} whitespace-nowrap`}>
                  {r.sales_name ? (wide && r.assigned_sales_id ? <Link href={href(q, { sales: r.assigned_sales_id })} className="hover:text-burgundy-600 hover:underline">{r.sales_name}</Link> : r.sales_name) : <span className="text-ink-300">—</span>}
                </td>
                <td data-col="followup" data-color={r.colors?.followup} className={`${cell} whitespace-nowrap`}>
                  {r.next_followup_at ? <span className={new Date(r.next_followup_at) < new Date() ? "font-semibold text-bad" : ""}>{fmtDateTime(r.next_followup_at)}</span> : <span className="text-ink-300">—</span>}
                </td>
                <td data-col="actions" data-color={r.colors?.actions} className={`${cell} whitespace-nowrap`}>
                  <div className="flex items-center gap-1.5">
                    <Link href={`/leads/${r.id}`} className="rounded-md border border-line bg-white px-2 py-0.5 text-xs font-medium hover:bg-cream">فتح</Link>
                    {canHide && <HideLead leadId={r.id} name={r.name} hidden={!!r.hidden_at} className="!px-2 !py-0.5 !text-xs" />}
                    {canDelete && <DeleteLead clientId={r.client_id} name={r.name} className="!px-2 !py-0.5 !text-xs" />}
                    {sendable && <SendToSales leadId={r.id} name={r.name} currentStatus={r.lead_status} reps={reps} className="!px-2 !py-0.5 !text-xs" />}
                  </div>
                </td>
              </tr>);
          })}</>);
}

export function LeadsTable({ rows, q, sort, dir, tz, more, ...ctx }: RowsCtx & { rows: LeadRow[]; sort: string; dir: string; tz: string; more?: React.ReactNode }) {
  return (
    <div id="leads-table" className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm" tabIndex={0} aria-label="جدول العملاء">
      <table className="w-full min-w-[1480px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <SortTh label="العميل" field="name" q={q} sort={sort} dir={dir} className="sticky right-0 z-30 min-w-52" />
            <SortTh label="رابط المتجر / المصدر" q={q} sort={sort} dir={dir} />
            <SortTh label="رقم الهاتف" q={q} sort={sort} dir={dir} />
            <SortTh label="Hunter (أضافه)" q={q} sort={sort} dir={dir} />
            <SortTh label="تاريخ الـ Hunt" field="created" q={q} sort={sort} dir={dir} />
            <SortTh label="الحالة" field="status" q={q} sort={sort} dir={dir} />
            <SortTh label="الملاحظات" q={q} sort={sort} dir={dir} className="min-w-64" />
            <SortTh label="حالة التكرار" q={q} sort={sort} dir={dir} />
            <SortTh label={`وقت التسجيل (${tz})`} q={q} sort={sort} dir={dir} />
            <SortTh label="الدرجة" field="temperature" q={q} sort={sort} dir={dir} />
            <SortTh label="السيلز المسؤول" q={q} sort={sort} dir={dir} />
            <SortTh label="المتابعة القادمة" field="followup" q={q} sort={sort} dir={dir} />
            <SortTh label="إجراءات" q={q} sort={sort} dir={dir} />
          </tr>
        </thead>
        <tbody>
          <LeadRows rows={rows} q={q} {...ctx} />
          {more}
        </tbody>
      </table>
    </div>
  );
}
