export const LEAD_STATUS: Record<string, string> = {
  "New": "جديد", "Not Answered": "لم يرد", "Call Back": "معاودة اتصال", "Interested": "مهتم",
  "Not Interested": "غير مهتم", "Follow-up Later": "متابعة لاحقًا", "Meeting Scheduled": "تم حجز اجتماع",
  "Meeting Completed": "تم الاجتماع", "Invalid Contact": "بيانات غير صالحة",
};
/** Statuses a person can choose when logging a call. Meeting statuses are set by the meeting workflow only. */
export const CALL_STATUSES = ["Not Answered", "Call Back", "Interested", "Not Interested", "Follow-up Later", "Invalid Contact"];
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
  "Signed / Finance Pending": "تم التوقيع — بانتظار المالية", "Financially Approved": "معتمد ماليًا", "Lost": "خسرناه",
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
export const METRIC: Record<string, string> = { completed_meetings: "اجتماعات منعقدة", deals_won: "صفقات مغلقة", contracted_revenue: "إيراد متعاقد عليه" };
export const ENTITY: Record<string, string> = {
  clients: "عميل", leads: "عميل محتمل", meetings: "اجتماع", deals: "صفقة", targets: "تارجت", users: "حساب", employees: "موظف",
  team_memberships: "فريق", role_permissions: "صلاحيات", settings: "إعدادات", follow_ups: "متابعة", lead_assignments: "إسناد",
  duplicate_reviews: "مراجعة تكرار", client_contacts: "بيانات تواصل", client_stores: "متجر", client_identifiers: "معرّف عميل",
};
