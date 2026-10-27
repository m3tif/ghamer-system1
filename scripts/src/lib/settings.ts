import { tx } from "./db";
import { isValidTimezone, setTimezone } from "./format";

let loadedAt = 0;
/** Reads the company time zone from settings (cached for a minute) so every page formats times the same way. */
export async function ensureTimezone(userId: string) {
  if (Date.now() - loadedAt < 60_000) return;
  const r = await tx(userId, (c) => c.query("select value #>> '{}' as tz from settings where key = 'timezone'"));
  const tz = r.rows[0]?.tz;
  if (tz && isValidTimezone(tz)) setTimezone(tz);
  loadedAt = Date.now();
}
