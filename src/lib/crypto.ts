import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const b = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");
  if (b.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32)");
  return b;
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decrypt(enc: string): string {
  const raw = Buffer.from(enc, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
