import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { parse } from "tldts";

/** Arabic-Indic / Persian digits → Latin digits. */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Any phone format → E.164 (e.g. 0501234567 and +966501234567 → +966501234567). null if invalid. */
export function normalizePhone(raw: string, defaultCountry: CountryCode = "SA"): string | null {
  const cleaned = toLatinDigits(raw).replace(/[\s\-().\u200f\u200e]/g, "");
  if (!cleaned) return null;
  const withPlus = cleaned.startsWith("00") ? "+" + cleaned.slice(2) : cleaned;
  const p = parsePhoneNumberFromString(withPlus, defaultCountry);
  return p && p.isValid() ? p.number : null;
}

/** Platforms where the identity of a store is the host + first path segment. */
const PATH_PLATFORMS = new Set([
  "instagram.com", "facebook.com", "tiktok.com", "x.com", "twitter.com", "snapchat.com",
  "linktr.ee", "youtube.com", "salla.sa", "store.salla.sa", "zid.sa", "zid.store",
]);
/** Platforms where each store is a sub-domain of a shared domain. */
const SUBDOMAIN_PLATFORMS = new Set([
  "myshopify.com", "zid.store", "salla.sa", "wixsite.com", "blogspot.com", "wordpress.com",
  "vercel.app", "netlify.app", "github.io", "business.site", "mystrikingly.com",
]);

export type StoreKey = { raw: string; key: string };

/**
 * Normalises a store URL into a stable key so tracking params, www, http/https,
 * trailing slashes and case never hide a duplicate.
 *  - https://www.Example.com/?utm_source=x  → example.com
 *  - https://shop.example.com/products/1    → example.com
 *  - https://foo.myshopify.com/             → foo.myshopify.com
 *  - https://instagram.com/Brand/?hl=ar     → instagram.com/brand
 */
export function normalizeStoreUrl(raw: string): StoreKey | null {
  let s = toLatinDigits(raw).trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s.replace(/^\/\//, "");
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const info = parse(host);
  if (!info.domain || !info.hostname) return null;
  const registrable = info.domain;
  const firstSeg = u.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "").toLowerCase();
  if (PATH_PLATFORMS.has(host) || PATH_PLATFORMS.has(registrable)) {
    if (host === registrable && firstSeg) return { raw: raw.trim(), key: `${host}/${firstSeg}` };
    if (host !== registrable && SUBDOMAIN_PLATFORMS.has(registrable)) return { raw: raw.trim(), key: host };
    if (firstSeg) return { raw: raw.trim(), key: `${host}/${firstSeg}` };
  }
  if (SUBDOMAIN_PLATFORMS.has(registrable) && host !== registrable) return { raw: raw.trim(), key: host };
  return { raw: raw.trim(), key: registrable };
}
