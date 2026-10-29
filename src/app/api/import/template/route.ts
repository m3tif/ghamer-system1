import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
export const dynamic = "force-dynamic";
const HEAD = ["الاسم", "رقم الهاتف", "رقم بديل", "اسم النشاط التجاري", "رابط المتجر", "المصدر", "الحالة", "ملاحظات", "تاريخ الإضافة"];
const EX = [["محمد أحمد", "0501234567", "", "متجر النخبة", "https://example.com", "cold_call", "New Lead", "اتصلت به مرتين", "2025-03-14"],
            ["Ahmed Hassan", "+201012345678", "", "", "", "", "Interested", "", "14/03/2025"],
            ["Sara Ali", "+971501234567", "", "Sara Boutique", "https://instagram.com/saraboutique", "", "", "", ""]];

export async function GET(req: Request) {
  if (!(await getSession())) return new Response("unauthorized", { status: 401 });
  if (new URL(req.url).searchParams.get("kind") === "csv") {
    const body = "﻿" + [HEAD, ...EX].map((r) => r.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\r\n");
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="import-template.csv"' } });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("العملاء", { views: [{ rightToLeft: true }] });
  ws.addRow(HEAD); EX.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => { c.width = 22; });
  ws.getColumn(2).numFmt = "@"; ws.getColumn(3).numFmt = "@";      // phones as text so Excel keeps the leading 0 / +
  const help = wb.addWorksheet("تعليمات", { views: [{ rightToLeft: true }] });
  [["العمود", "مطلوب؟", "ملاحظات"], ["الاسم", "نعم", "يمكن تكرار الاسم لعملاء مختلفين"], ["رقم الهاتف", "نعم", "محلي (حسب الدولة المختارة عند الرفع) أو دولي يبدأ بـ + أو 00. هو معيار التكرار الوحيد"],
   ["رقم بديل", "لا", ""], ["اسم النشاط التجاري", "لا", ""], ["رابط المتجر", "لا", "لا يمنع الإضافة حتى لو تكرر"], ["المصدر", "لا", "cold_call / meta_ads / website / referral / whatsapp / social / exhibition / other"],
   ["الحالة", "لا", "New Lead / Contacted / No Answer / Interested / Not Interested / Follow-up Required / Qualified Lead / Invalid Contact"],
   ["ملاحظات", "لا", ""], ["تاريخ الإضافة", "لا", "2025-03-14 أو 14/03/2025. إن تُرك فارغًا يُسجَّل «تاريخ غير معروف» ولا يُخترع تاريخ"],
   ["", "", ""], ["الحجم الأقصى", "", "4 ميجابايت و 20,000 صف لكل ملف"]].forEach((r) => help.addRow(r));
  help.getRow(1).font = { bold: true }; help.columns.forEach((c) => { c.width = 34; });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(buf, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="import-template.xlsx"' } });
}
