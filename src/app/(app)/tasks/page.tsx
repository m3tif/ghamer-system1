import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/auth";
import { taskList } from "@/server/data";
import { Empty, PageHeader } from "@/components/ui";
import { TaskTable } from "@/components/task-table";

export const metadata = { title: "التاسكات" };
export const dynamic = "force-dynamic";

export default async function Tasks({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const s = await requireSession();
  const manager = can(s, "tasks.manage") || s.role === "general_manager";
  if (!manager && !can(s, "tasks.view_own")) notFound();
  const all = await taskList(s.userId, manager ? "all" : "mine");
  const f = (await searchParams).f ?? "open";
  const filters: [string, string, (t: (typeof all)[number]) => boolean][] = manager
    ? [["review", "مستني مراجعتي", (t) => t.status === "submitted"], ["client", "مستني العميل", (t) => t.status === "client_review"], ["late", "متأخر", (t) => t.late], ["open", "كل المفتوح", (t) => !["approved", "cancelled"].includes(t.status)], ["done", "معتمد", (t) => t.status === "approved"], ["cancelled", "اتلغى", (t) => t.status === "cancelled"]]
    : [["open", "شغلي الحالي", (t) => !["approved", "cancelled", "submitted", "client_review"].includes(t.status)], ["review", "سلّمته ومستني مراجعة", (t) => ["submitted", "client_review"].includes(t.status)], ["late", "متأخر", (t) => t.late], ["done", "معتمد", (t) => t.status === "approved"]];
  const cur = filters.find((x) => x[0] === f) ?? filters[0];
  const rows = all.filter(cur[2]);
  return (
    <>
      <PageHeader title={manager ? "التاسكات" : "تاسكاتي"} sub={manager ? "كل تاسكات عملائك. التاسكات بتتعمل من صفحة العميل." : "التاسكات اللي اتبعتتلك. افتح التاسك عشان تشغّل العدّاد وتسلّم."}
        actions={<>{["super_admin", "operations_manager"].includes(s.role) && <Link href="/tasks/templates" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">مراحل الباقات</Link>}
          {["super_admin", "general_manager", "operations_manager"].includes(s.role) && <Link href="/tasks/performance" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream">أداء الفريق</Link>}</>} />
      <div className="mb-5 flex flex-wrap gap-2">
        {filters.map(([k, label, fn]) => (
          <Link key={k} href={`/tasks?f=${k}`} className={`rounded-md px-3 py-1.5 text-sm font-medium ${k === cur[0] ? "bg-burgundy-600 text-white" : "border border-line bg-white hover:bg-cream"}`}>{label} ({all.filter(fn).length})</Link>))}
      </div>
      {rows.length === 0 ? <Empty title="مفيش تاسكات هنا" /> : <TaskTable rows={rows} showAssignee={manager} />}
    </>
  );
}
