import { requirePerm, requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { LeadForm } from "@/components/lead-form";

export const metadata = { title: "إضافة عميل قائم" };

export default async function ExistingClient() {
  const s = await requireSession(); await requirePerm(s, "employees.manage");
  return (<><PageHeader title="إضافة عميل قائم" sub="للعملاء الحاليين قبل تشغيل النظام. يُسجَّل المصدر «عميل قديم» ولا يُنسب لأي موظف في التارجت أو العمولات." /><div className="max-w-4xl"><LeadForm legacy /></div></>);
}
