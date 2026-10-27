/** Turns database / validation errors into short Arabic messages. Never leaks SQL details. */
const MAP: [RegExp, string][] = [
  [/not allowed|permission denied|row-level security|no access|not found or no access|outside your team/i, "غير مصرح لك بتنفيذ هذا الإجراء"],
  [/reason required|note required/i, "السبب مطلوب"],
  [/follow-up date and reason/i, "تاريخ المتابعة وسببها مطلوبان لهذه المرحلة"],
  [/required for Lost/i, "سبب الخسارة مطلوب"],
  [/Finance only/i, "الاعتماد المالي يتم من قسم المالية فقط"],
  [/not accepted by sales yet/i, "لا يمكن حجز اجتماع قبل أن يقبل السيلز العميل"],
  [/handoff already decided/i, "تم اتخاذ قرار بشأن هذا العميل بالفعل"],
  [/no pending handoff/i, "لا يوجد عميل بانتظار قرارك"],
  [/invalid meeting link/i, "رابط الاجتماع غير صالح. يجب أن يبدأ بـ https:// ويكون رابطًا كاملًا"],
  [/can only be edited before its time/i, "لا يمكن تعديل اجتماع بعد موعده. سجّل نتيجته بدل ذلك"],
  [/outcome required/i, "اختر نتيجة الاجتماع"],
  [/next step text required/i, "اكتب الخطوة التالية عند تحديد موعد لها"],
  [/invalid meeting type/i, "نوع الاجتماع غير صالح"],
  [/invalid reject reason/i, "سبب الرفض غير صالح"],
  [/lead must be Interested/i, "يمكن تحويل العميل فقط إذا كانت حالته «مهتم» أو «مؤهل»"],
  [/lead already handed off/i, "هذا العميل محوَّل بالفعل وينتظر القرار"],
  [/check constraint|violates check/i, "قيمة غير صالحة في أحد الحقول"],
  [/already has an active meeting/i, "يوجد اجتماع نشط لهذا العميل بالفعل. عدّل موعده بدل حجز اجتماع جديد."],
  [/must be in the future/i, "يجب أن يكون الموعد في المستقبل"],
  [/already closed/i, "هذا الاجتماع مغلق ولا يمكن تعديله"],
  [/only the sales rep or a manager/i, "هذا الإجراء من السيلز المسؤول أو المدير فقط"],
  [/has not arrived yet/i, "لم يحن موعد الاجتماع بعد"],
  [/invalid sales representative|invalid target employee/i, "الموظف المختار غير صالح"],
  [/deal is closed/i, "الصفقة مغلقة"],
  [/duplicate key|unique/i, "هذا السجل موجود بالفعل"],
  [/at least one phone/i, "أدخل رقم جوال صالح"],
  [/name required/i, "الاسم مطلوب"],
  [/cannot change own status/i, "لا يمكنك تغيير حالة حسابك بنفسك"],
];
export function mapError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  for (const [re, ar] of MAP) if (re.test(m)) return ar;
  console.error("[unmapped error]", m);
  return "حدث خطأ غير متوقع. حاول مرة أخرى.";
}
