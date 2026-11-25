"use client";
import { useState } from "react";

type P = { user_id: string; name: string; role_name: string; seen: boolean; recalled_at: string | null };

/** «تراجع» dialog body: tick who loses the message. The rest keep it. */
export function RecallPicker({ people }: { people: P[] }) {
  const live = people.filter((p) => !p.recalled_at);
  const gone = people.filter((p) => p.recalled_at);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const shown = live.filter((p) => !q.trim() || p.name.includes(q.trim()) || p.role_name.includes(q.trim()));
  const all = live.length > 0 && picked.size === live.length;
  const flip = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="space-y-3 whitespace-normal text-sm">
      <p className="leading-7 text-ink-500">علّم على اللي عاوز تسحب منهم الرسالة. هتختفي من شاشتهم وإشعاراتهم بس، والباقيين هتفضل عندهم.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(live.map((p) => p.user_id)))} />
          الكل ({live.length})
        </label>
        {live.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر باسم أو دور…" className="min-w-0 flex-1 rounded-md border border-line px-3 py-1.5" />}
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-line p-2">
        {shown.map((p) => (
          <label key={p.user_id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-cream">
            <input type="checkbox" name="users" value={p.user_id} checked={picked.has(p.user_id)} onChange={() => flip(p.user_id)} />
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-ink-500">{p.role_name}</span>
            <span className={`ms-auto text-xs ${p.seen ? "text-good" : "text-ink-500"}`}>{p.seen ? "شافها" : "لسه"}</span>
          </label>
        ))}
        {live.filter((p) => !shown.includes(p) && picked.has(p.user_id)).map((p) => <input key={p.user_id} type="hidden" name="users" value={p.user_id} />)}
        {shown.length === 0 && <p className="px-2 py-1.5 text-ink-500">مفيش حد بالاسم ده</p>}
      </div>
      {gone.length > 0 && <p className="text-xs leading-6 text-ink-500">اتسحبت قبل كده من: {gone.map((p) => p.name).join("، ")}</p>}
      <p className="text-xs text-ink-500">{picked.size === 0 ? "لسه ما اخترتش حد" : `هتتسحب من ${picked.size}${all ? " (الكل) — ومش هتقبل ردود تانية" : ""}`}</p>
    </div>
  );
}
