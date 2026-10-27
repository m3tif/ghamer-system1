/**
 * Company time zone: ONE setting (settings.timezone, default Asia/Riyadh) used by the database and by every screen.
 * Times are stored as UTC instants (timestamptz). Typed times are converted with the real time-zone rules (DST included),
 * and shown back in the same zone, so what the user typed is exactly what is displayed.
 */
let TZ = process.env.APP_TIMEZONE || "Asia/Riyadh";
const make = (tz: string) => ({
  dt: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }),
  d: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: tz, dateStyle: "medium" }),
  day: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }),
});
let F = make(TZ);

export const isValidTimezone = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
export function setTimezone(tz: string) { if (tz && tz !== TZ && isValidTimezone(tz)) { TZ = tz; F = make(tz); } }
export const getTimezone = () => TZ;

export const fmtDateTime = (v: string | Date | null | undefined) => (v ? F.dt.format(new Date(v)) : "—");
export const fmtDate = (v: string | Date | null | undefined) => (v ? F.d.format(new Date(v)) : "—");
export const fmtDay = (v: string | Date) => F.day.format(new Date(v));
export const fmtMoney = (v: string | number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("ar-SA-u-nu-latn", { style: "currency", currency: "SAR", maximumFractionDigits: 0 }).format(Number(v));
export const fmtNum = (v: number | string | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("ar-SA-u-nu-latn").format(Number(v)));
export const fmtPct = (v: number | string | null | undefined) => (v == null ? "غير قابل للحساب" : `${Number(v)}%`);

/** Offset (minutes) of `tz` from UTC at the given instant. */
function offsetMin(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((x) => x.type === t)!.value);
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs) / 60000);
}

/** "2026-10-10T14:30" as typed by the user (company time) → ISO instant. null if invalid or non-existent (DST gap). */
export function parseLocal(local: string | null | undefined, tz: string = TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local ?? "");
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = guess - offsetMin(guess, tz) * 60000;
  t = guess - offsetMin(t, tz) * 60000;
  if (isNaN(t) || toLocalInput(new Date(t), tz) !== (local as string).slice(0, 16)) return null;
  return new Date(t).toISOString();
}
/** ISO instant → "YYYY-MM-DDTHH:mm" in company time (value for <input type="datetime-local">). */
export function toLocalInput(v: string | Date, tz: string = TZ): string {
  const ms = new Date(v).getTime();
  return new Date(ms + offsetMin(ms, tz) * 60000).toISOString().slice(0, 16);
}
const CITY: Record<string, string> = { "Asia/Riyadh": "الرياض", "Africa/Cairo": "القاهرة", "Asia/Dubai": "دبي", "Asia/Kuwait": "الكويت" };
/** e.g. "توقيت الرياض (GMT+3)" — shown next to every date/time input. */
export function tzLabel(tz: string = TZ): string {
  const off = offsetMin(Date.now(), tz) / 60;
  return `توقيت ${CITY[tz] ?? tz} (GMT${off >= 0 ? "+" : "-"}${Math.abs(off)})`;
}
/** First day of the current month in company time, as YYYY-MM-01. */
export const monthStart = (date = new Date()) => `${toLocalInput(date).slice(0, 7)}-01`;
