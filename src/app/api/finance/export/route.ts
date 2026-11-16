import { getSession } from "@/lib/auth";
import { financeContracts, financeDashboard } from "@/server/data";
import { CONTRACT_STATUS } from "@/lib/labels";

export const dynamic = "force-dynamic";
const D = /^\d{4}-\d{2}-\d{2}$/, UUID = /^[0-9a-f-]{36}$/;
const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
const day = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 16).replace("T", " ") : "");

/** CSV export of the Finance dashboard tables. The database functions decide who may read (Finance Manager and admins). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || ((s.mfaRequired || s.mfaEnabled) && !s.mfaVerified) || s.mustChangePassword) return new Response("غير مصرح", { status: 401 });
  if (!["finance_manager", "super_admin", "general_manager"].includes(s.role)) return new Response("غير مصرح", { status: 403 });
  const u = new URL(req.url).searchParams, g = (k: string) => u.get(k) ?? "";
  const from = D.test(g("from")) ? g("from") : null, to = D.test(g("to")) ? g("to") : null;
  let lines: string[];
  try {
    if (g("kind") === "employees") {
      const d = await financeDashboard(s.userId, from, to);
      lines = [["الموظف", "الدور", "ضافهم بنفسه", "استلمهم من التوزيع", "حوّلهم للسيلز", "اجتماعات منعقدة", "عقود اتسجلت", "عقود اتعتمدت"].join(","),
        ...(d.employees as any[]).map((e) => [e.full_name, e.role_name, e.added, e.received, e.handed, e.meetings, e.contracts, e.contracts_approved].map(cell).join(","))];
    } else {
      const rows = await financeContracts(s.userId, { q: g("q").slice(0, 80), status: g("cs") in CONTRACT_STATUS ? g("cs") : "", emp: UUID.test(g("emp")) ? g("emp") : "",
        from: D.test(g("cf")) ? g("cf") : "", to: D.test(g("ct")) ? g("ct") : "", limit: 5000, offset: 0 });
      lines = [["رقم العقد", "العميل", "النشاط", "الجوال", "الباقات", "السيلز", "التيلي", "القيمة (ريال)", "الحالة", "تاريخ التسجيل", "آخر تحديث", "بداية التعاقد", "نهاية التعاقد"].join(","),
        ...rows.map((r) => [r.contract_no, r.client_name, r.business_name, r.phone, r.packages, r.sales_name, r.tele_name, Number(r.total_amount), CONTRACT_STATUS[r.status] ?? r.status,
          day(r.created_at), day(r.updated_at), r.start_date ? String(r.start_date).slice(0, 10) : "", r.end_date ? String(r.end_date).slice(0, 10) : ""].map(cell).join(","))];
    }
  } catch { return new Response("غير مصرح", { status: 403 }); }
  const name = `${g("kind") === "employees" ? "أداء-الموظفين" : "العقود"}-${from ?? ""}-${to ?? ""}.csv`;
  return new Response("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" } });
}
