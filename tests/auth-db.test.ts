import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hash, verify } from "@node-rs/argon2";
import * as OTPAuth from "otpauth";
import { setupDb, teardown, run, ids, admin } from "./helpers";
import { tx } from "../src/lib/db";
import { encrypt, decrypt, sha256 } from "../src/lib/crypto";

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  await setupDb("ghamer_auth_test");
});
afterAll(async () => { await teardown(); });

describe("accounts & sessions", () => {
  it("argon2 hashes verify and are not reversible plain text", async () => {
    const h = await hash("Sup3r-secret-pw", { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verify(h, "Sup3r-secret-pw")).toBe(true);
    expect(await verify(h, "wrong")).toBe(false);
  });
  it("account locks after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) await tx(null, (c) => c.query("select app.auth_fail($1)", [ids.tele1]));
    const r = await tx(null, (c) => c.query("select locked_until from app.auth_lookup('tele1@test.local')"));
    expect(new Date(r.rows[0].locked_until).getTime()).toBeGreaterThan(Date.now());
    await tx(null, (c) => c.query("select app.auth_ok($1)", [ids.tele1]));
    const ok = await tx(null, (c) => c.query("select locked_until from app.auth_lookup('tele1@test.local')"));
    expect(ok.rows[0].locked_until).toBeNull();
  });
  it("sessions: created, readable, expire, and die with the account", async () => {
    const t = "token-abc";
    await tx(null, (c) => c.query("select app.session_create($1,$2,true,12,'1.2.3.4','test')", [ids.tele1, sha256(t)]));
    const s = await tx(null, (c) => c.query("select * from app.session_get($1)", [sha256(t)]));
    expect(s.rows[0].role_code).toBe("tele_sales");
    expect(s.rows[0].perms).toContain("leads.create");
    expect(s.rows[0].perms).not.toContain("finance.approve");
    expect((await tx(null, (c) => c.query("select * from app.session_get($1)", [sha256("nope")]))).rowCount).toBe(0);
    await admin.query("update sessions set expires_at = now() - interval '1 minute' where token_hash = $1", [sha256(t)]);
    expect((await tx(null, (c) => c.query("select * from app.session_get($1)", [sha256(t)]))).rowCount).toBe(0);
    await tx(null, (c) => c.query("select app.session_create($1,$2,true,12,'','')", [ids.tele2, sha256("t2")]));
    await run("super", "select app.set_employee_active($1,false,'ترك العمل')", [ids.tele2]);
    expect((await tx(null, (c) => c.query("select * from app.session_get($1)", [sha256("t2")]))).rowCount).toBe(0);
  });
  it("only a Super Admin can create employees, and new accounts must change their password", async () => {
    const p = { email: "New@Test.local", password_hash: "x", role_code: "sales_rep", full_name: "جديد" };
    await expect(run("telemgr", "select app.create_employee($1::jsonb)", [JSON.stringify(p)])).rejects.toThrow(/not allowed/);
    const r = await run("super", "select app.create_employee($1::jsonb) id", [JSON.stringify(p)]);
    const u = await admin.query("select must_change_password, email from users where id = $1", [r.rows[0].id]);
    expect(u.rows[0]).toEqual({ must_change_password: true, email: "new@test.local" });
  });
  it("users cannot read the users table or other people's password hashes", async () => {
    await expect(run("tele1", "select password_hash from users")).rejects.toThrow(/permission denied/);
    const e = await run("tele1", "select * from employees");
    expect(e.rowCount).toBe(1); // only herself
  });
  it("own password change keeps only the current session", async () => {
    await tx(null, (c) => c.query("select app.session_create($1,$2,true,12,'','')", [ids.sales1, sha256("keep")]));
    await tx(null, (c) => c.query("select app.session_create($1,$2,true,12,'','')", [ids.sales1, sha256("other")]));
    await run("sales1", "select app.set_own_password('newhash', $1)", [sha256("keep")]);
    const left = await admin.query("select token_hash from sessions where user_id = $1", [ids.sales1]);
    expect(left.rows.map((r) => r.token_hash)).toEqual([sha256("keep")]);
  });
});

describe("MFA", () => {
  it("TOTP secret is stored encrypted and a valid code verifies", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const enc = encrypt(secret.base32);
    expect(enc).not.toContain(secret.base32);
    expect(decrypt(enc)).toBe(secret.base32);
    await tx(ids.fin, (c) => c.query("select app.mfa_begin($1,$2)", [ids.fin, enc]));
    const stored = (await admin.query("select mfa_secret_enc from users where id = $1", [ids.fin])).rows[0].mfa_secret_enc;
    expect(stored).toBe(enc);
    const totp = new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" });
    expect(totp.validate({ token: totp.generate(), window: 1 })).not.toBeNull();
    expect(totp.validate({ token: "000000", window: 1 })).toBeNull();
    await tx(ids.fin, (c) => c.query("select app.mfa_enable($1)", [ids.fin]));
    expect((await admin.query("select mfa_enabled from users where id = $1", [ids.fin])).rows[0].mfa_enabled).toBe(true);
  });
  it("secret cannot be replaced once MFA is enabled", async () => {
    await tx(ids.fin, (c) => c.query("select app.mfa_begin($1,'attacker')", [ids.fin]));
    const s = (await admin.query("select mfa_secret_enc from users where id = $1", [ids.fin])).rows[0].mfa_secret_enc;
    expect(s).not.toBe("attacker");
  });
  it("roles that must use MFA are flagged", async () => {
    const r = await admin.query("select code from roles where mfa_required order by code");
    expect(r.rows.map((x) => x.code)).toEqual(expect.arrayContaining(["super_admin", "general_manager", "finance_manager", "finance_employee", "sales_manager", "tele_sales_manager", "operations_manager"]));
    expect(r.rows.map((x) => x.code)).not.toContain("tele_sales");
  });
});
