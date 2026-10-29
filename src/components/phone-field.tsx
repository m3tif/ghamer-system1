"use client";
import { useState } from "react";
import { parsePhoneAny } from "@/lib/normalize";

const cls = "w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] placeholder:text-ink-300 focus:border-burgundy-600";

/** Any number, any country, typed as the employee likes (05…, 01…, +20…, 00971…). Only the length is checked (6–15 digits). */
export function PhoneField({ name, defaultValue = "", required, placeholder }: { name: string; defaultValue?: string; required?: boolean; compact?: boolean; placeholder?: string }) {
  const [val, setVal] = useState(defaultValue);
  const bad = val.trim() !== "" && !parsePhoneAny(val).value;
  return (
    <div>
      <input name={name} value={val} onChange={(e) => setVal(e.target.value)} required={required} dir="ltr" inputMode="tel" autoComplete="off"
        placeholder={placeholder ?? "رقم الهاتف"} aria-invalid={bad ? true : undefined} className={`${cls} ${bad ? "!border-red-500" : ""}`} />
      {bad && <p className="mt-1 text-xs text-red-700">الرقم لازم يكون من 6 إلى 15 رقمًا</p>}
    </div>
  );
}
