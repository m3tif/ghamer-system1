import Link from "next/link";
import { Badge } from "@/components/ui";
import { CopyPhone, DeleteLead, HideLead, QuickEdit, SendToSales } from "@/components/leads-cells";
import { fmtDate, fmtDateTime, toLocalInput } from "@/lib/format";
import { hostOf, safeHttpUrl } from "@/lib/url";
import { LEAD_STATUS, LEAD_STATUS_TONE, TEMPERATURE, TEMPERATURE_TONE } from "@/lib/labels";
import type { LeadRow } from "@/server/data";

type Q = Record<string, string | undefined>;
const th = "sticky top-0 z-20 whitespace-nowrap border-b border-l border-white/10 bg-charcoal px-3 py-2.5 text-start text-xs font-semibold text-white";
const cell = "border-b border-l border-line px-3 py-2 align-middle text-sm";
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

export function LeadsTable({ rows, q, sort, dir, canEdit, canSend, reps, tz, wide, followLabels, canHide, canDelete = false }: {
  rows: LeadRow[]; q: Q; sort: string; dir: string; canEdit: boolean; canSend: boolean; reps: { id: string; full_name: string }[]; tz: string; wide: boolean;
  followLabels: Record<string, string>; canHide: boolean; canDelete?: boolean;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-line bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 290px)" }} tabIndex={0} aria-label="جدول العملاء">
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
          {rows.map((r, i) => {
            const url = safeHttpUrl(r.store_url);
            const month = toLocalInput(r.created_at).slice(0, 7);
            const zebra = r.hidden_at ? "bg-bad/5 opacity-75" : i % 2 ? "bg-cream/40" : "bg-white";
            const sendable = canSend && !r.handed_off && !SENDABLE_DEAD.includes(r.lead_status);
            const editable = canEdit;
            return (
              <tr key={r.id} className={`${zebra} hover:bg-burgundy-600/5`}>
                <td className={`${cell} sticky right-0 z-10 min-w-52 ${zebra} font-semibold`}>
                  <Link href={`/leads/${r.id}`} className="text-burgundy-600 hover:underline">{r.name}</Link>
                  {r.business_name && <div className="text-xs font-normal text-ink-500">{r.business_name}</div>}
                  {r.hidden_at && <div className="mt-0.5"><Badge tone="bad">مخفي عن الموظفين</Badge><span className="ms-1 text-[11px] font-normal text-ink-500" title={r.hidden_reason ?? ""}>{r.hidden_by_name}</span></div>}
                </td>
                <td className={`${cell} max-w-56`}>
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" title={url} className="block truncate text-burgundy-600 underline">{hostOf(url)}</a>
                    : r.store_url ? <span dir="ltr" className="block truncate text-ink-500" title="رابط غير صالح للفتح">{r.store_url}</span> : <span className="text-ink-300">—</span>}
                </td>
                <td className={`${cell} whitespace-nowrap`}>{r.phone ? <CopyPhone phone={r.phone} /> : <span className="text-ink-300">—</span>}</td>
                <td className={`${cell} whitespace-nowrap`}>
                  {wide ? <Link href={href(q, { creator: r.original_creator_id })} className="hover:text-burgundy-600 hover:underline" title="تصفية بعملاء هذا الموظف">{r.creator_name}</Link> : r.creator_name}
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  <Link href={href(q, { month })} className="hover:text-burgundy-600 hover:underline" title="تصفية بنفس الشهر">{fmtDate(r.created_at)}</Link>
                </td>
                <td className={cell}>
                  <Link href={href(q, { status: r.lead_status })} className={chip} title="تصفية بهذه الحالة"><Badge tone={LEAD_STATUS_TONE[r.lead_status]}>{LEAD_STATUS[r.lead_status] ?? r.lead_status}</Badge></Link>
                </td>
                <td className={`${cell} max-w-72`}>
                  {editable ? (
                    <QuickEdit lead={{ id: r.id, name: r.name, lead_status: r.lead_status, lead_temperature: r.lead_temperature, call_notes: r.call_notes, next_followup_at: r.next_followup_at, handed_off: r.handed_off }}
                      followupLabel={followLabels[r.id]} className="!block !w-full !whitespace-normal !border-transparent !bg-transparent !p-1 !text-start !font-normal hover:!bg-cream">
                      {r.call_notes ? <span className="line-clamp-2 text-start">{r.call_notes}</span> : <span className="text-ink-300">＋ أضف ملاحظة</span>}
                    </QuickEdit>
                  ) : r.call_notes ? <span className="line-clamp-2">{r.call_notes}</span> : <span className="text-ink-300">—</span>}
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  {r.dup_attempts > 0
                    ? <Link href={`/leads/${r.id}`} title="عدد محاولات تسجيل هذا العميل مرة أخرى"><Badge tone="warn">مكرر · {r.dup_attempts} محاولة</Badge></Link>
                    : <Badge tone="ok">فريد</Badge>}
                </td>
                <td className={`${cell} whitespace-nowrap text-ink-500`}>{fmtDateTime(r.created_at)}</td>
                <td className={cell}>
                  {r.lead_temperature
                    ? <Link href={href(q, { temp: r.lead_temperature })} className={chip} title="تصفية بهذه الدرجة"><Badge tone={TEMPERATURE_TONE[r.lead_temperature]}>{TEMPERATURE[r.lead_temperature]}</Badge></Link>
                    : <span className="text-ink-300">—</span>}
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  {r.sales_name ? (wide && r.assigned_sales_id ? <Link href={href(q, { sales: r.assigned_sales_id })} className="hover:text-burgundy-600 hover:underline">{r.sales_name}</Link> : r.sales_name) : <span className="text-ink-300">—</span>}
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  {r.next_followup_at ? <span className={new Date(r.next_followup_at) < new Date() ? "font-semibold text-bad" : ""}>{fmtDateTime(r.next_followup_at)}</span> : <span className="text-ink-300">—</span>}
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  <div className="flex items-center gap-1.5">
                    <Link href={`/leads/${r.id}`} className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium hover:bg-cream">فتح</Link>
                    {canHide && <HideLead leadId={r.id} name={r.name} hidden={!!r.hidden_at} className="!px-2.5 !py-1 !text-xs" />}
                    {canDelete && <DeleteLead clientId={r.client_id} name={r.name} className="!px-2.5 !py-1 !text-xs" />}
                    {sendable && <SendToSales leadId={r.id} name={r.name} currentStatus={r.lead_status} reps={reps} className="!px-2.5 !py-1 !text-xs" />}
                  </div>
                </td>
              </tr>);
          })}
        </tbody>
      </table>
    </div>
  );
}
