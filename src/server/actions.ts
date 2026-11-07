"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tx } from "@/lib/db";
import { can, currentTokenHash, ensureEnrollment, hashPassword, login, logout, requireSession, validatePasswordStrength, verifyMfa, verifyPassword, getSession } from "@/lib/auth";
import { mapError } from "@/lib/errors";
import { normalizeStoreUrl, parsePhoneAny } from "@/lib/normalize";
import { parseLocal } from "@/lib/format";
import { FIELDS, buildRows, type Mapping } from "@/lib/import-parse";
import type { FormState } from "@/lib/form";
import { ACHIEVEMENT, NEEDS_FOLLOWUP, encourage, nextMilestone } from "@/lib/labels";
import { MARK_COLS, MARK_KEYS } from "@/lib/marks";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const SECRET = /^(password|old|new|confirm)$/;
const vals = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && !SECRET.test(k)).map(([k, v]) => [k, String(v)]));
const fail = (e: unknown, fd?: FormData): FormState => ({ error: mapError(e), values: fd ? vals(fd) : undefined });

// ───────── session ─────────
export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = s(fd, "email"), password = String(fd.get("password") ?? "");
  if (!email || !password) return { values: vals(fd), error: "أدخل البريد الإلكتروني وكلمة المرور" };
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
  if (!ok) return { values: vals(fd), error: "الرمز غير صحيح أو منتهي" };
  redirect("/");
}
export async function mfaEnroll() { const sess = await getSession(); if (!sess) redirect("/login"); return ensureEnrollment(sess); }

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession({ allowPasswordChange: true });
  const oldPw = String(fd.get("old") ?? ""), n1 = String(fd.get("new") ?? ""), n2 = String(fd.get("confirm") ?? "");
  if (n1 !== n2) return { values: vals(fd), error: "كلمتا المرور غير متطابقتين" };
  const weak = validatePasswordStrength(n1); if (weak) return { values: vals(fd), error: weak };
  if (n1 === oldPw) return { values: vals(fd), error: "اختر كلمة مرور مختلفة عن الحالية" };
  const cur = (await tx(sess.userId, (c) => c.query("select app.own_password_hash() h"))).rows[0].h;
  if (!(await verifyPassword(cur, oldPw))) return { values: vals(fd), error: "كلمة المرور الحالية غير صحيحة" };
  const newHash = await hashPassword(n1), keep = await currentTokenHash();
  await tx(sess.userId, (c) => c.query("select app.set_own_password($1,$2)", [newHash, keep]));
  redirect("/");
}

// ───────── leads ─────────
const leadSchema = z.object({
  name: z.string().max(200), source: z.string().min(1, "اختر مصدر العميل"),
});

function buildContactPayload(fd: FormData): { error?: string; payload?: any } {
  const identifiers: any[] = [], contacts: any[] = [], stores: any[] = [];
  const seen = new Set<string>();
  for (const [field, label] of [["phone", "mobile"], ["alt_phone", "alt_mobile"], ["whatsapp", "whatsapp"]] as const) {
    const raw = s(fd, field); if (!raw) continue;
    const pp = parsePhoneAny(raw);
    if (!pp.value) return { error: `رقم غير صالح (يجب أن يكون من 6 إلى 15 رقمًا): ${raw}` };
    if (seen.has(pp.value)) continue; seen.add(pp.value);
    identifiers.push({ kind: "phone", value: pp.value, label });
    contacts.push({ label, phone: pp.value, is_primary: label === "mobile", phone_raw: raw, phone_country: pp.country });
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
  const next = parseLocal(s(fd, "next_followup"));
  if (NEEDS_FOLLOWUP.includes(status) && (!next || !s(fd, "followup_reason")))
    return { error: "حدد موعد المتابعة وسببها لهذه الحالة", values: vals(fd) };
  const rid = s(fd, "request_id");
  const payload = {
    mode: legacy ? "existing" : "lead", lead_temperature: ["cold", "warm", "hot"].includes(s(fd, "lead_temperature")) ? s(fd, "lead_temperature") : null, request_id: /^[0-9a-f-]{36}$/i.test(rid) ? rid : null,
    name: s(fd, "name"), business_name: s(fd, "business_name"), industry: s(fd, "industry"),
    country: s(fd, "country") || "SA", city: s(fd, "city"), contact_person: s(fd, "contact_person"), source: s(fd, "source"),
    required_services: fd.getAll("services").map(String), lead_status: status, call_notes: s(fd, "call_notes"),
    next_followup_at: next, followup_reason: s(fd, "followup_reason"), ...cp.payload,
  };
  let res: any;
  try { res = (await tx(sess.userId, (c) => c.query("select app.register_lead($1::jsonb) r", [JSON.stringify(payload)]))).rows[0].r; }
  catch (e) { return fail(e, fd); }
  if (res.status === "duplicate") {
    return { values: vals(fd), dup: { existing_name: res.existing_name, existing_status: res.existing_status, existing_added_at: res.existing_added_at, owner_name: res.owner_name, existing_client_id: res.existing_client_id, matched_kinds: res.matched_kinds, ambiguous: res.ambiguous,
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
  } catch (e) { return fail(e, fd); }
  return { ok: "تم إرسال طلب مراجعة الملكية للمدير" };
}

export async function logCallAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const id = s(fd, "lead_id"), status = s(fd, "status"), note = s(fd, "note");
  const next = parseLocal(s(fd, "next_followup")), why = s(fd, "followup_reason");
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
    if (!r.rowCount) return { values: vals(fd), error: "غير مصرح لك بتعديل هذا العميل" };
  } catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم حفظ البيانات" };
}

export async function updateContactsAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  if (!s(fd, "phone")) return { values: vals(fd), error: "رقم الجوال مطلوب" };
  const cp = buildContactPayload(fd);
  if (cp.error) return { values: vals(fd), error: cp.error };
  try {
    const r = (await tx(sess.userId, (c) => c.query("select app.update_client_contacts($1,$2::jsonb) r", [s(fd, "client_id"), JSON.stringify(cp.payload)]))).rows[0].r;
    if (r.status === "duplicate") return { values: vals(fd), error: `أحد الأرقام أو الروابط مسجل لدى ${r.owner_name ?? "موظف آخر"}. لم يتم الحفظ.` };
  } catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم حفظ بيانات التواصل" };
}

export async function transferLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.transfer_lead($1,$2,$3,$4)", [s(fd, "lead_id"), s(fd, "to"), s(fd, "kind"), s(fd, "reason")])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم نقل الملكية وتسجيلها في السجل" };
}

export async function resolveReviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.resolve_duplicate_review($1,$2,$3)", [s(fd, "id"), s(fd, "decision"), s(fd, "note")])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/duplicates");
  return { ok: "تم تسجيل القرار" };
}

export async function correctAttributionAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.correct_attribution($1,$2,$3,$4)",
    [s(fd, "client_id"), s(fd, "source") || null, s(fd, "creator") || null, s(fd, "reason")])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`);
  return { ok: "تم تصحيح المصدر وتسجيله في سجل التدقيق" };
}

// ───────── meetings (managed by Sales) ─────────
/** After a successful meeting action: go back to where the user was, with a confirmation banner (the dialog may have disappeared). */
function flashBack(fd: FormData, key: string, fallback: string): never {
  const back = s(fd, "return_to");
  const target = back.startsWith("/") && !back.startsWith("//") ? back : fallback;
  redirect(`${target}${target.includes("?") ? "&" : "?"}ok=${key}`);
}
const LINK_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;
const linkError = (u: string) => (u && (u.length > 500 || !LINK_RE.test(u)) ? "رابط الاجتماع غير صالح. يجب أن يبدأ بـ https:// ويكون رابطًا كاملًا" : null);

export async function bookMeetingAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const at = parseLocal(s(fd, "at"));
  if (!at) return { error: "حدد تاريخ ووقت الاجتماع بشكل صحيح", values: vals(fd) };
  if (new Date(at).getTime() <= Date.now()) return { error: "يجب أن يكون موعد الاجتماع في المستقبل", values: vals(fd) };
  const url = s(fd, "url"), le = linkError(url);
  if (le) return { error: le, values: vals(fd) };
  const rid = s(fd, "request_id");
  try {
    await tx(sess.userId, (c) => c.query("select app.book_meeting($1,$2,$3,$4,$5,$6,$7)",
      [s(fd, "lead_id"), at, s(fd, "title") || null, s(fd, "type") || "online", url || null, s(fd, "notes") || null, /^[0-9a-f-]{36}$/i.test(rid) ? rid : null]));
  } catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`); revalidatePath("/meetings"); revalidatePath("/");
  flashBack(fd, "meeting_booked", `/leads/${s(fd, "lead_id")}`);
}

export async function updateMeetingAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const at = parseLocal(s(fd, "at"));
  if (!at) return { values: vals(fd), error: "حدد تاريخ ووقت الاجتماع بشكل صحيح" };
  const url = s(fd, "url"), le = linkError(url);
  if (le) return { values: vals(fd), error: le };
  try {
    await tx(sess.userId, (c) => c.query("select app.update_meeting($1,$2,$3,$4,$5,$6,$7)",
      [s(fd, "meeting_id"), s(fd, "title") || null, at, s(fd, "type") || null, url || null, s(fd, "notes") || null, s(fd, "reason") || null]));
  } catch (e) { return fail(e, fd); }
  revalidatePath("/meetings"); revalidatePath("/");
  flashBack(fd, "meeting_updated", "/meetings");
}

export async function completeMeetingAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const next = parseLocal(s(fd, "next_at"));
  if (s(fd, "next_at") && !next) return { values: vals(fd), error: "موعد الخطوة التالية غير صحيح" };
  try {
    await tx(sess.userId, (c) => c.query("select app.complete_meeting($1,$2,$3,$4,$5)",
      [s(fd, "meeting_id"), s(fd, "outcome") || null, s(fd, "notes") || null, s(fd, "next_step") || null, next]));
  } catch (e) { return fail(e, fd); }
  revalidatePath("/meetings"); revalidatePath("/"); revalidatePath("/follow-ups");
  flashBack(fd, "meeting_result", "/meetings?tab=done");
}

/** confirm / cancel (reason required) / no_show / reassign */
export async function meetingAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try {
    await tx(sess.userId, (c) => c.query("select app.set_meeting_status($1,$2,$3,null,$4)",
      [s(fd, "meeting_id"), s(fd, "action"), s(fd, "reason") || null, s(fd, "rep") || null]));
  } catch (e) { return fail(e, fd); }
  revalidatePath("/meetings"); revalidatePath("/");
  flashBack(fd, ({ confirm: "meeting_confirmed", cancel: "meeting_cancelled", no_show: "meeting_noshow", reassign: "meeting_reassigned" } as Record<string, string>)[s(fd, "action")] ?? "meeting_updated", "/meetings");
}

// ───────── deals ─────────
export async function moveDealAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.move_deal_stage($1,$2,$3,$4,$5)",
    [s(fd, "deal_id"), s(fd, "to"), s(fd, "reason") || null, parseLocal(s(fd, "followup_at")), s(fd, "followup_reason") || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/deals/${s(fd, "deal_id")}`); revalidatePath("/pipeline");
  return { ok: "تم تحديث مرحلة الصفقة" };
}

export async function saveBriefAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const id = s(fd, "deal_id");
  const budget = s(fd, "expected_budget"), prob = s(fd, "win_probability"), val = s(fd, "expected_value");
  if (prob && (Number(prob) < 0 || Number(prob) > 100 || isNaN(Number(prob)))) return { values: vals(fd), error: "نسبة الاحتمال بين 0 و100" };
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
  } catch (e) { return fail(e, fd); }
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
  if (!(v >= 0)) return { values: vals(fd), error: "قيمة التارجت غير صالحة" };
  try {
    await tx(sess.userId, (c) => c.query(
      `insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,$3,$4,$5)
       on conflict (employee_id, period_month, metric) do update set target_value = excluded.target_value`,
      [s(fd, "employee"), s(fd, "month"), s(fd, "metric"), v, sess.userId]));
  } catch (e) { return fail(e, fd); }
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
  if (!can(sess, "employees.manage")) return { values: vals(fd), error: "غير مصرح" };
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
  catch (e) { return fail(e, fd); }
  revalidatePath("/employees");
  return { ok: "تم التحديث" };
}
export async function renameEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.rename_employee($1,$2)", [s(fd, "id"), s(fd, "full_name")])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/employees");
  return { ok: "تم تعديل الاسم، وهو يظهر الآن في كل مكان مع بقاء كل البيانات والسجل" };
}
export async function reassignEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  if (s(fd, "confirm") !== "1") return { values: vals(fd), error: "أكّد النقل أولًا" };
  let r: any;
  try { r = (await tx(sess.userId, (c) => c.query("select app.reassign_employee($1,$2,$3) r", [s(fd, "id"), s(fd, "to"), s(fd, "reason")]))).rows[0].r; }
  catch (e) { return fail(e, fd); }
  revalidatePath("/employees");
  return { ok: `تم النقل: ${r.leads_owner + r.leads_sales} عميل، ${r.followups} متابعة، ${r.meetings} اجتماع، ${r.deals} صفقة، ${r.handoffs} قرار معلّق` };
}
export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const pw = String(fd.get("password") ?? "");
  const weak = validatePasswordStrength(pw); if (weak) return { values: vals(fd), error: weak };
  try { const h = await hashPassword(pw); await tx(sess.userId, (c) => c.query("select app.admin_set_password($1,$2)", [s(fd, "id"), h])); }
  catch (e) { return fail(e, fd); }
  return { ok: "تم تعيين كلمة مرور جديدة وإغلاق جلسات الموظف" };
}
export async function setManagerAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.set_manager($1,$2)", [s(fd, "id"), s(fd, "manager") || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/employees");
  return { ok: "تم تحديث الفريق" };
}

// ───────── hand-off to Sales ─────────
export async function handoffAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const to = s(fd, "to");
  try { await tx(sess.userId, (c) => c.query("select app.handoff_lead($1,$2,$3,$4)", [s(fd, "lead_id"), to === "" || to === "admin" ? null : to, s(fd, "note") || null, s(fd, "status") || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/leads"); revalidatePath("/");
  redirect("/leads?handed=1");
}
export async function assignHandoffAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.assign_handoff($1,$2)", [s(fd, "id"), s(fd, "to")])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/distribution");
  return { ok: "تم توزيع العميل وإشعار الموظف المستلم" };
}
export async function acceptHandoffAction(fd: FormData) {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.accept_handoff($1)", [s(fd, "lead_id")])); }
  catch (e) { redirect(`/assigned?error=${encodeURIComponent(mapError(e))}`); }
  revalidatePath("/assigned"); revalidatePath("/"); revalidatePath(`/leads/${s(fd, "lead_id")}`);
  redirect("/assigned?tab=accepted&ok=accepted");
}
export async function rejectHandoffAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const reason = s(fd, "reason"), note = s(fd, "note");
  if (!reason && !note) return { values: vals(fd), error: "اختر سببًا للرفض أو اكتب ملاحظة" };
  if (reason === "other" && !note) return { values: vals(fd), error: "اكتب ملاحظة توضح سبب الرفض" };
  try { await tx(sess.userId, (c) => c.query("select app.reject_handoff($1,$2,$3)", [s(fd, "lead_id"), reason || null, note || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/assigned"); revalidatePath("/");
  redirect("/assigned?tab=rejected&ok=rejected");
}
export async function setTemperatureAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const t = s(fd, "temperature");
  if (t && !["cold", "warm", "hot"].includes(t)) return { values: vals(fd), error: "قيمة غير صالحة" };
  try {
    const r = await tx(sess.userId, (c) => c.query("update leads set lead_temperature = $2, updated_by = $3 where id = $1", [s(fd, "lead_id"), t || null, sess.userId]));
    if (!r.rowCount) return { values: vals(fd), error: "غير مصرح لك بتعديل هذا العميل" };
  } catch (e) { return fail(e, fd); }
  revalidatePath(`/leads/${s(fd, "lead_id")}`); revalidatePath("/leads");
  return { ok: "تم حفظ درجة التواصل" };
}

/** Quick edit from the leads table: status, temperature, notes and (optionally) the next follow-up. Permissions are enforced by the database. */
const EDITABLE_STATUS = ["New Lead", "Contacted", "No Answer", "Interested", "Not Interested", "Follow-up Required", "Qualified Lead", "Invalid Contact"];
export async function quickEditAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const id = s(fd, "lead_id"), status = s(fd, "status"), temp = s(fd, "temperature"), notes = s(fd, "notes");
  const next = parseLocal(s(fd, "next_followup")), why = s(fd, "followup_reason");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "عميل غير صالح", values: vals(fd) };
  if (status && !EDITABLE_STATUS.includes(status)) return { error: "لا يمكن اختيار هذه الحالة من هنا", values: vals(fd) };
  if (temp && !["cold", "warm", "hot"].includes(temp)) return { error: "درجة غير صالحة", values: vals(fd) };
  if (notes.length > 4000) return { error: "الملاحظات طويلة جدًا (الحد 4000 حرف)", values: vals(fd) };
  if (s(fd, "next_followup") && !next) return { error: "موعد المتابعة غير صالح", values: vals(fd) };
  if (NEEDS_FOLLOWUP.includes(status) && (!next || !why)) return { error: "حدد موعد المتابعة وسببها لهذه الحالة", values: vals(fd) };
  if (next && !why) return { error: "اكتب سبب المتابعة", values: vals(fd) };
  try {
    await tx(sess.userId, async (c) => {
      const cur = (await c.query("select lead_status, lead_temperature, call_notes, handed_off_at from leads where id = $1", [id])).rows[0];
      if (!cur) throw new Error("no access");
      if (["Pending Sales Review", "Accepted by Sales", "Meeting Scheduled", "Meeting Completed"].includes(cur.lead_status) && status && status !== cur.lead_status)
        throw new Error("status is managed by the Sales workflow");
      const newStatus = status || cur.lead_status;
      const r = await c.query("update leads set lead_status = $2, lead_temperature = $3, call_notes = $4, updated_by = $5 where id = $1",
        [id, newStatus, temp || null, notes || null, sess.userId]);
      if (!r.rowCount) throw new Error("no access");
      if (newStatus !== cur.lead_status)
        await c.query("insert into lead_activities(lead_id, kind, status_from, status_to, note, created_by) values ($1,'status_change',$2,$3,'تعديل من جدول العملاء',$4)", [id, cur.lead_status, newStatus, sess.userId]);
      if (notes && notes !== (cur.call_notes ?? ""))
        await c.query("insert into lead_activities(lead_id, kind, note, created_by) values ($1,'note',$2,$3)", [id, notes, sess.userId]);
      if (next) {
        await c.query("update follow_ups set status = 'cancelled' where lead_id = $1 and status = 'open' and owner_id = $2 and deal_id is null", [id, sess.userId]);
        await c.query("update leads set next_followup_at = $2 where id = $1", [id, next]);
        await c.query("insert into follow_ups(lead_id, owner_id, due_at, reason, created_by) values ($1,$2,$3,$4,$2)", [id, sess.userId, next, why]);
      }
    });
  } catch (e) { return fail(e, fd); }
  revalidatePath("/leads"); revalidatePath(`/leads/${id}`);
  return { ok: "تم حفظ التعديلات" };
}

// ───────── hide / show leads (managers + admin only; enforced by the database) ─────────
export async function hideLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const id = s(fd, "lead_id"), hide = s(fd, "hide") === "1", why = s(fd, "reason");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "عميل غير صالح" };
  try { await tx(sess.userId, (c) => c.query("select app.set_lead_hidden($1,$2,$3)", [id, hide, why || null])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/leads"); revalidatePath(`/leads/${id}`);
  flashBack(fd, hide ? "lead_hidden" : "lead_shown", "/leads");
}
export async function hideMonthAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const emp = s(fd, "emp"), month = s(fd, "month"), hide = s(fd, "hide") === "1", why = s(fd, "reason");
  if (!/^[0-9a-f-]{36}$/.test(emp) || !/^\d{4}-\d{2}$/.test(month)) return { error: "اختر موظفًا وشهرًا" };
  let n = 0;
  try { n = (await tx(sess.userId, (c) => c.query("select app.hide_leads_month($1,$2,$3,$4) n", [emp, `${month}-01`, hide, why || null]))).rows[0].n; }
  catch (e) { return fail(e, fd); }
  revalidatePath("/leads");
  return { ok: n ? `${hide ? "تم إخفاء" : "تم إظهار"} ${n} عميل` : "لا توجد عملاء لتغييرهم" };
}

export async function hidePeriodAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const scope = s(fd, "scope"), raw = s(fd, "start"), emp = s(fd, "emp"), hide = s(fd, "hide") === "1", why = s(fd, "reason");
  const start = scope === "day" ? raw.slice(0, 10) : scope === "month" ? `${raw.slice(0, 7)}-01` : `${raw.slice(0, 4)}-01-01`;
  if (!["day", "month", "year"].includes(scope) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return { values: vals(fd), error: "اختر النطاق والتاريخ" };
  if (hide && s(fd, "confirm") !== "1") return { values: vals(fd), error: "أكّد الإخفاء أولًا" };
  let r: any;
  try { r = (await tx(sess.userId, (c) => c.query("select app.hide_period($1,$2,$3,$4,$5) r", [scope, start, /^[0-9a-f-]{36}$/.test(emp) ? emp : null, hide, why || null]))).rows[0].r; }
  catch (e) { return fail(e, fd); }
  revalidatePath("/visibility"); revalidatePath("/leads");
  return { ok: r.affected ? `${hide ? "تم إخفاء" : "تم إظهار"} ${r.affected} عميل` : hide ? "لا توجد عملاء جدد لإخفائهم في هذه الفترة (أو هي مخفية بالفعل)" : "لا يوجد ما يُظهَر لهذه الفترة" };
}

// ───── import of previous data ─────
export async function remapImportAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession(); const id = s(fd, "id");
  const mapping: Mapping = {};
  for (const f of FIELDS) { const v = s(fd, `map_${f.key}`); if (v) mapping[f.key] = v; }
  mapping.default_country = "SA";
  if (!mapping.name || !mapping.phone) return { error: "حدّد عمودي الاسم ورقم الهاتف" };
  try {
    await tx(sess.userId, async (c) => {
      const meta = (await c.query("select mapping from app.import_get($1)", [id])).rows[0];
      if (!meta) throw new Error("not found or no access");
      const headers: string[] = meta.mapping.headers ?? [];
      const raws = (await c.query("select row_no, raw from app.import_raw_rows($1)", [id])).rows as { row_no: number; raw: Record<string, string> }[];
      const table = { headers, rows: raws.map((r) => headers.map((h) => r.raw[h] ?? "")) };
      const rows = buildRows(table, mapping, mapping.default_country!).map((r, i) => ({ ...r, row_no: raws[i].row_no }));
      await c.query("select app.import_apply_mapping($1,$2::jsonb,$3::jsonb)", [id, JSON.stringify({ ...mapping, headers }), JSON.stringify(rows.map(({ raw, ...x }) => x))]);
    });
  } catch (e) { return fail(e, fd); }
  revalidatePath(`/import/${id}`);
  return { ok: "تم تطبيق ربط الأعمدة وإعادة الفحص" };
}
export async function fixImportRowAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession(); const id = s(fd, "id");
  const phone = s(fd, "phone"); const pp = phone ? parsePhoneAny(phone) : null;
  if (phone && !pp?.value) return { values: vals(fd), error: "رقم غير صالح (6 إلى 15 رقمًا)" };
  try { await tx(sess.userId, (c) => c.query("select app.import_fix_row($1,$2,$3,$4,$5)", [s(fd, "row"), s(fd, "name") || null, pp?.value ?? null, pp?.country ?? null, true])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/import/${id}`);
  return { ok: "تم تعديل الصف وإعادة فحصه" };
}
export async function skipImportRowAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession(); const id = s(fd, "id");
  try { await tx(sess.userId, (c) => c.query("select app.import_skip_row($1,$2)", [s(fd, "row"), s(fd, "skip") !== "0"])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/import/${id}`);
  return { ok: s(fd, "skip") === "0" ? "أُعيد الصف" : "تم تخطّي الصف" };
}
export async function cancelImportAction(fd: FormData): Promise<void> {
  const sess = await requireSession(); const id = s(fd, "id");
  await tx(sess.userId, (c) => c.query("select app.import_cancel($1)", [id]));
  redirect("/import");
}
export async function rollbackImportAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession(); const id = s(fd, "id");
  if (s(fd, "confirm") !== "1") return { error: "أكّد التراجع أولًا", values: vals(fd) };
  let r: any;
  try { r = (await tx(sess.userId, (c) => c.query("select app.import_rollback($1,$2) r", [id, s(fd, "reason")]))).rows[0].r; } catch (e) { return fail(e, fd); }
  revalidatePath(`/import/${id}`); revalidatePath("/leads");
  return { ok: `تم التراجع عن ${r.rolled_back} عميل، وأُبقي ${r.kept} لأنهم عُدّلوا بعد الاستيراد` };
}
export async function updateExistingAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession(); const id = s(fd, "id");
  try { await tx(sess.userId, (c) => c.query("select app.import_apply_update($1)", [s(fd, "row")])); } catch (e) { return fail(e, fd); }
  revalidatePath(`/import/${id}`);
  return { ok: "تم ملء الحقول الفارغة في العميل الموجود" };
}

// ───── complete deletion (Super Admin only, deliberate, logged) ─────
export async function deleteLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const client = s(fd, "client_id");
  if (!/^[0-9a-f-]{36}$/.test(client)) return { error: "عميل غير صالح" };
  if (s(fd, "confirm") !== "حذف") return { error: "اكتب كلمة «حذف» للتأكيد", values: vals(fd) };
  try { await tx(sess.userId, (c) => c.query("select app.delete_client($1,$2)", [client, s(fd, "reason")])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/leads");
  flashBack(fd, "lead_deleted", "/leads");
}
export async function deleteMonthAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  const emp = s(fd, "emp"), month = s(fd, "month");
  if (!/^[0-9a-f-]{36}$/.test(emp) || !/^\d{4}-\d{2}$/.test(month)) return { error: "اختر موظفًا وشهرًا" };
  if (s(fd, "confirm") !== "حذف") return { error: "اكتب كلمة «حذف» للتأكيد", values: vals(fd) };
  let n = 0;
  try { n = (await tx(sess.userId, (c) => c.query("select app.delete_leads_month($1,$2,$3) n", [emp, `${month}-01`, s(fd, "reason")]))).rows[0].n; }
  catch (e) { return fail(e, fd); }
  revalidatePath("/leads");
  flashBack(fd, "leads_deleted", "/leads");
}

export async function deleteEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession();
  if (s(fd, "confirm") !== "حذف") return { values: vals(fd), error: "اكتب كلمة «حذف» للتأكيد" };
  try { await tx(sess.userId, (c) => c.query("select app.delete_employee($1,$2,true)", [s(fd, "id"), s(fd, "reason")])); }
  catch (e) { return fail(e, fd); }
  revalidatePath("/employees");
  return { ok: "تم حذف الموظف نهائيًا (والعملية مسجلة في سجل التدقيق)" };
}

// ───── bulk distribution (Admin / Sales Manager) ─────
export async function remapDistributionAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession(); const id = s(fd, "id");
  const mapping: Mapping = {};
  for (const f of FIELDS) { const v = s(fd, `map_${f.key}`); if (v) mapping[f.key] = v; }
  if (!mapping.phone) return { error: "حدّد عمود رقم الهاتف" };
  try {
    await tx(sess.userId, async (c) => {
      const meta = (await c.query("select mapping from app.dist_get($1)", [id])).rows[0];
      if (!meta) throw new Error("not found or no access");
      const headers: string[] = meta.mapping.headers ?? [];
      const raws = (await c.query("select row_no, raw from app.dist_raw_rows($1)", [id])).rows as { row_no: number; raw: Record<string, string> }[];
      const table = { headers, rows: raws.map((r) => headers.map((h) => r.raw[h] ?? "")) };
      const rows = buildRows(table, mapping, "SA").map((r, i) => ({ ...r, row_no: raws[i].row_no }));
      await c.query("select app.dist_apply_mapping($1,$2::jsonb,$3::jsonb)", [id, JSON.stringify({ ...mapping, headers }), JSON.stringify(rows.map(({ raw, ...x }) => x))]);
    });
  } catch (e) { return fail(e, fd); }
  revalidatePath(`/bulk-distribution/${id}`);
  return { ok: "تم تطبيق ربط الأعمدة وإعادة الفحص" };
}
export async function skipDistributionRowAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession(); const id = s(fd, "id");
  try { await tx(sess.userId, (c) => c.query("select app.dist_skip_row($1,$2)", [s(fd, "row"), s(fd, "skip") !== "0"])); }
  catch (e) { return fail(e, fd); }
  revalidatePath(`/bulk-distribution/${id}`);
  return { ok: s(fd, "skip") === "0" ? "أُعيد الصف" : "تم استبعاد الصف من التوزيع" };
}
export async function cancelDistributionAction(fd: FormData): Promise<void> {
  const sess = await requireSession(); const id = s(fd, "id");
  await tx(sess.userId, (c) => c.query("select app.dist_cancel($1)", [id]));
  redirect("/bulk-distribution");
}

// ───── leads table: per-user colours and manual order ─────
type Ack = { ok: boolean; error?: string };
export async function setCellColorsAction(leadId: string, cols: string[], color: string | null): Promise<Ack> {
  const sess = await requireSession();
  if (!/^[0-9a-f-]{36}$/i.test(leadId) || !Array.isArray(cols) || cols.length === 0 || !cols.every((c) => (MARK_COLS as readonly string[]).includes(c)) || (color !== null && !MARK_KEYS.includes(color))) return { ok: false, error: "طلب غير صالح" };
  try { await tx(sess.userId, (c) => c.query("select app.mark_cells($1,$2::text[],$3)", [leadId, cols, color])); return { ok: true }; }
  catch (e) { return { ok: false, error: mapError(e) }; }
}
export async function reorderLeadsAction(ids: string[]): Promise<Ack> {
  const sess = await requireSession();
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 2000 || !ids.every((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))) return { ok: false, error: "طلب غير صالح" };
  try { await tx(sess.userId, (c) => c.query("select app.reorder_leads($1::uuid[])", [ids])); return { ok: true }; }
  catch (e) { return { ok: false, error: mapError(e) }; }
}
export async function resetLeadOrderAction(): Promise<Ack> {
  const sess = await requireSession();
  try { await tx(sess.userId, (c) => c.query("select app.reset_lead_order()")); return { ok: true }; }
  catch (e) { return { ok: false, error: mapError(e) }; }
}
