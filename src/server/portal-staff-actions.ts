"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { tx } from "@/lib/db";
import { mapError } from "@/lib/errors";
import { hashPassword, requireSession } from "@/lib/auth";
import { portalPhone, tempPassword } from "@/lib/portal-auth";
import type { FormState } from "@/lib/form";

/** Staff actions on a client's portal (Account Manager of the client, Technical Manager, admin — the database checks). */
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["ticket", "update", "task", "request"];
const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

async function step(fd: FormData, sql: (fd: FormData) => [string, unknown[]] | string, ok: string): Promise<FormState> {
  const sess = await requireSession();
  const ops = s(fd, "ops_id");
  if (!UUID.test(ops)) return { error: "عميل غير صالح" };
  const q = sql(fd);
  if (typeof q === "string") return { error: q };
  try { await tx(sess.userId, (c) => c.query(q[0], q[1])); }
  catch (e) { return { error: mapError(e) }; }
  revalidatePath(`/operations/${ops}/portal`);
  return { ok };
}
const loginUrl = async () => { const h = await headers(); return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/portal/login`; };

/** Open the portal for this client; a new account gets a temporary password shown ONCE to hand over (WhatsApp). */
export async function portalEnableAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const ops = s(fd, "ops_id"), phone = portalPhone(s(fd, "phone")), title = s(fd, "title").slice(0, 160);
  if (!UUID.test(ops)) return { error: "عميل غير صالح" };
  if (!phone) return { error: "رقم الجوال غير صحيح. اكتبه بكود الدولة لو مش سعودي (مثال: ‎+20…)", values: { phone: s(fd, "phone"), title } };
  const pw = tempPassword();
  let created = false;
  try { created = (await tx(sess.userId, async (c) => c.query("select app.portal_enable($1,$2,$3,$4) n", [ops, phone, await hashPassword(pw), title]))).rows[0].n; }
  catch (e) { return { error: mapError(e), values: { phone: s(fd, "phone"), title } }; }
  // no revalidate here: the page would re-render into the "open" view and the one-time password would vanish before it is copied
  if (!created) revalidatePath(`/operations/${ops}/portal`);
  return created ? { ok: "اتفعّلت البوابة", values: { password: pw, phone, url: await loginUrl() } }
                 : { ok: "اتفعّلت البوابة للمشروع ده. العميل عنده حساب من قبل، يدخل بنفس بياناته." };
}

export async function portalResetAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const ops = s(fd, "ops_id");
  if (!UUID.test(ops)) return { error: "عميل غير صالح" };
  const pw = tempPassword();
  let phone = "";
  try {
    phone = await tx(sess.userId, async (c) => {
      await c.query("select app.portal_reset_password($1,$2)", [ops, await hashPassword(pw)]);
      return (await c.query("select app.portal_staff_get($1) #>> '{account,phone}' p", [ops])).rows[0].p as string;
    }, "كلمة مرور مؤقتة جديدة لبوابة العميل");
  } catch (e) { return { error: mapError(e) }; }
  return { ok: "كلمة مرور مؤقتة جديدة", values: { password: pw, phone, url: await loginUrl() } };
}

export async function portalActiveAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => ["select app.portal_set_active($1,$2)", [s(fd, "ops_id"), s(fd, "active") === "1"]], "اتحفظ");
}
export async function portalProjectAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const a = s(fd, "start_date"), b = s(fd, "expected_end");
    if ((a && !DATE.test(a)) || (b && !DATE.test(b))) return "تاريخ غير صالح";
    return ["select app.portal_project_save($1,$2,$3,$4)", [s(fd, "ops_id"), s(fd, "title").slice(0, 160), a || null, b || null]];
  }, "اتحفظت بيانات المشروع");
}
export async function portalStageSaveAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const id = s(fd, "stage_id"), d = s(fd, "planned_date");
    if ((id && !UUID.test(id)) || (d && !DATE.test(d))) return "غير صالح";
    return ["select app.portal_stage_save($1,$2,$3,$4)", [s(fd, "ops_id"), id || null, s(fd, "name").slice(0, 80), d || null]];
  }, "اتحفظت المرحلة");
}
export async function portalStageOpAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const id = s(fd, "stage_id"), op = s(fd, "op");
    if (op === "advance") return ["select app.portal_stage_advance($1)", [s(fd, "ops_id")]];
    if (!UUID.test(id)) return "غير صالح";
    if (op === "current") return ["select app.portal_stage_set_current($1)", [id]];
    if (op === "up" || op === "down") return ["select app.portal_stage_move($1,$2)", [id, op === "up" ? -1 : 1]];
    if (op === "delete") return ["select app.portal_stage_delete($1)", [id]];
    return "غير صالح";
  }, "اتحفظ ✓ والعميل شايف التحديث");
}
export async function portalUpdateAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const t = s(fd, "title");
    if (t.length < 2) return "اكتب عنوان التحديث";
    return ["select app.portal_update_post($1,$2,$3)", [s(fd, "ops_id"), t.slice(0, 160), s(fd, "body").slice(0, 4000) || null]];
  }, "اتنشر التحديث ووصل للعميل إشعار");
}
export async function portalRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const t = s(fd, "title"), d = s(fd, "due_date");
    if (t.length < 2) return "اكتب المطلوب من العميل";
    if (d && !DATE.test(d)) return "تاريخ غير صالح";
    return ["select app.portal_request_save($1,$2,$3,$4)", [s(fd, "ops_id"), t.slice(0, 160), s(fd, "description").slice(0, 2000) || null, d || null]];
  }, "اتبعت الطلب للعميل");
}
export async function portalRequestCloseAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const id = s(fd, "request_id"), r = s(fd, "result"), note = s(fd, "note").slice(0, 1000);
    if (!UUID.test(id) || !["done", "return", "cancel"].includes(r)) return "غير صالح";
    if (r === "return" && !note) return "اكتب العميل محتاج يبعت إيه تاني";
    return ["select app.portal_request_close($1,$2,$3)", [id, r, note || null]];
  }, "اتحفظ");
}
export async function portalReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const k = s(fd, "kind"), id = s(fd, "thread_id"), b = s(fd, "body").slice(0, 4000);
    if (!KINDS.includes(k) || !UUID.test(id)) return "غير صالح";
    if (!b) return "اكتب الرد";
    return ["select app.portal_staff_message($1,$2,$3)", [k, id, b]];
  }, "اتبعت الرد للعميل");
}
export async function portalTicketCloseStaffAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => (UUID.test(s(fd, "ticket_id")) ? ["select app.portal_ticket_close($1)", [s(fd, "ticket_id")]] : "غير صالح"), "اتقفل الطلب");
}
export async function portalTaskSetAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => {
    const id = s(fd, "task_id"), st = s(fd, "stage_id");
    if (!UUID.test(id) || (st && !UUID.test(st))) return "غير صالح";
    return ["select app.portal_task_set($1,$2,$3,$4)", [id, s(fd, "visible") === "1", st || null, s(fd, "client_note").slice(0, 2000) || null]];
  }, "اتحفظ");
}
export async function portalShareFileAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => (UUID.test(s(fd, "attachment_id")) ? ["select app.portal_share_task_file($1)", [s(fd, "attachment_id")]] : "غير صالح"), "الملف بقى ظاهر للعميل");
}
export async function portalFileVisibleAction(_: FormState, fd: FormData): Promise<FormState> {
  return step(fd, (fd) => (UUID.test(s(fd, "file_id")) ? ["select app.portal_file_visibility($1,$2)", [s(fd, "file_id"), s(fd, "visible") === "1"]] : "غير صالح"), "اتحفظ");
}
export async function portalStaffUploadAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const ops = s(fd, "ops_id"), f = fd.get("file");
  if (!UUID.test(ops)) return { error: "عميل غير صالح" };
  if (!(f instanceof File) || f.size === 0) return { error: "اختار الملف الأول" };
  if (f.size > 4 * 1024 * 1024) return { error: "الملف أكبر من 4 ميجا" };
  if (!FILE_TYPES.includes(f.type)) return { error: "نوع الملف مش مدعوم. المسموح: PDF أو صورة أو Word أو Excel" };
  try { await tx(sess.userId, async (c) => c.query("select app.portal_staff_file_add($1,$2,$3,$4,$5,null,null)", [ops, f.name, f.type, Buffer.from(await f.arrayBuffer()), s(fd, "visible") === "1"])); }
  catch (e) { return { error: mapError(e) }; }
  revalidatePath(`/operations/${ops}/portal`);
  return { ok: s(fd, "visible") === "1" ? "اترفع الملف ووصل للعميل" : "اترفع الملف (داخلي)" };
}
export async function portalStageDefaultAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const id = s(fd, "id"), name = s(fd, "name").slice(0, 80), sort = Number(s(fd, "sort") || "99");
  if (id && !UUID.test(id)) return { error: "غير صالح" };
  try { await tx(sess.userId, (c) => c.query("select app.portal_stage_default_save($1,$2,$3,$4)", [id || null, name, Number.isFinite(sort) ? sort : 99, s(fd, "active") !== "0"])); }
  catch (e) { return { error: mapError(e) }; }
  revalidatePath("/operations/portal-stages");
  return { ok: "اتحفظ" };
}
