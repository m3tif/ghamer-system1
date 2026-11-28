"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ptx } from "@/lib/db";
import { mapError } from "@/lib/errors";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth";
import { portalLogin, portalLogout, portalTokenHash, requirePortal } from "@/lib/portal-auth";
import type { FormState } from "@/lib/form";

/** Everything a client can do in the portal. Each action runs as the signed-in client only (app.portal_id). */
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS = ["ticket", "update", "task", "request"];
const PORTAL_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const done = (msg: string): FormState => { revalidatePath("/portal", "layout"); return { ok: msg }; };

async function readFile(fd: FormData): Promise<{ name: string; type: string; bytes: Buffer } | string | null> {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > 4 * 1024 * 1024) return "الملف أكبر من 4 ميجا. للملفات الكبيرة ابعت رابط (درايف مثلًا) في الرسالة";
  if (!PORTAL_FILE_TYPES.includes(f.type)) return "نوع الملف مش مدعوم. المسموح: PDF أو صورة أو Word أو Excel";
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}

export async function portalLoginAction(_: FormState, fd: FormData): Promise<FormState> {
  const phone = s(fd, "phone"), password = String(fd.get("password") ?? "");
  if (!phone || !password) return { error: "اكتب رقم الجوال وكلمة المرور", values: { phone } };
  const h = await headers();
  const r = await portalLogin(phone, password, h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "", h.get("user-agent") ?? "");
  if (r.error) return { error: r.error, values: { phone } };
  redirect("/portal");
}
export async function portalLogoutAction() { await portalLogout(); redirect("/portal/login"); }

export async function portalPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const ps = await requirePortal({ allowPasswordChange: true });
  const cur = String(fd.get("current") ?? ""), next = String(fd.get("password") ?? ""), again = String(fd.get("confirm") ?? "");
  const weak = validatePasswordStrength(next);
  if (weak) return { error: weak };
  if (next !== again) return { error: "كلمتين المرور مش زي بعض" };
  const hash = (await ptx(ps.accountId, (c) => c.query("select app.portal_password_hash() h"))).rows[0].h as string;
  if (!(await verifyPassword(hash, cur))) return { error: ps.mustChangePassword ? "كلمة المرور المؤقتة غلط" : "كلمة المرور الحالية غلط" };
  if (await verifyPassword(hash, next)) return { error: "اختار كلمة مرور جديدة غير الحالية" };
  const h = await hashPassword(next);
  try { await ptx(ps.accountId, async (c) => c.query("select app.portal_set_password($1,$2)", [h, await portalTokenHash()])); }
  catch (e) { return { error: mapError(e) }; }
  if (ps.mustChangePassword) redirect("/portal");
  return done("اتغيرت كلمة المرور");
}

export async function portalRespondAction(_: FormState, fd: FormData): Promise<FormState> {
  const ps = await requirePortal();
  const id = s(fd, "request_id"), ops = s(fd, "ops_id"), text = s(fd, "text").slice(0, 4000);
  if (!UUID.test(id) || !UUID.test(ops)) return { error: "طلب غير صالح" };
  const file = await readFile(fd);
  if (typeof file === "string") return { error: file };
  if (!text && !file) return { error: "اكتب ردك أو ارفع الملف المطلوب" };
  try {
    await ptx(ps.accountId, async (c) => {
      if (file) await c.query("select app.portal_client_file_add($1,$2,$3,$4,'request',$5)", [ops, file.name, file.type, file.bytes, id]);
      await c.query("select app.portal_request_respond($1,$2)", [id, text]);
    });
  } catch (e) { return { error: mapError(e) }; }
  return done("وصلنا ردك ✓ هنراجعه ونبلغك");
}

export async function portalDecideAction(_: FormState, fd: FormData): Promise<FormState> {
  const ps = await requirePortal();
  const id = s(fd, "task_id"), ok = s(fd, "decision") === "ok", note = s(fd, "note").slice(0, 2000);
  if (!UUID.test(id)) return { error: "شغل غير صالح" };
  if (!ok && !note) return { error: "اكتب التعديل اللي محتاجه" };
  try { await ptx(ps.accountId, (c) => c.query("select app.portal_task_decide($1,$2,$3)", [id, ok, note || null])); }
  catch (e) { return { error: mapError(e) }; }
  return done(ok ? "تمام، اتسجلت موافقتك ✓" : "وصل طلب التعديل للفريق");
}

export async function portalMessageAction(_: FormState, fd: FormData): Promise<FormState> {
  const ps = await requirePortal();
  const kind = s(fd, "kind"), id = s(fd, "thread_id"), body = s(fd, "body").slice(0, 4000);
  if (!KINDS.includes(kind) || !UUID.test(id)) return { error: "غير صالح" };
  if (!body) return { error: "اكتب رسالتك" };
  try { await ptx(ps.accountId, (c) => c.query("select app.portal_client_message($1,$2,$3)", [kind, id, body])); }
  catch (e) { return { error: mapError(e) }; }
  return done("اتبعتت ✓");
}

export async function portalTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  const ps = await requirePortal();
  const ops = s(fd, "ops_id"), subject = s(fd, "subject").slice(0, 160), body = s(fd, "body").slice(0, 4000);
  if (!UUID.test(ops)) return { error: "اختار المشروع" };
  if (subject.length < 2) return { error: "اكتب عنوان للطلب", values: { subject, body } };
  if (!body) return { error: "اكتب تفاصيل طلبك", values: { subject, body } };
  const file = await readFile(fd);
  if (typeof file === "string") return { error: file, values: { subject, body } };
  let id = "";
  try {
    id = await ptx(ps.accountId, async (c) => {
      const t = (await c.query("select app.portal_ticket_open($1,$2,$3) id", [ops, subject, body])).rows[0].id as string;
      if (file) await c.query("select app.portal_client_file_add($1,$2,$3,$4,'ticket',$5)", [ops, file.name, file.type, file.bytes, t]);
      return t;
    });
  } catch (e) { return { error: mapError(e), values: { subject, body } }; }
  revalidatePath("/portal", "layout");
  redirect(`/portal/support/${id}`);
}

export async function portalTicketCloseAction(_: FormState, fd: FormData): Promise<FormState> {
  const ps = await requirePortal();
  const id = s(fd, "ticket_id");
  if (!UUID.test(id)) return { error: "غير صالح" };
  try { await ptx(ps.accountId, (c) => c.query("select app.portal_ticket_close($1)", [id])); }
  catch (e) { return { error: mapError(e) }; }
  return done("اتقفل الطلب ✓");
}

export async function portalUploadAction(_: FormState, fd: FormData): Promise<FormState> {
  const ps = await requirePortal();
  const ops = s(fd, "ops_id"), kind = s(fd, "kind") || null, thread = s(fd, "thread_id") || null;
  if (!UUID.test(ops) || (kind && (!KINDS.includes(kind) || !thread || !UUID.test(thread)))) return { error: "غير صالح" };
  const file = await readFile(fd);
  if (!file) return { error: "اختار الملف الأول" };
  if (typeof file === "string") return { error: file };
  try { await ptx(ps.accountId, (c) => c.query("select app.portal_client_file_add($1,$2,$3,$4,$5,$6)", [ops, file.name, file.type, file.bytes, kind, thread])); }
  catch (e) { return { error: mapError(e) }; }
  return done("اترفع الملف ✓ والفريق هيشوفه");
}

export async function portalReadAllAction() {
  const ps = await requirePortal();
  await ptx(ps.accountId, (c) => c.query("select app.portal_notifications_read(null)"));
  revalidatePath("/portal", "layout");
}
