/** Cell colours for marking leads quickly. Same keys as the database check in app.mark_cells. */
export const MARK_COLORS = [
  { key: "red", label: "أحمر", hex: "#fecaca" }, { key: "orange", label: "برتقالي", hex: "#fed7aa" }, { key: "yellow", label: "أصفر", hex: "#fef08a" },
  { key: "green", label: "أخضر", hex: "#bbf7d0" }, { key: "teal", label: "فيروزي", hex: "#99f6e4" }, { key: "blue", label: "أزرق", hex: "#bfdbfe" },
  { key: "purple", label: "بنفسجي", hex: "#e9d5ff" }, { key: "pink", label: "وردي", hex: "#fbcfe8" }, { key: "gray", label: "رمادي", hex: "#d4d4d8" },
] as const;
export const MARK_KEYS: string[] = MARK_COLORS.map((c) => c.key);
export const MARK_COLS = ["name", "store", "phone", "hunter", "date", "status", "notes", "dup", "time", "temp", "sales", "followup", "actions"] as const;
export type MarkColor = (typeof MARK_COLORS)[number]["key"];
