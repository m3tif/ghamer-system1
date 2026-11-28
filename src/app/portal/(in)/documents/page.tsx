import { requirePortal } from "@/lib/portal-auth";
import { pickProject } from "@/server/portal-data";
import { Files, NoProject, PageTitle, Panel, ProjectSwitch, Upload } from "@/components/portal/ui";

export const metadata = { title: "الملفات" };

export default async function PortalDocuments({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ps = await requirePortal();
  const { list, cur, project: j } = await pickProject(ps.accountId, (await searchParams).p);
  if (!cur || !j) return <NoProject />;
  const files = j.files as any[];
  const ours = files.filter((f) => !f.from_client), yours = files.filter((f) => f.from_client);
  return (
    <>
      <ProjectSwitch list={list} cur={cur.ops_id} base="/portal/documents" />
      <PageTitle title="الملفات" sub="ملفات مشروعك في مكان واحد. اللي بعتهولك الفريق، واللي إنت رفعته." />
      <Panel title="ارفع ملف للفريق" className="mb-5">
        <Upload ops={cur.ops_id} label="رفع" />
        <p className="mt-2 text-xs text-ink-500">PDF أو صورة أو Word أو Excel، لحد 4 ميجا. للملفات الأكبر ابعت رابط في طلب دعم.</p>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`من فريق غامر (${ours.length})`}><Files files={ours} empty="لسه مفيش ملفات من الفريق." /></Panel>
        <Panel title={`اللي إنت رفعته (${yours.length})`}><Files files={yours} empty="لسه مارفعتش ملفات." /></Panel>
      </div>
    </>
  );
}
