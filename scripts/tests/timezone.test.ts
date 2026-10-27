import { describe, it, expect } from "vitest";
import { parseLocal, toLocalInput, tzLabel, fmtDateTime, setTimezone, getTimezone } from "../src/lib/format";

describe("time zone conversion (what the user types is what is stored and shown)", () => {
  it("Riyadh is always UTC+3 (no DST)", () => {
    expect(parseLocal("2026-10-10T14:30", "Asia/Riyadh")).toBe("2026-10-10T11:30:00.000Z");
    expect(parseLocal("2026-01-10T14:30", "Asia/Riyadh")).toBe("2026-01-10T11:30:00.000Z");
  });
  it("Cairo follows its DST: +3 in summer, +2 in winter (this is what a fixed +03:00 got wrong)", () => {
    expect(parseLocal("2026-07-10T14:30", "Africa/Cairo")).toBe("2026-07-10T11:30:00.000Z");
    expect(parseLocal("2026-12-10T14:30", "Africa/Cairo")).toBe("2026-12-10T12:30:00.000Z");
  });
  it("round trip: typed → stored → shown in the input equals what was typed", () => {
    for (const tz of ["Asia/Riyadh", "Africa/Cairo", "UTC", "America/New_York"])
      for (const v of ["2026-03-29T00:30", "2026-10-25T09:00", "2026-12-31T23:59", "2027-02-01T12:00"]) {
        const iso = parseLocal(v, tz);
        if (iso) expect(toLocalInput(iso, tz)).toBe(v);
      }
  });
  it("rejects invalid or non-existent times", () => {
    expect(parseLocal("", "Asia/Riyadh")).toBeNull();
    expect(parseLocal("garbage", "Asia/Riyadh")).toBeNull();
    expect(parseLocal("2026-03-08T02:30", "America/New_York")).toBeNull(); // skipped by DST
  });
  it("display uses the configured zone and is labelled", () => {
    const iso = "2026-10-10T11:30:00.000Z";
    setTimezone("Asia/Riyadh");
    expect(getTimezone()).toBe("Asia/Riyadh");
    expect(fmtDateTime(iso)).toMatch(/2:30|14:30/);
    expect(tzLabel("Asia/Riyadh")).toBe("توقيت الرياض (GMT+3)");
    expect(tzLabel("Africa/Cairo")).toMatch(/القاهرة \(GMT\+[23]\)/);
  });
});
