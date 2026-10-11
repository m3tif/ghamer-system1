import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeStoreUrl } from "@/lib/normalize";

describe("normalizePhone", () => {
  it("treats local and international Saudi formats as the same number", () => {
    const a = normalizePhone("0501234567");
    expect(a).toBe("+966501234567");
    expect(normalizePhone("+966501234567")).toBe(a);
    expect(normalizePhone("00966 50 123 4567")).toBe(a);
    expect(normalizePhone("966501234567".replace(/^/, "+"))).toBe(a);
    expect(normalizePhone("٠٥٠١٢٣٤٥٦٧")).toBe(a);
  });
  it("rejects invalid numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("normalizeStoreUrl", () => {
  const key = (u: string) => normalizeStoreUrl(u)?.key;
  it("ignores www, scheme, tracking params, case and trailing slash", () => {
    expect(key("https://www.Example.com/?utm_source=ig&fbclid=1")).toBe("example.com");
    expect(key("http://example.com")).toBe("example.com");
    expect(key("example.com/")).toBe("example.com");
    expect(key("shop.example.com/products/1")).toBe("example.com");
  });
  it("keeps stores on shared platforms distinct", () => {
    expect(key("https://foo.myshopify.com")).toBe("foo.myshopify.com");
    expect(key("https://bar.myshopify.com")).toBe("bar.myshopify.com");
    expect(key("https://instagram.com/Brand/?hl=ar")).toBe("instagram.com/brand");
    expect(key("https://www.instagram.com/@brand")).toBe("instagram.com/brand");
    expect(key("https://instagram.com/other")).not.toBe(key("https://instagram.com/brand"));
    expect(key("https://salla.sa/mystore")).toBe("salla.sa/mystore");
  });
  it("handles Saudi second-level domains", () => {
    expect(key("https://www.store.com.sa/x")).toBe("store.com.sa");
  });
  it("returns null for garbage", () => {
    expect(normalizeStoreUrl("   ")).toBeNull();
  });
});
