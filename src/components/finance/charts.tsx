import Link from "next/link";

const NAVY = "#1b2a41", GOLD = "#b8955a", WINE = "#8b1e34";
const fmtDay = (d: string) => { const [, m, day] = d.split("-"); return `${Number(day)}/${Number(m)}`; };

/** Day-by-day chart: bars = clients added, gold line = sent to Sales, wine dots = contracts. Hover shows the day's numbers; a day with contracts opens them. */
export function DailyChart({ rows, contractsHref }: { rows: { d: string; added: number; handed: number; meetings: number; contracts: number }[]; contractsHref: (day: string) => string }) {
  if (rows.length === 0) return null;
  const W = 760, H = 230, L = 34, B = 26, T = 12, w = (W - L - 8) / rows.length;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.added, r.handed, r.meetings, r.contracts)));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const step = Math.max(1, Math.ceil(rows.length / 12));
  const line = rows.map((r, i) => `${L + i * w + w / 2},${y(r.handed)}`).join(" ");
  const ticks = [0, Math.round(max / 2), max];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="تطور العملاء يوم بيوم" direction="ltr">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="#e2dacb" strokeDasharray={t ? "3 4" : undefined} /><text x={L - 6} y={y(t) + 4} fontSize="10" textAnchor="end" fill="#6b625f">{t}</text></g>)}
        {rows.map((r, i) => {
          const x = L + i * w, bw = Math.max(2, w * 0.62);
          const bar = (<g>
            <title>{`${r.d}\nعملاء جدد: ${r.added}\nاتحوّلوا للسيلز: ${r.handed}\nعملاء وصلوا لاجتماع: ${r.meetings}\nعقود: ${r.contracts}`}</title>
            <rect x={x} y={T} width={w} height={H - T - B} fill="transparent" />
            <rect x={x + (w - bw) / 2} y={y(r.added)} width={bw} height={Math.max(0, H - B - y(r.added))} rx={Math.min(3, bw / 3)} fill={NAVY} opacity={0.85} />
            {r.contracts > 0 && <circle cx={x + w / 2} cy={y(r.contracts)} r={4.5} fill={WINE} stroke="#fff" strokeWidth="1.5" />}
            {i % step === 0 && <text x={x + w / 2} y={H - 8} fontSize="10" textAnchor="middle" fill="#6b625f">{fmtDay(r.d)}</text>}
          </g>);
          return r.contracts > 0 ? <Link key={r.d} href={contractsHref(r.d)}>{bar}</Link> : <g key={r.d}>{bar}</g>;
        })}
        <polyline points={line} fill="none" stroke={GOLD} strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NAVY }} />عملاء جدد</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0.5 w-4" style={{ background: GOLD }} />اتحوّلوا للسيلز</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: WINE }} />عقود (اضغط عليها تفتح عقود اليوم)</span>
      </figcaption>
    </figure>
  );
}

/** Horizontal bars (stage distribution, comparisons). */
export function HBars({ rows, unit = "" }: { rows: { label: string; value: number; href?: string; tone?: "navy" | "gold" | "wine" }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const color = { navy: NAVY, gold: GOLD, wine: WINE };
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const inner = (<>
          <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate">{r.label}</span><span className="font-bold tabular-nums">{r.value.toLocaleString("en")}{unit}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-cream-dark/70"><div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color[r.tone ?? "navy"] }} /></div>
        </>);
        return <li key={r.label}>{r.href ? <Link href={r.href} className="block rounded-md p-1 -m-1 hover:bg-cream/70">{inner}</Link> : inner}</li>;
      })}
    </ul>
  );
}

/** Six months side by side: clients added vs contracts vs approved. */
export function MonthChart({ rows }: { rows: { m: string; added: number; contracts: number; approved: number }[] }) {
  const W = 520, H = 200, B = 26, T = 10, gw = (W - 20) / rows.length;
  const maxA = Math.max(1, ...rows.map((r) => r.added)), maxC = Math.max(1, ...rows.map((r) => Math.max(r.contracts, r.approved)));
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="آخر 6 شهور" direction="ltr">
        <line x1={10} x2={W - 10} y1={H - B} y2={H - B} stroke="#e2dacb" />
        {rows.map((r, i) => {
          const x = 10 + i * gw, bw = gw * 0.22, hA = (H - B - T) * (r.added / maxA), hC = (H - B - T) * (r.contracts / maxC) * 0.9, hP = (H - B - T) * (r.approved / maxC) * 0.9;
          return (
            <g key={r.m}>
              <title>{`${months[Number(r.m.slice(5, 7)) - 1]} ${r.m.slice(0, 4)}\nعملاء جدد: ${r.added}\nعقود: ${r.contracts}\nمعتمدة: ${r.approved}`}</title>
              <rect x={x + gw * 0.14} y={H - B - hA} width={bw} height={hA} rx="3" fill={NAVY} opacity=".85" />
              <rect x={x + gw * 0.39} y={H - B - hC} width={bw} height={hC} rx="3" fill={GOLD} />
              <rect x={x + gw * 0.64} y={H - B - hP} width={bw} height={hP} rx="3" fill={WINE} />
              <text x={x + gw / 2} y={H - 8} fontSize="11" textAnchor="middle" fill="#6b625f">{months[Number(r.m.slice(5, 7)) - 1]}</text>
            </g>);
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NAVY }} />عملاء جدد</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GOLD }} />عقود</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: WINE }} />عقود معتمدة</span>
        <span>(العقود على مقياس خاص بيها عشان تبان جنب العملاء)</span>
      </figcaption>
    </figure>
  );
}
