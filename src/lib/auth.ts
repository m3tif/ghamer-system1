import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { cache } from "react";
import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { tx } from "./db";
import { decrypt, encrypt, sha256 } from "./crypto";

export const COOKIE = "gh_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);

export type Session = {
  userId: string; fullName: string; email: string; role: string; roleNameAr: string;
  mfaVerified: boolean; mfaRequired: boolean; mfaEnabled: boolean; mustChangePassword: boolean; perms: Set<string>;
};

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };
export const hashPassword = (p: string) => hash(p, ARGON);
let dummy: Promise<string> | null = null;

export function validatePasswordStrength(p: string): string | null {
  if (p.length < 10) return "كلمة المرور يجب ألا تقل عن 10 أحرف";
  if (!/[A-Za-z\u0600-\u06FF]/.test(p) || !/\d/.test(p)) return "كلمة المرور يجب أن تحتوي على حروف وأرقام";
  return null;
}

export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const r = await tx(null, (c) => c.query("select * from app.session_get($1)", [sha256(token)]));
  const s = r.rows[0];
  if (!s) return null;
  return {
    userId: s.user_id, fullName: s.full_name, email: s.email, role: s.role_code, roleNameAr: s.role_name_ar,
    mfaVerified: s.mfa_verified, mfaRequired: s.mfa_required, mfaEnabled: s.mfa_enabled, mustChangePassword: s.must_change_password, perms: new Set<string>(s.perms),
  };
});

/** Page guard: signed in, and MFA completed when the role requires it. */
export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if ((s.mfaRequired || s.mfaEnabled) && !s.mfaVerified) redirect("/mfa");
  if (s.mustChangePassword && !opts.allowPasswordChange) redirect("/account");
  return s;
}
export async function requirePerm(s: Session, perm: string) {
  if (!s.perms.has(perm)) notFound();
}
export const can = (s: Session, perm: string) => s.perms.has(perm);

export async function login(email: string, password: string, ip: string, ua: string): Promise<{ error?: string }> {
  const generic = { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  const r = await tx(null, (c) => c.query("select * from app.auth_lookup($1)", [email.trim().toLowerCase()]));
  const u = r.rows[0];
  if (!u) { dummy ??= hashPassword("dummy-password-1"); await verify(await dummy, password).catch(() => false); return generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) return { error: "تم قفل الحساب مؤقتًا بسبب محاولات خاطئة. حاول بعد 15 دقيقة." };
  const ok = u.is_active && (await verify(u.password_hash, password).catch(() => false));
  if (!ok) { await tx(null, (c) => c.query("select app.auth_fail($1)", [u.id])); return generic; }
  const token = randomBytes(32).toString("base64url");
  const needsMfa = u.mfa_required || u.mfa_enabled;
  await tx(null, async (c) => {
    await c.query("select app.auth_ok($1)", [u.id]);
    await c.query("select app.session_create($1,$2,$3,$4,$5,$6)", [u.id, sha256(token), !needsMfa, TTL_HOURS, ip, ua]);
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_HOURS * 3600,
  });
  return {};
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await tx(null, (c) => c.query("select app.session_delete($1)", [sha256(token)]));
  jar.delete(COOKIE);
}

// ───────── MFA (TOTP) ─────────
const totp = (b32: string, label: string) =>
  new OTPAuth.TOTP({ issuer: "Ghamer CRM", label, secret: OTPAuth.Secret.fromBase32(b32), digits: 6, period: 30, algorithm: "SHA1" });

/** Returns the otpauth URI for enrolment, creating (once) a pending secret for the user. */
export async function ensureEnrollment(s: Session): Promise<{ uri: string; base32: string }> {
  let enc: string | null = (await tx(s.userId, (c) => c.query("select app.mfa_secret($1) s", [s.userId]))).rows[0].s;
  if (!enc) {
    const secret = new OTPAuth.Secret({ size: 20 });
    enc = encrypt(secret.base32);
    await tx(s.userId, (c) => c.query("select app.mfa_begin($1,$2)", [s.userId, enc]));
  }
  const b32 = decrypt(enc!);
  return { uri: totp(b32, s.email).toString(), base32: b32 };
}

export async function verifyMfa(s: Session, code: string): Promise<boolean> {
  const enc: string | null = (await tx(s.userId, (c) => c.query("select app.mfa_secret($1) s", [s.userId]))).rows[0].s;
  if (!enc) return false;
  const ok = totp(decrypt(enc), s.email).validate({ token: code.replace(/\s/g, ""), window: 1 }) !== null;
  if (!ok) { await tx(null, (c) => c.query("select app.auth_fail($1)", [s.userId])); return false; }
  const token = (await cookies()).get(COOKIE)!.value;
  await tx(s.userId, async (c) => {
    if (!s.mfaEnabled) await c.query("select app.mfa_enable($1)", [s.userId]);
    await c.query("select app.session_mfa_ok($1)", [sha256(token)]);
  });
  return true;
}

export async function currentTokenHash(): Promise<string> {
  const token = (await cookies()).get(COOKIE)?.value ?? "";
  return sha256(token);
}
export const verifyPassword = (hashStr: string, pw: string) => verify(hashStr, pw).catch(() => false);
