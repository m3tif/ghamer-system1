import { notFound, redirect } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { dealContract, getDeal, servicesList, vatRate } from "@/server/data";
import { PageHeader } from "@/components/ui";
import { ContractForm } from "@/components/contract-form";

export const metadata = { title: "عقد جديد" };
export const dynamic = "force-dynamic";

export default async function NewContract({ searchParams }: { searchParams: Promise<{ deal?: string }> }) {
  const s = await requireSession();
  if (!can(s, "deals.edit") && !can(s, "contracts.manage")) notFound();
  const { deal: dealId } = await searchParams;
  if (!dealId || !/^[0-9a-f-]{36}$/.test(dealId)) notFound();
  const data = await getDeal(s.userId, dealId);
  if (!data || ["Lost", "Financially Approved"].includes(data.deal.stage)) notFound();
  const existing = await dealContract(s.userId, dealId);
  if (existing) redirect(["draft", "returned"].includes(existing.status) ? `/contracts/${existing.id}/edit` : `/contracts/${existing.id}`);
  const [services, vat] = await Promise.all([servicesList(s.userId), vatRate(s.userId)]);
  const wanted: string[] = ((data.brief as any).required_services ?? []).filter((c: string) => services.some((x) => x.code === c));
  return (
    <>
      <PageHeader title={`عقد جديد — ${data.deal.client_name}`} sub={`${data.deal.business_name ?? ""} · السيلز: ${data.deal.owner_name}`} />
      <ContractForm dealId={dealId} services={services} vat={vat} initial={{
        package: "monthly", duration_months: "1", start_date: "", end_date: "", agreed_at: "", discount: "", payment_method: "bank_transfer", payment_terms: "", notes: "",
        items: (wanted.length ? wanted : [""]).map((c) => ({ service: c, description: "", amount: "" })), installments: [] }} />
    </>
  );
}
