const TZ = "Asia/Riyadh";
const dt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const d = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: TZ, dateStyle: "medium" });
export const fmtDateTime = (v: string | Date | null | undefined) => (v ? dt.format(new Date(v)) : "—");
export const fmtDate = (v: string | Date | null | undefined) => (v ? d.format(new Date(v)) : "—");
export const fmtMoney = (v: string | number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("ar-SA-u-nu-latn", { style: "currency", currency: "SAR", maximumFractionDigits: 0 }).format(Number(v));
export const fmtNum = (v: number | string | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("ar-SA-u-nu-latn").format(Number(v)));
export const fmtPct = (v: number | string | null | undefined) => (v == null ? "غير قابل للحساب" : `${Number(v)}%`);

/** "2026-10-10T14:30" typed in the browser (Riyadh time, UTC+3, no DST) → ISO string. */
export function parseRiyadh(local: string | null | undefined): string | null {
  if (!local) return null;
  const t = new Date(`${local.length === 16 ? local + ":00" : local}+03:00`);
  return isNaN(t.getTime()) ? null : t.toISOString();
}
export const monthStart = (date = new Date()) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(date);
  return `${p}-01`;
};
export function toRiyadhInput(v: string | Date): string {
  const s = new Date(new Date(v).getTime() + 3 * 3600000).toISOString();
  return s.slice(0, 16);
}
