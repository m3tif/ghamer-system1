"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tx } from "@/lib/db";
import { can, currentTokenHash, ensureEnrollment, hashPassword, login, logout, requireSession, validatePasswordStrength, verifyMfa, verifyPassword, getSession } from "@/lib/auth";
import { mapError } from "@/lib/errors";
import { normalizePhone, normalizeStoreUrl } from "@/lib/normalize";
import { parseRiyadh } from "@/lib/format";
import type { FormState } from "@/lib/form";
import { ACHIEVEMENT, NEEDS_FOLLOWUP, encourage, nextMilestone } from "@/lib/labels";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const vals = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
const fail = (e: unknown, fd?: FormData): FormState => ({ error: mapError(e), values: fd ? vals(fd) : undefined });

// ───────── session ─────────
export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = s(fd, "email"), password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "أدخل البريد الإلكتروني وكلمة المرور" };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const r = await login(email, password, ip, h.get("user-agent") ?? "");
  if (r.error) return { error: r.error, values: { email } };
  redirect("/");
}
export async function logoutAction() { await logout(); redirect("/login"); }

export async function mfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await getSession();
  if (!sess) redirect("/login");
  const ok = await verifyMfa(sess, s(fd, "code"));
  if (!ok) return { error: "الرمز غير صحيح أو منتهي" };
  redirect("/");
}
export async function mfaEnroll() { const sess = await getSession(); if (!sess) redirect("/login"); return ensureEnrollment(sess); }

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession({ allowPasswordChange: true });
  const oldPw = String(fd.get("old") ?? ""), n1 = String(fd.get("new") ?? ""), n2 = String(fd.get("confirm") ?? "");
  if (n1 !== n2) return { error: "كلمتا المرور غير متطابقتين" };
  const weak = validatePasswordStrength(n1); if (weak) return { error: weak };
  if (n1 === oldPw) return { error: "اختر كلمة مرور مختلفة عن الحالية" };
  const cur = (await tx(sess.userId, (c) => c.query("select app.own_password_hash() h"))).rows[0].h;
  if (!(await verifyPassword(cur, oldPw))) return { error: "كلمة المرور الحالية غير صحيحة" };
  const newHash = await hashPassword(n1), keep = await currentTokenHash();
  await tx(sess.userId, (c) => c.query("select app.set_own_password($1,$2)", [newHash, keep]));
  redirect("/");
}

// ───────── leads ─────────
const leadSchema = z.object({
  name: z.string().min(2, "اسم العميل مطلوب"), source: z.string().min(1, "اختر مصدر العميل"),
});

function buildContactPayload(fd: FormData): { error?: string; payload?: any } {
  const identifiers: any[] = [], contacts: any[] = [], stores: any[] = [];
  const seen = new Set<string>();
  for (const [field, label] of [["phone", "mobile"], ["alt_phone", "alt_mobile"], ["whatsapp", "whatsapp"]] as const) {
    const raw = s(fd, field); if (!raw) continue;
    const n = normalizePhone(raw);
    if (!n) return { error: `رقم غير صالح: ${raw}` };
    if (seen.has(n)) continue; seen.add(n);
    identifiers.push({ kind: "phone", value: n, label }); contacts.push({ label, phone: n, is_primary: label === "mobile" });
  }
  const urls = s(fd, "store_url").split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  for (const u of urls) {
    const k = normalizeStoreUrl(u);
    if (!k) return { error: `رابط غير صالح: ${u}` };
    if (seen.has("s:" + k.key)) continue; seen.add("s:" + k.key);
    identifiers.push({ kind: "store", value: k.key, label: "store" }); stores.push({ url_raw: k.raw, url_key: k.key });
  }
  return { payload: { identifiers, contacts, stores } };
}

export async function createLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const legacy = s(fd, "mode") === "existing";
  const p = leadSchema.safeParse({ name: s(fd, "name"), source: legacy ? "legacy" : s(fd, "source") });
  if (!p.success) return { error: p.error.issues[0].message, values: vals(fd) };
  if (!s(fd, "phone")) return { error: "رقم الجوال مطلوب", values: vals(fd) };
  const cp = buildContactPayload(fd);
  if (cp.error) return { error: cp.error, values: vals(fd) };
  const status = s(fd, "lead_status") || "New Lead";
  const next = parseRiyadh(s(fd, "next_followup"));
  if (NEEDS_FOLLOWUP.includes(status) && (!next || !s(fd, "followup_reason")))
    return { error: "حدد موعد المتابعة وسببها لهذه الحالة", values: vals(fd) };
  const rid = s(fd, "request_id");
  const payload = {
    mode: legacy ? "existing" : "lead", request_id: /^[0-9a-f-]{36}$/i.test(rid) ? rid : null,
    name: s(fd, "name"), business_name: s(fd, "business_name"), industry: s(fd, "industry"),
    country: s(fd, "country") || "SA", city: s(fd, "city"), contact_person: s(fd, "contact_person"), source: s(fd, "source"),
    required_services: fd.getAll("services").map(String), lead_status: status, call_notes: s(fd, "call_notes"),
    next_followup_at: next, followup_reason: s(fd, "followup_reason"), ...cp.payload,
  };
  let res: any;
  try { res = (await tx(sess.userId, (c) => c.query("select app.register_lead($1::jsonb) r", [JSON.stringify(payload)]))).rows[0].r; }
  catch (e) { return fail(e, fd); }
  if (res.status === "duplicate") {
    return { values: vals(fd), dup: { owner_name: res.owner_name, existing_client_id: res.existing_client_id, matched_kinds: res.matched_kinds, ambiguous: res.ambiguous,
      attempted: { name: s(fd, "name"), business_name: s(fd, "business_name"), phone: s(fd, "phone"), store: s(fd, "store_url") } } };
  }
  revalidatePath("/leads");
  if (legacy) redirect("/");
  if (s(fd, "intent") === "open") redirect(`/leads/${res.lead_id}`);
  const count: number = res.month_count ?? 0, goal: number | null = res.goal == null ? null : Number(res.goal), ach: string[] = res.new_achievements ?? [];
  const e = encourage(count, goal, ach);
  return { ok: `تم حفظ «${s(fd, "name")}»`, toast: { ...e, count, goal, next: nextMilestone(count), achievements: ach.map((c) => ACHIEVEMENT[c] ?? c) } };
}

export async function requestReviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try {
    await tx(sess.userId, (c) => c.query("select app.request_ownership_review($1,$2,$3::jsonb)",
      [s(fd, "existing_client_id"), s(fd, "reason"), s(fd, "attempted") || "{}"]));
  } catch (e) { return fail(e); }
  return { ok: "تم إرسال طلب مراجعة الملكية للمدير" };
}

export async function logCallAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const id = s(fd, "lead_id"), status = s(fd, "status"), note = s(fd, "note");
  const next = parseRiyadh(s(fd, "next_followup")), why = s(fd, "followup_reason");
  if (!note) return { error: "اكتب ملاحظات المكالمة", values: vals(fd) };
  if (NEEDS_FOLLOWUP.includes(status) && (!next || !why)) return { error: "حدد موعد المتابعة وسببها لهذه الحالة", values: vals(fd) };
  if (next && !why) return { error: "اكتب سبب المتابعة", values: vals(fd) };
  try {
    await tx(sess.userId, async (c) => {
      const cur = (await c.query("select lead_status from leads where id = $1", [id])).rows[0];
      if (!cur) throw new Error("no access");
      await c.query("insert into lead_activities(lead_id, kind, status_from, status_to, note, created_by) values ($1,'call',$2,$3,$4,$5)",
        [id, cur.lead_status, status || cur.lead_status, note, sess.userId]);
      await c.query("update follow_ups set status = 'done', completed_at = now() where lead_id = $1 and status = 'open' and owner_id = $2", [id, sess.userId]);
      await c.query("update leads set lead_status = $2, last_contact_at = now(), updated_by = $3, call_notes = $4, next_followup_at = $5 where id = $1",
        [id, status || cur.lead_status, sess.userId, note, next]);
      if (next) await c.query("insert into follow_ups(lead_id, owner_id, due_at, reason, created_by) values ($1,$2,$3,$4,$2)", [id, sess.userId, next, why]);
    });
  } catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${id}`);
  return { ok: "تم تسجيل المكالمة" };
}

export async function updateClientAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try {
    const r = await tx(sess.userId, (c) => c.query(
      "update clients set name=$2, business_name=$3, industry=$4, city=$5, contact_person=$6 where id=$1",
      [s(fd, "client_id"), s(fd, "name"), s(fd, "business_name") || null, s(fd, "industry") || null, s(fd, "city") || null, s(fd, "contact_person") || null]));
    if (!r.rowCount) return { error: "غير مصرح لك بتعديل هذا العميل" };
  } catch (e) { return fail(e); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم حفظ البيانات" };
}

export async function updateContactsAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  if (!s(fd, "phone")) return { error: "رقم الجوال مطلوب" };
  const cp = buildContactPayload(fd);
  if (cp.error) return { error: cp.error };
  try {
    const r = (await tx(sess.userId, (c) => c.query("select app.update_client_contacts($1,$2::jsonb) r", [s(fd, "client_id"), JSON.stringify(cp.payload)]))).rows[0].r;
    if (r.status === "duplicate") return { error: `أحد الأرقام أو الروابط مسجل لدى ${r.owner_name ?? "موظف آخر"}. لم يتم الحفظ.` };
  } catch (e) { return fail(e); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم حفظ بيانات التواصل" };
}

export async function transferLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.transfer_lead($1,$2,$3,$4)", [s(fd, "lead_id"), s(fd, "to"), s(fd, "kind"), s(fd, "reason")])); }
  catch (e) { return fail(e); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم نقل الملكية وتسجيلها في السجل" };
}

export async function resolveReviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.resolve_duplicate_review($1,$2,$3)", [s(fd, "id"), s(fd, "decision"), s(fd, "note")])); }
  catch (e) { return fail(e); }
  revalidatePath("/duplicates");
  return { ok: "تم تسجيل القرار" };
}

export async function correctAttributionAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.correct_attribution($1,$2,$3,$4)",
    [s(fd, "client_id"), s(fd, "source") || null, s(fd, "creator") || null, s(fd, "reason")])); }
  catch (e) { return fail(e); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم تصحيح المصدر وتسجيله في سجل التدقيق" };
}

// ───────── meetings ─────────
export async function bookMeetingAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const at = parseRiyadh(s(fd, "at"));
  if (!at) return { error: "حدد تاريخ ووقت الاجتماع", values: vals(fd) };
  const url = s(fd, "url");
  if (url && !/^https?:\/\//i.test(url)) return { error: "رابط الاجتماع يجب أن يبدأ بـ https://", values: vals(fd) };
  try { await tx(sess.userId, (c) => c.query("select app.book_meeting($1,$2,$3,$4,$5)", [s(fd, "lead_id"), s(fd, "rep"), at, url || null, s(fd, "notes") || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`); revalidatePath("/meetings");
  return { ok: "تم حجز الاجتماع" };
}

export async function meetingAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const action = s(fd, "action");
  const when = action === "reschedule" ? parseRiyadh(s(fd, "at")) : null;
  if (action === "reschedule" && !when) return { error: "حدد الموعد الجديد" };
  try { await tx(sess.userId, (c) => c.query("select app.set_meeting_status($1,$2,$3,$4,$5)",
    [s(fd, "meeting_id"), action, s(fd, "reason") || null, when, s(fd, "rep") || null])); }
  catch (e) { return fail(e); }
  revalidatePath("/meetings"); revalidatePath("/");
  return { ok: "تم التحديث" };
}

// ───────── deals ─────────
export async function moveDealAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.move_deal_stage($1,$2,$3,$4,$5)",
    [s(fd, "deal_id"), s(fd, "to"), s(fd, "reason") || null, parseRiyadh(s(fd, "followup_at")), s(fd, "followup_reason") || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/deals/${s(fd, "deal_id")}`); revalidatePath("/pipeline");
  return { ok: "تم تحديث مرحلة الصفقة" };
}

export async function saveBriefAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const id = s(fd, "deal_id");
  const budget = s(fd, "expected_budget"), prob = s(fd, "win_probability"), val = s(fd, "expected_value");
  if (prob && (Number(prob) < 0 || Number(prob) > 100 || isNaN(Number(prob)))) return { error: "نسبة الاحتمال بين 0 و100" };
  try {
    await tx(sess.userId, async (c) => {
      const r = await c.query(
        `update deal_briefs set business_type=$2, store_url=$3, marketing_goals=$4, current_problems=$5, competitors=$6, expected_budget=$7,
           required_services=$8, proposed_packages=$9, meeting_notes=$10, expected_decision=$11, updated_by=$12, updated_at=now() where deal_id=$1`,
        [id, s(fd, "business_type") || null, s(fd, "store_url") || null, s(fd, "marketing_goals") || null, s(fd, "current_problems") || null,
         s(fd, "competitors") || null, budget ? Number(budget) : null, fd.getAll("services").map(String), s(fd, "proposed_packages") || null,
         s(fd, "meeting_notes") || null, s(fd, "expected_decision") || null, sess.userId]);
      if (!r.rowCount) throw new Error("no access");
      await c.query("update deals set win_probability=$2, expected_value=$3 where id=$1", [id, prob ? Number(prob) : null, val ? Number(val) : null]);
    });
  } catch (e) { return fail(e); }
  revalidatePath(`/deals/${id}`);
  return { ok: "تم حفظ البريف" };
}

export async function completeFollowUpAction(fd: FormData) {
  const sess = await requireSession();
  await tx(sess.userId, (c) => c.query("update follow_ups set status='done', completed_at=now() where id=$1 and status='open'", [s(fd, "id")]));
  revalidatePath("/follow-ups"); revalidatePath("/");
}

// ───────── targets & notifications ─────────
export async function setTargetAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const v = Number(s(fd, "value"));
  if (!(v >= 0)) return { error: "قيمة التارجت غير صالحة" };
  try {
    await tx(sess.userId, (c) => c.query(
      `insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,$3,$4,$5)
       on conflict (employee_id, period_month, metric) do update set target_value = excluded.target_value`,
      [s(fd, "employee"), s(fd, "month"), s(fd, "metric"), v, sess.userId]));
  } catch (e) { return fail(e); }
  revalidatePath("/targets");
  return { ok: "تم حفظ التارجت" };
}

export async function markNotificationsReadAction() {
  const sess = await requireSession();
  await tx(sess.userId, (c) => c.query("update notifications set read_at = now() where read_at is null"));
  revalidatePath("/notifications");
}

// ───────── employees (Super Admin) ─────────
export async function createEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  if (!can(sess, "employees.manage")) return { error: "غير مصرح" };
  const email = z.string().email().safeParse(s(fd, "email"));
  if (!email.success) return { error: "بريد إلكتروني غير صالح", values: vals(fd) };
  if (!s(fd, "full_name")) return { error: "اسم الموظف مطلوب", values: vals(fd) };
  const pw = String(fd.get("password") ?? "");
  const weak = validatePasswordStrength(pw); if (weak) return { error: weak, values: vals(fd) };
  try {
    await tx(sess.userId, async (c) => c.query("select app.create_employee($1::jsonb)", [JSON.stringify({
      email: email.data, password_hash: await hashPassword(pw), role_code: s(fd, "role"), full_name: s(fd, "full_name"),
      phone: s(fd, "phone"), job_title: s(fd, "job_title"), manager_id: s(fd, "manager") })]));
  } catch (e) { return fail(e, fd); }
  revalidatePath("/employees");
  return { ok: "تم إنشاء الحساب. سيُطلب من الموظف تغيير كلمة المرور عند أول دخول." };
}
export async function setActiveAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.set_employee_active($1,$2,$3)", [s(fd, "id"), s(fd, "active") === "1", s(fd, "reason")])); }
  catch (e) { return fail(e); }
  revalidatePath("/employees");
  return { ok: "تم التحديث" };
}
export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const pw = String(fd.get("password") ?? "");
  const weak = validatePasswordStrength(pw); if (weak) return { error: weak };
  try { const h = await hashPassword(pw); await tx(sess.userId, (c) => c.query("select app.admin_set_password($1,$2)", [s(fd, "id"), h])); }
  catch (e) { return fail(e); }
  return { ok: "تم تعيين كلمة مرور جديدة وإغلاق جلسات الموظف" };
}
export async function setManagerAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.set_manager($1,$2)", [s(fd, "id"), s(fd, "manager") || null])); }
  catch (e) { return fail(e); }
  revalidatePath("/employees");
  return { ok: "تم تحديث الفريق" };
}

// ───────── hand-off to Sales ─────────
export async function handoffAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const to = s(fd, "to");
  try { await tx(sess.userId, (c) => c.query("select app.handoff_lead($1,$2,$3)", [s(fd, "lead_id"), to === "" || to === "admin" ? null : to, s(fd, "note") || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/leads"); revalidatePath("/");
  redirect("/leads?handed=1");
}
export async function assignHandoffAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.assign_handoff($1,$2)", [s(fd, "id"), s(fd, "to")])); }
  catch (e) { return fail(e); }
  revalidatePath("/distribution");
  return { ok: "تم توزيع العميل وإشعار الموظف المستلم" };
}
export async function acknowledgeHandoffAction(fd: FormData) {
  const sess = await requireSession();
  await tx(sess.userId, (c) => c.query("select app.acknowledge_handoff($1)", [s(fd, "lead_id")]));
  revalidatePath(`/leads/${s(fd, "lead_id")}`); revalidatePath("/");
}
