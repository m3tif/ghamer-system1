"use client";
import { useState } from "react";
import { PHONE_COUNTRIES, parsePhone, asCountry } from "@/lib/normalize";

const cls = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-burgundy-600 focus:ring-2 focus:ring-burgundy-600/20";

/** Phone input with a country selector. Typing a full +code number overrides the selected country. Sends `<name>` and `<name>_country`. */
export function PhoneField({ name, defaultValue = "", required, compact, placeholder }: {
  name: string; defaultValue?: string; required?: boolean; compact?: boolean; placeholder?: string;
}) {
  const [country, setCountry] = useState<string>("SA");
  const [val, setVal] = useState(defaultValue);
  const pp = val.trim() ? parsePhone(val, asCountry(country)) : null;
  const bad = pp && !pp.valid;
  return (
    <div>
      <div className="flex gap-1" dir="ltr">
        <select name={`${name}_country`} value={country} onChange={(e) => setCountry(e.target.value)} aria-label="الدولة"
          className={`${cls} !w-auto shrink-0 ${compact ? "px-1" : ""}`}>
          {PHONE_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.code} {c.dial}</option>)}
        </select>
        <input name={name} value={val} onChange={(e) => setVal(e.target.value)} required={required} dir="ltr" inputMode="tel" autoComplete="off"
          placeholder={placeholder ?? "رقم محلي أو +الدولي"} aria-invalid={bad ? true : undefined} className={`${cls} ${bad ? "!border-red-500" : ""}`} />
      </div>
      {bad && <p className="mt-1 text-xs text-red-700">الرقم غير صالح للدولة المختارة (للدولي اكتب +رمز الدولة)</p>}
      {pp?.valid && pp.e164 && <p className="mt-1 text-xs text-green-700" dir="ltr">{pp.e164}</p>}
    </div>
  );
}
