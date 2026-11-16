import Link from "next/link";
import type { ReactNode } from "react";
import { adminAttention, techPerformance } from "@/server/data";
import { HBars } from "@/components/finance/charts";
import { fmtMins, fmtSar, monthStart } from "@/lib/format";
import { SOURCES, TEMPERATURE } from "@/lib/labels";

const num = (v: unknown) => Number(v ?? 0).toLocaleString("en");
function Head({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div><h2 className="flex items-center gap-2 text-lg font-extrabold text-[#1b2a41]"><span className="h-5 w-1 rounded-full bg-[#b8955a]" />{title}</h2>{sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}</div>{right}
    </div>);
}
const panel = "min-w-0 rounded-2xl border border-[#e7dfcf] bg-white p-5 shadow-[0_1px_2px_rgba(27,42,65,.04),0_8px_24px_-12px_rgba(27,42,65,.12)]";
function Tile({ label, value, href, hot, hint }: { label: string; value: ReactNode; href: string; hot?: boolean; hint?: string }) {
  return (
    <Link href={href} className={`group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition hover:-translate-y-0.5 ${hot ? "border-burgundy-600/30 bg-burgundy-50/60 hover:border-burgundy-600/60" : "border-[#e7dfcf] bg-white hover:border-[#b8955a]/60"}`}>
      <span className="min-w-0"><span className="block text-sm font-semibold text-charcoal">{label}</span>{hint && <span className="block text-[11px] text-ink-500">{hint}</span>}</span>
      <span className={`text-2xl font-extrabold tabular-nums ${hot ? "text-burgundy-700" : "text-[#1b2a41]"}`}>{value}</span>
    </Link>);
}

/** Everything across the company that waits on someone — each tile opens the list behind it. */
export async function AdminAttention({ uid }: { uid: string }) {
  const a = await adminAttention(uid);
  const groups: { title: string; tiles: { label: string; v: number | string; href: string; hot?: boolean; hint?: string }[] }[] = [
    { title: "المبيعات والعملاء", tiles: [
      { label: "مستنيين توزيع على سيلز", v: a.pending_distribution, href: "/distribution", hot: a.pending_distribution > 0 },
      { label: "مستنيين قرار السيلز", v: a.pending_sales, href: "/leads?status=Pending%20Sales%20Review" },
      { label: "رفضهم السيلز ومستنيين متابعة", v: a.rejected_waiting, href: "/leads?status=Rejected%20by%20Sales", hot: a.rejected_waiting > 0 },
      { label: "مراجعات تكرار مفتوحة", v: a.open_reviews, href: "/duplicates", hot: a.open_reviews > 0 },
      { label: "متابعات فات ميعادها", v: a.followups_overdue, href: "/follow-ups", hot: a.followups_overdue > 0 },
      { label: "اجتماعات النهارده", v: a.meetings_today, href: "/meetings", hint: `${num(a.meetings_upcoming)} جاية في المجمل` },
      { label: "اجتماعات فات ميعادها من غير نتيجة", v: a.meetings_no_outcome, href: "/meetings", hot: a.meetings_no_outcome > 0 }] },
    { title: "المالية", tiles: [
      { label: "عقود مستنية المالية", v: a.contracts_waiting, href: "/?cs=submitted#contracts", hot: a.contracts_late > 0, hint: a.contracts_late ? `${num(a.contracts_late)} منهم أكتر من يومين` : undefined },
      { label: "دفعات مستنية تأكيد", v: a.payments_pending, href: "/contracts", hot: a.payments_pending > 0 },
      { label: "فلوس متأخرة على العملاء", v: fmtSar(a.overdue_money), href: "/#money", hot: Number(a.overdue_money) > 0 },
      { label: "عقود بتخلص خلال 30 يوم", v: a.contracts_ending_30, href: "/?cs=approved#contracts", hint: "وقت التجديد" }] },
    { title: "التشغيل والفريق التقني", tiles: [
      { label: "عملاء مستنيين أكاونت مانجر", v: a.ops_new, href: "/operations", hot: a.ops_new > 0, hint: a.ops_no_packages ? `${num(a.ops_no_packages)} عميل قائم من غير باقات` : undefined },
      { label: "تاسكات مستنية مراجعة", v: a.tasks_review, href: "/tasks?f=review", hot: a.tasks_review > 0 },
      { label: "تاسكات مستنية موافقة العميل", v: a.tasks_client, href: "/tasks?f=client" },
      { label: "تاسكات متأخرة", v: a.tasks_late, href: "/tasks?f=late", hot: a.tasks_late > 0 }] },
  ];
  const hot = groups.flatMap((g) => g.tiles).filter((t) => t.hot).length;
  return (
    <section>
      <Head title="محتاج تدخلك" sub="كل حاجة مستنية حد في الشركة — اضغط على أي رقم يفتحلك القايمة" right={<span className={`rounded-full px-3 py-1 text-xs font-bold ${hot ? "bg-burgundy-600 text-white" : "bg-ok/10 text-ok"}`}>{hot ? `${hot} حاجة محتاجة تدخل` : "كله تمام ✓"}</span>} />
      <div className="grid gap-4 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g.title} className={panel}>
            <h3 className="mb-3 font-bold text-[#1b2a41]">{g.title}</h3>
            <div className="space-y-2">{g.tiles.map((t) => <Tile key={t.label} label={t.label} value={typeof t.v === "number" ? num(t.v) : t.v} href={t.href} hot={t.hot} hint={t.hint} />)}</div>
          </div>))}
      </div>
    </section>
  );
}

/** Operations and the technical team: account managers' load and the team's month. */
export async function AdminOps({ uid }: { uid: string }) {
  const [a, perf] = await Promise.all([adminAttention(uid), techPerformance(uid, monthStart())]);
  return (
    <section>
      <Head title="التشغيل والفريق التقني" sub="العملاء مع كل أكاونت مانجر، وأداء الفريق التقني الشهر ده"
        right={<span className="flex gap-2"><Link href="/operations" className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-cream">العملاء المعتمدين</Link><Link href="/tasks/performance" className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-cream">تقرير الأداء</Link></span>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["عملاء مع أكاونت مانجر", a.ops_assigned, "/operations?tab=assigned"], ["تاسكات مفتوحة", a.tasks_open, "/tasks?f=open"], ["تاسكات اتعتمدت الشهر ده", a.tasks_done_month, "/tasks?f=done"], ["تاسكات متأخرة", a.tasks_late, "/tasks?f=late"]].map(([l, v, h]) => (
          <Link key={l as string} href={h as string} className="rounded-2xl border border-[#e7dfcf] bg-white p-4 transition hover:border-[#b8955a]/60"><p className="text-xs text-ink-500">{l}</p><p className="mt-1 text-2xl font-extrabold tabular-nums text-[#1b2a41]">{num(v)}</p></Link>))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className={panel}>
          <h3 className="mb-3 font-bold text-[#1b2a41]">الأكاونت مانجر</h3>
          {(a.per_am as any[]).length === 0 ? <p className="text-sm text-ink-500">مفيش أكاونت مانجر عنده حساب لسه.</p> : (
            <table className="w-full text-sm"><thead className="text-xs text-ink-500"><tr><th className="py-1 text-start font-medium">الاسم</th><th className="font-medium">عملاء</th><th className="font-medium">تاسكات مفتوحة</th><th className="font-medium">متأخرة</th><th className="font-medium">مستنية مراجعته</th></tr></thead>
              <tbody className="divide-y divide-line">{(a.per_am as any[]).map((m) => (
                <tr key={m.id}><td className="py-2 font-semibold">{m.full_name}</td><td className="text-center tabular-nums">{m.clients}</td><td className="text-center tabular-nums">{m.open_tasks}</td>
                  <td className={`text-center tabular-nums ${m.late_tasks ? "font-bold text-bad" : ""}`}>{m.late_tasks}</td><td className={`text-center tabular-nums ${m.to_review ? "font-bold text-warn" : ""}`}>{m.to_review}</td></tr>))}</tbody></table>)}
        </div>
        <div className={panel}>
          <h3 className="mb-3 font-bold text-[#1b2a41]">الفريق التقني — الشهر ده</h3>
          {perf.length === 0 ? <p className="text-sm text-ink-500">مفيش موظفين تقنيين لسه.</p> : (
            <table className="w-full text-sm"><thead className="text-xs text-ink-500"><tr><th className="py-1 text-start font-medium">الموظف</th><th className="font-medium">اتبعتله</th><th className="font-medium">اتعتمد</th><th className="font-medium">في الميعاد</th><th className="font-medium">الوقت</th><th className="font-medium">متأخر</th></tr></thead>
              <tbody className="divide-y divide-line">{perf.map((r) => (
                <tr key={r.employee_id}><td className="py-2"><span className="font-semibold">{r.full_name}</span><span className="block text-[11px] text-ink-500">{r.role_name}</span></td>
                  <td className="text-center tabular-nums">{r.assigned}</td><td className="text-center tabular-nums">{r.approved}</td>
                  <td className="text-center tabular-nums">{r.on_time_base ? `${Math.round((r.on_time / r.on_time_base) * 100)}%` : "—"}</td>
                  <td className="whitespace-nowrap text-center tabular-nums">{fmtMins(r.minutes)}</td><td className={`text-center tabular-nums ${r.late_now ? "font-bold text-bad" : ""}`}>{r.late_now}</td></tr>))}</tbody></table>)}
        </div>
      </div>
    </section>
  );
}

/** Where the clients come from and how warm they are — each bar opens the matching clients. */
export async function AdminSources({ uid }: { uid: string }) {
  const a = await adminAttention(uid);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className={panel}><h3 className="mb-4 font-bold text-[#1b2a41]">مصادر العملاء (من أول السيستم)</h3>
        <HBars rows={(a.sources as any[]).map((x) => ({ label: SOURCES[x.src] ?? x.src, value: x.n, tone: "gold" as const }))} /></div>
      <div className={panel}><h3 className="mb-4 font-bold text-[#1b2a41]">درجة التواصل</h3>
        <HBars rows={(a.temperature as any[]).map((x) => ({ label: x.t === "none" ? "غير مصنّف" : TEMPERATURE[x.t] ?? x.t, value: x.n, tone: x.t === "hot" ? "wine" as const : "navy" as const, href: x.t === "none" ? undefined : `/leads?temp=${x.t}` }))} /></div>
    </div>
  );
}
