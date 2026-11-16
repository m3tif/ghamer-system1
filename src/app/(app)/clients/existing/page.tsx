import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { servicesList } from "@/server/data";
import { PageHeader } from "@/components/ui";
import { LeadForm } from "@/components/lead-form";

export const metadata = { title: "إضافة عميل قائم" };

export default async function ExistingClient() {
  const s = await requireSession();
  if (!["super_admin", "operations_manager"].includes(s.role)) notFound();
  const packages = await servicesList(s.userId);
  return (<>
    <PageHeader title="إضافة عميل قائم" sub="لعميل شغالين معاه من قبل السيستم. بيروح على طول للمدير التقني: هي تحدد الباقات وتحوّله لأكاونت مانجر. مش بيتحسب لأي موظف في التارجت أو العمولات." />
    <div className="max-w-6xl"><LeadForm legacy packages={packages} /></div>
  </>);
}
