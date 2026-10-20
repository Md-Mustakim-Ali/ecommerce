import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/dashboard/products")).toBe("/dashboard/products");
  });

  it("falls back on an absolute URL", () => {
    expect(safeNextPath("https://evil.example")).toBe("/account");
  });

  it("falls back on a scheme-relative URL", () => {
    expect(safeNextPath("//evil.example")).toBe("/account");
  });

  it("falls back on a backslash-prefixed path", () => {
    expect(safeNextPath("/\\evil.example")).toBe("/account");
  });

  it("falls back on embedded control characters", () => {
    expect(safeNextPath("/ok\nSet-Cookie: x=1")).toBe("/account");
  });

  it("falls back on missing, empty, and non-string input", () => {
    expect(safeNextPath(undefined)).toBe("/account");
    expect(safeNextPath("")).toBe("/account");
    expect(safeNextPath(["/a", "/b"])).toBe("/account");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("javascript:alert(1)", "/")).toBe("/");
  });
});
