"use client";
import { inputCls } from "@/components/forms";

type T = { id: string; service_code: string | null; service_name: string | null; title: string; description: string | null; estimated_hours: string | null };
/** Picks a ready template and fills the task form fields next to it. */
export function TemplatePicker({ templates }: { templates: T[] }) {
  if (templates.length === 0) return null;
  const fill = (id: string) => {
    const t = templates.find((x) => x.id === id); if (!t) return;
    const set = (name: string, v: string) => { const el = document.getElementById(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null; if (el) el.value = v; };
    set("title", t.title); set("description", t.description ?? ""); set("estimated_hours", t.estimated_hours ? String(Number(t.estimated_hours)) : ""); set("service", t.service_code ?? "");
  };
  return (
    <div className="mb-4 rounded-md bg-cream/60 p-3">
      <label htmlFor="tpl" className="mb-1 block text-sm font-medium">قالب جاهز (اختياري)</label>
      <select id="tpl" defaultValue="" onChange={(e) => fill(e.target.value)} className={inputCls}>
        <option value="">اختار قالب يملى الخانات لوحده</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.service_name ? `${t.service_name} — ` : ""}{t.title}</option>)}
      </select>
    </div>
  );
}
