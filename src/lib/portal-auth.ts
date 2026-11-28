import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { randomBytes } from "node:crypto";
import { tx } from "./db";
import { sha256 } from "./crypto";
import { hashPassword, verifyPassword } from "./auth";
import { parsePhoneAny } from "./normalize";

/**
 * Client Portal sign-in. Completely separate from employee sign-in: its own table, its own cookie (sent only to
 * /portal), and requests run with app.portal_id — never an employee identity.
 */
export const PORTAL_COOKIE = "gh_portal";
const TTL_HOURS = 24 * 14;

export type PortalSession = { accountId: string; clientName: string; phone: string; mustChangePassword: boolean; unread: number };

export const getPortalSession = cache(async (): Promise<PortalSession | null> => {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const r = (await tx(null, (c) => c.query("select * from app.portal_session_get($1)", [sha256(token)]))).rows[0];
  if (!r) return null;
  return { accountId: r.account_id, clientName: r.client_name, phone: r.phone, mustChangePassword: r.must_change_password, unread: r.unread };
});

export async function requirePortal(opts: { allowPasswordChange?: boolean } = {}): Promise<PortalSession> {
  const s = await getPortalSession();
  if (!s) redirect("/portal/login");
  if (s.mustChangePassword && !opts.allowPasswordChange) redirect("/portal/password");
  return s;
}

export const portalPhone = (raw: string): string | null => {
  const p = parsePhoneAny(raw);
  return p.value && p.value.startsWith("+") ? p.value : null;
};

let dummy: Promise<string> | null = null;
export async function portalLogin(rawPhone: string, password: string, ip: string, ua: string): Promise<{ error?: string }> {
  const generic = { error: "رقم الجوال أو كلمة المرور غير صحيحة" };
  const phone = portalPhone(rawPhone);
  const u = phone ? (await tx(null, (c) => c.query("select * from app.portal_auth_lookup($1)", [phone]))).rows[0] : undefined;
  if (!u) { dummy ??= hashPassword("dummy-password-1"); await verifyPassword(await dummy, password); return generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) return { error: "الحساب اتقفل مؤقتًا بسبب محاولات غلط. جرّب بعد 15 دقيقة." };
  const ok = u.is_active && (await verifyPassword(u.password_hash, password));
  if (!ok) { await tx(null, (c) => c.query("select app.portal_auth_fail($1)", [u.id])); return generic; }
  const token = randomBytes(32).toString("base64url");
  await tx(null, (c) => c.query("select app.portal_session_create($1,$2,$3,$4,$5)", [u.id, sha256(token), TTL_HOURS, ip, ua]));
  (await cookies()).set(PORTAL_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/portal", maxAge: TTL_HOURS * 3600 });
  return {};
}

export async function portalLogout() {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (token) await tx(null, (c) => c.query("select app.portal_session_delete($1)", [sha256(token)]));
  jar.set(PORTAL_COOKIE, "", { path: "/portal", maxAge: 0 });
}

export async function portalTokenHash(): Promise<string> {
  return sha256((await cookies()).get(PORTAL_COOKIE)?.value ?? "");
}

/** A temporary password the staff hands to the client (easy to read out: no look-alike characters). */
export function tempPassword(): string {
  const A = "abcdefghjkmnpqrstuvwxyz", D = "23456789";
  const pick = (set: string, n: number) => Array.from(randomBytes(n), (b) => set[b % set.length]).join("");
  return `${pick(A, 4)}-${pick(D, 4)}-${pick(A, 3)}`;
}
