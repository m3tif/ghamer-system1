export const IMPORT_STATUS: Record<string, [string, "neutral" | "ok" | "warn" | "bad"]> = {
  staged: ["بانتظار التأكيد", "warn"], importing: ["قيد الاستيراد", "warn"], completed: ["مكتمل", "ok"], cancelled: ["ملغي", "neutral"], rolled_back: ["تم التراجع", "bad"],
};
