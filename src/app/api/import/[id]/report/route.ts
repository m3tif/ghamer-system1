import { getSession } from "@/lib/auth";
import { tx } from "@/lib/db";
import { csvSafe } from "@/lib/import-parse";
export const dynamic = "force-dynamic";
const ST: Record<string, string> = { new: "جديد", duplicate: "مكرر", invalid: "غير صالح", review: "يحتاج مراجعة", imported: "تم الاستيراد", skipped: "تخطّي", updated: "تم تحديث الموجود", error: "خطأ", rolled_back: "تم التراجع" };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("bad id", { status: 400 });
  const kind = new URL(req.url).searchParams.get("kind") === "all" ? null : ["duplicate", "invalid", "review", "error"];
  const rows = await tx(s.userId, async (c) => {
    const b = (await c.query("select * from app.import_get($1)", [id])).rows[0]; if (!b) return null;
    const r = (await c.query("select * from app.import_rows_page($1, null, 5000, 0)", [id])).rows;
    return { b, r };
  });
  if (!rows) return new Response("not found", { status: 404 });
  const list = rows.r.filter((x: any) => !kind || kind.includes(x.status));
  const head = ["رقم الصف", "الحالة", "السبب", "الاسم", "الهاتف في الملف", "الهاتف الموحد", "رابط المتجر", "تاريخ الإضافة", "مسجل لدى", "اختلافات عن الموجود", "خطأ"];
  const lines = [head.map(csvSafe).join(",")];
  for (const x of list) lines.push([x.row_no, ST[x.status] ?? x.status, x.reason, x.name, x.phone_raw, x.phone_e164, x.store_url, x.original_added ? String(x.original_added).slice(0, 10) : x.date_text, x.existing_owner_name, x.diff ? JSON.stringify(x.diff) : "", x.error].map(csvSafe).join(","));
  return new Response("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="import-report-${id.slice(0, 8)}.csv"`, "Cache-Control": "no-store" } });
}
