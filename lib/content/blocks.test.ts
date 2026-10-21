import { describe, expect, it } from "vitest";
import { parseBlock, validateBlockInput } from "./blocks";

describe("block validation", () => {
  it("accepts a valid banner", () => {
    const result = validateBlockInput("banner", {
      title: "Free shipping this week",
      tone: "accent",
      ctaHref: "/c/electronics",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown block type", () => {
    expect(validateBlockInput("scriptTag", {})).toEqual({
      ok: false,
      message: "Unknown block: scriptTag",
    });
  });

  describe("link safety", () => {
    // Blocks are authored by sellers and rendered to every buyer. A
    // javascript: URL in a CTA is stored XSS.
    const dangerous = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "  javascript:alert(1)",
    ];

    for (const ctaHref of dangerous) {
      it(`rejects ${ctaHref.trim().slice(0, 24)}`, () => {
        const result = validateBlockInput("banner", {
          title: "Offer",
          ctaHref,
        });
        expect(result.ok).toBe(false);
      });
    }

    it("allows relative, https and mailto", () => {
      for (const ctaHref of [
        "/c/electronics",
        "https://example.com/promo",
        "mailto:hello@example.com",
      ]) {
        expect(
          validateBlockInput("banner", { title: "Offer", ctaHref }).ok,
          ctaHref,
        ).toBe(true);
      }
    });

    it("rejects plain http, so a promo cannot downgrade the connection", () => {
      expect(
        validateBlockInput("banner", {
          title: "Offer",
          ctaHref: "http://example.com",
        }).ok,
      ).toBe(false);
    });
  });

  it("enforces length limits", () => {
    expect(validateBlockInput("heading", { text: "x".repeat(201) }).ok).toBe(
      false,
    );
    expect(validateBlockInput("richText", { body: "" }).ok).toBe(false);
  });

  it("applies defaults", () => {
    const result = validateBlockInput("heading", { text: "Hello" });
    expect(result.ok && result.data.level).toBe(2);
  });

  it("caps FAQ entries", () => {
    const items = Array.from({ length: 21 }, () => ({
      question: "q",
      answer: "a",
    }));
    expect(validateBlockInput("faq", { items }).ok).toBe(false);
  });
});

describe("parseBlock", () => {
  it("returns the block when the payload is valid", () => {
    const block = parseBlock({
      id: "1",
      type: "heading",
      data: { text: "Hello", level: 3 },
    });
    expect(block?.type).toBe("heading");
  });

  it("returns null for a stale payload rather than throwing", () => {
    // A page with one block edited months ago must still render the rest,
    // not 500 the whole storefront page.
    expect(
      parseBlock({ id: "1", type: "heading", data: { text: "" } }),
    ).toBeNull();
    expect(parseBlock({ id: "2", type: "gone", data: {} })).toBeNull();
    expect(parseBlock({ id: "3", type: "image", data: null })).toBeNull();
  });
});
