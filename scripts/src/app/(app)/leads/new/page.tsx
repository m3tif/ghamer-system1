import { requirePerm, requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { LeadForm } from "@/components/lead-form";
import { getTimezone, tzLabel } from "@/lib/format";

export const metadata = { title: "تسجيل عميل جديد" };

export default async function NewLead() {
  const s = await requireSession(); await requirePerm(s, "leads.create");
  return (<><PageHeader title="تسجيل عميل جديد" sub="يتم فحص التكرار تلقائيًا قبل الحفظ. يُسجَّل اسمك ووقت التسجيل تلقائيًا." /><div className="max-w-6xl"><LeadForm tz={tzLabel(getTimezone())} /></div></>);
}
