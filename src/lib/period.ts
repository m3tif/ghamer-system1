/** Dashboard period from the URL: today / week / month / custom (company time zone, inclusive dates). */
import { toLocalInput } from "@/lib/format";
const D = /^\d{4}-\d{2}-\d{2}$/;
export type Period = { key: "today" | "week" | "month" | "custom"; from: string; to: string };
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export function readPeriod(sp: { p?: string; from?: string; to?: string }): Period {
  const today = toLocalInput(new Date()).slice(0, 10);
  if (sp.p === "today") return { key: "today", from: today, to: today };
  if (sp.p === "week") return { key: "week", from: addDays(today, -6), to: today };
  if (sp.p === "custom" && D.test(sp.from ?? "") && D.test(sp.to ?? "")) {
    let [f, t] = [sp.from!, sp.to!]; if (t < f) [f, t] = [t, f];
    if ((new Date(t).getTime() - new Date(f).getTime()) / 864e5 > 366) f = addDays(t, -366);
    return { key: "custom", from: f, to: t };
  }
  return { key: "month", from: today.slice(0, 8) + "01", to: today };
}
