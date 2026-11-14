import { notFound, redirect } from "next/navigation";
import { requirePerm, requireSession } from "@/lib/auth";
import { contractGet, servicesList, vatRate } from "@/server/data";
import { PageHeader } from "@/components/ui";
import { ContractForm } from "@/components/contract-form";

export const metadata = { title: "تعديل العقد" };
export const dynamic = "force-dynamic";
const d = (v: unknown) => (v ? String(v).slice(0, 10) : "");

export default async function EditContract({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(); await requirePerm(s, "contracts.view");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await contractGet(s.userId, id);
  if (!data) notFound();
  const c = data.contract;
  if (!c.can_write || !["draft", "returned"].includes(c.status)) redirect(`/contracts/${id}`);
  const [services, vat] = await Promise.all([servicesList(s.userId), vatRate(s.userId)]);
  return (
    <>
      <PageHeader title={`تعديل العقد ${c.contract_no}`} sub={`${c.client_name} · السيلز: ${c.sales_name}`} />
      <ContractForm dealId={c.deal_id} services={services} vat={vat} initial={{
        package: c.package, duration_months: c.duration_months ? String(c.duration_months) : "", start_date: d(c.start_date), end_date: d(c.end_date), agreed_at: d(c.agreed_at),
        discount: Number(c.discount_amount) ? String(Number(c.discount_amount)) : "", payment_method: c.payment_method ?? "", payment_terms: c.payment_terms ?? "", notes: c.notes ?? "",
        items: data.items.map((i: any) => ({ service: i.service, description: i.description ?? "", amount: String(Number(i.amount)) })),
        installments: data.installments.map((i: any) => ({ kind: i.kind, due_date: d(i.due_date), amount: String(Number(i.amount)), note: i.note ?? "" })) }} />
    </>
  );
}
