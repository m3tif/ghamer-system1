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

export type PhoneParse = { e164: string | null; country: string | null; national: string | null; possible: boolean; valid: boolean };

/**
 * Full parse: E.164 + detected country (from the +code when present, otherwise the selected country).
 * valid  = a real number for that country (libphonenumber metadata). possible = right length but unknown pattern (goes to review on import).
 */
export function parsePhone(raw: string, selectedCountry: CountryCode = "SA"): PhoneParse {
  const cleaned = toLatinDigits(raw ?? "").replace(/[\s\-().\u200f\u200e]/g, "");
  const none = { e164: null, country: null, national: null, possible: false, valid: false };
  if (!cleaned) return none;
  const withPlus = cleaned.startsWith("00") ? "+" + cleaned.slice(2) : cleaned;
  const p = parsePhoneNumberFromString(withPlus, selectedCountry);
  if (!p) return none;
  return { e164: p.number, country: p.country ?? selectedCountry, national: p.formatNational(), possible: p.isPossible(), valid: p.isValid() };
}

/** Countries offered in the phone selector (Gulf + Arab first, then common). Any other country still works by typing +code. */
export const PHONE_COUNTRIES: { code: CountryCode; dial: string; name: string }[] = [
  { code: "SA", dial: "+966", name: "السعودية" }, { code: "EG", dial: "+20", name: "مصر" },
  { code: "AE", dial: "+971", name: "الإمارات" }, { code: "KW", dial: "+965", name: "الكويت" },
  { code: "QA", dial: "+974", name: "قطر" }, { code: "BH", dial: "+973", name: "البحرين" },
  { code: "OM", dial: "+968", name: "عُمان" }, { code: "JO", dial: "+962", name: "الأردن" },
  { code: "LB", dial: "+961", name: "لبنان" }, { code: "IQ", dial: "+964", name: "العراق" },
  { code: "SY", dial: "+963", name: "سوريا" }, { code: "PS", dial: "+970", name: "فلسطين" },
  { code: "YE", dial: "+967", name: "اليمن" }, { code: "SD", dial: "+249", name: "السودان" },
  { code: "LY", dial: "+218", name: "ليبيا" }, { code: "TN", dial: "+216", name: "تونس" },
  { code: "DZ", dial: "+213", name: "الجزائر" }, { code: "MA", dial: "+212", name: "المغرب" },
  { code: "TR", dial: "+90", name: "تركيا" }, { code: "GB", dial: "+44", name: "بريطانيا" },
  { code: "US", dial: "+1", name: "أمريكا/كندا" }, { code: "DE", dial: "+49", name: "ألمانيا" },
  { code: "FR", dial: "+33", name: "فرنسا" }, { code: "IN", dial: "+91", name: "الهند" },
  { code: "PK", dial: "+92", name: "باكستان" }, { code: "BD", dial: "+880", name: "بنغلاديش" },
  { code: "PH", dial: "+63", name: "الفلبين" },
];
export const COUNTRY_CODES = new Set<string>(PHONE_COUNTRIES.map((c) => c.code));
export function asCountry(c: string | undefined | null): CountryCode { return (c && COUNTRY_CODES.has(c) ? c : "SA") as CountryCode; }

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
