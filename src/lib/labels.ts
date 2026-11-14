export const LEAD_STATUS: Record<string, string> = {
  "New Lead": "عميل جديد", "Contacted": "تم التواصل", "No Answer": "لم يرد", "Interested": "مهتم",
  "Not Interested": "غير مهتم", "Follow-up Required": "يحتاج متابعة", "Qualified Lead": "عميل مؤهل",
  "Pending Sales Review": "بانتظار قرار السيلز", "Accepted by Sales": "مقبول من السيلز", "Rejected by Sales": "مرفوض من السيلز",
  "Meeting Scheduled": "تم حجز اجتماع", "Meeting Completed": "تم الاجتماع", "Invalid Contact": "بيانات غير صالحة",
};
export const LEAD_STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "brand"> = {
  "New Lead": "neutral", "Contacted": "brand", "No Answer": "warn", "Interested": "ok", "Not Interested": "bad",
  "Follow-up Required": "warn", "Qualified Lead": "ok", "Pending Sales Review": "warn", "Accepted by Sales": "ok", "Rejected by Sales": "bad", "Meeting Scheduled": "brand", "Meeting Completed": "ok", "Invalid Contact": "bad",
};
/** Statuses a person can choose when logging a call. Meeting statuses are set by the meeting workflow only. */
export const CALL_STATUSES = ["Contacted", "No Answer", "Interested", "Not Interested", "Follow-up Required", "Qualified Lead", "Invalid Contact"];
export const NEEDS_FOLLOWUP = ["Follow-up Required"];
export const HANDOFF_STATUS: Record<string, string> = {
  pending_distribution: "بانتظار توزيع الإدارة", pending_review: "بانتظار قرار السيلز", accepted: "قبله السيلز", rejected: "رفضه السيلز", cancelled: "ملغي",
};
export const HANDOFF_TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "brand"> = {
  pending_distribution: "warn", pending_review: "warn", accepted: "ok", rejected: "bad", cancelled: "neutral",
};
export const TEMPERATURE: Record<string, string> = { cold: "Cold", warm: "Warm", hot: "Hot" };
export const TEMPERATURE_TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "brand"> = { cold: "brand", warm: "warn", hot: "bad" };
export const REJECT_REASON: Record<string, string> = {
  incomplete_info: "بيانات ناقصة أو غير كافية", not_qualified: "العميل غير مؤهل", out_of_scope: "الخدمة المطلوبة خارج نطاقنا",
  unreachable: "لا يمكن التواصل مع العميل", duplicate: "عميل مكرر", other: "سبب آخر (اكتب ملاحظة)",
};
export const MEETING_TYPE: Record<string, string> = { online: "أونلاين", in_person: "حضوري", phone: "مكالمة هاتفية" };
export const OUTCOME: Record<string, string> = {
  positive: "إيجابي، نتقدم للخطوة التالية", needs_followup: "يحتاج متابعة", undecided: "لم يحسم قراره", not_interested: "غير مهتم",
};
export const ACHIEVEMENT: Record<string, string> = {
  leads_10: "10 عملاء هذا الشهر", leads_25: "25 عميلًا هذا الشهر", leads_50: "50 عميلًا هذا الشهر", leads_100: "100 عميل هذا الشهر",
  goal_new_leads: "حققت هدف العملاء الشهري", meetings_1: "أول اجتماع منعقد", meetings_5: "5 اجتماعات منعقدة", meetings_10: "10 اجتماعات منعقدة",
  meetings_20: "20 اجتماعًا منعقدًا", goal_meetings: "حققت هدف الاجتماعات الشهري",
};
/** Encouraging line for the number of leads added this month. Pure text: the numbers come from the database. */
export function encourage(count: number, goal: number | null, newAch: string[]): { title: string; text: string; level: "info" | "good" | "great" } {
  if (newAch.includes("leads_100")) return { title: "إنجاز مميز: 100 عميل!", text: "وصلت إلى 100 عميل هذا الشهر. أداء استثنائي، شكرًا على هذا المجهود الكبير.", level: "great" };
  if (newAch.includes("goal_new_leads")) return { title: "أحسنت! وصلت إلى هدفك الشهري.", text: `سجّلت ${count} عميلًا وحققت هدفك. استمر بنفس الحماس.`, level: "great" };
  if (newAch.some((c) => /^leads_/.test(c))) return { title: "إنجاز جديد! استمر في التقدم.", text: `وصلت إلى ${count} عميلًا هذا الشهر.`, level: "good" };
  if (goal && count < goal) {
    const left = goal - count;
    return { title: count >= goal * 0.8 ? "ممتاز! أنت قريب جدًا من هدفك." : "تم الحفظ", text: `${count} من ${goal} هذا الشهر، باقي ${left}.`, level: count >= goal * 0.5 ? "good" : "info" };
  }
  return { title: count >= 5 ? "ممتاز! أنت تحقق تقدمًا رائعًا." : "تم حفظ العميل", text: `عدد عملائك هذا الشهر: ${count}.`, level: count >= 5 ? "good" : "info" };
}
export const MILESTONES = [10, 25, 50, 100];
export const nextMilestone = (n: number) => MILESTONES.find((m) => m > n) ?? Math.ceil((n + 1) / 100) * 100;
export const MEETING_STATUS: Record<string, string> = {
  "Scheduled": "محجوز", "Confirmed": "مؤكد", "Completed": "منعقد", "Cancelled": "ملغي", "Rescheduled": "أُعيدت جدولته", "No Show": "لم يحضر",
};
export const DEAL_STAGES = [
  "New Lead", "Contacted", "Qualified", "Meeting Scheduled", "Meeting Completed", "Proposal Preparation", "Proposal Sent",
  "Negotiation", "Follow-up", "Postponed", "Contract Pending", "Signed / Finance Pending", "Financially Approved", "Lost",
] as const;
export const DEAL_STAGE: Record<string, string> = {
  "New Lead": "عميل جديد", "Contacted": "تم التواصل", "Qualified": "مؤهل", "Meeting Scheduled": "اجتماع محجوز",
  "Meeting Completed": "تم الاجتماع", "Proposal Preparation": "تجهيز العرض", "Proposal Sent": "تم إرسال العرض",
  "Negotiation": "تفاوض", "Follow-up": "متابعة", "Postponed": "مؤجل", "Contract Pending": "العقد قيد التوقيع",
  "Signed / Finance Pending": "تم الاتفاق / التوقيع", "Financially Approved": "معتمد ماليًا", "Lost": "خسرناه",
};
export const SOURCES: Record<string, string> = {
  cold_call: "اتصال مباشر", meta_ads: "إعلانات ميتا", website: "نموذج الموقع", referral: "ترشيح من عميل",
  whatsapp: "واتساب", social: "السوشيال ميديا", exhibition: "معرض / فعالية", other: "أخرى", legacy: "عميل قديم", unknown: "غير محدد",
};
export const SERVICES: Record<string, string> = {
  social_media: "إدارة السوشيال ميديا", paid_ads: "الإعلانات المدفوعة", seo: "SEO", branding: "الهوية البصرية",
  website: "تطوير مواقع", content: "إنتاج محتوى", video: "إنتاج فيديو", other: "أخرى",
};
export const ROLE_GROUP_TELE = ["tele_sales", "tele_sales_manager"];
export const ROLE_GROUP_SALES = ["sales_rep", "sales_manager"];
export const FOLLOWUP_STATUS: Record<string, string> = { open: "مفتوحة", done: "تمت", cancelled: "ملغاة" };
export const METRIC: Record<string, string> = { new_leads: "عملاء جدد", completed_meetings: "اجتماعات منعقدة", deals_won: "صفقات مغلقة", contracted_revenue: "إيراد متعاقد عليه" };
export const ENTITY: Record<string, string> = {
  clients: "عميل", leads: "عميل محتمل", meetings: "اجتماع", deals: "صفقة", targets: "تارجت", users: "حساب", employees: "موظف",
  team_memberships: "فريق", role_permissions: "صلاحيات", settings: "إعدادات", follow_ups: "متابعة", lead_assignments: "إسناد",
  duplicate_reviews: "مراجعة تكرار", contracts: "عقد", contract_services: "خدمة في عقد", payment_installments: "قسط", attachments: "ملف مرفق", lead_handoffs: "تحويل إلى Sales", achievements: "إنجاز", client_contacts: "بيانات تواصل", client_stores: "متجر", client_identifiers: "معرّف عميل",
};

// ───────── Phase 2: contracts ─────────
export const CONTRACT_STATUS: Record<string, string> = { draft: "مسودة", submitted: "عند المالية", returned: "رجع للتعديل", approved: "معتمد ماليًا", cancelled: "ملغي" };
export const CONTRACT_STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "brand"> = { draft: "neutral", submitted: "brand", returned: "warn", approved: "ok", cancelled: "bad" };
export const PACKAGE: Record<string, string> = { monthly: "شهرية", quarterly: "ربع سنوية", semiannual: "نصف سنوية", annual: "سنوية", one_time: "مرة واحدة", custom: "مخصصة" };
export const PACKAGE_MONTHS: Record<string, number | null> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, one_time: 1, custom: null };
export const PAYMENT_METHOD: Record<string, string> = { bank_transfer: "تحويل بنكي", cash: "نقدي", card: "بطاقة", payment_link: "رابط دفع", other: "أخرى" };
export const INSTALLMENT_KIND: Record<string, string> = { down_payment: "مقدم", installment: "قسط", full: "دفعة كاملة" };
export const FILE_KIND: Record<string, string> = { signed_contract: "العقد الموقّع", other: "مستند آخر" };
