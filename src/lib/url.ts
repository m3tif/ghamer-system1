/** Only real http(s) links are made clickable (blocks javascript:, data:, etc.). */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}
export function hostOf(raw: string | null | undefined): string {
  const u = safeHttpUrl(raw);
  return u ? new URL(u).hostname.replace(/^www\./, "") : String(raw ?? "");
}
