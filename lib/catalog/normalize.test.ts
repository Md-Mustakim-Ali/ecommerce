import { describe, expect, it } from "vitest";
import { prepareCatalogTerm, slugify } from "./normalize";

describe("slugify", () => {
  it("collapses the casing and whitespace variants that cause duplicates", () => {
    // The whole point: these four must be one brand, not four.
    const variants = ["Samsung", "SAMSUNG ", " samsung", "Samsung."];
    const slugs = new Set(variants.map(slugify));
    expect(slugs).toEqual(new Set(["samsung"]));
  });

  it("folds Latin diacritics so accented spellings collide", () => {
    expect(slugify("Nestlé")).toBe("nestle");
    expect(slugify("Löwenbräu")).toBe("lowenbrau");
    expect(slugify("Nestlé")).toBe(slugify("Nestle"));
  });

  it("treats & and + as words so the spelled-out form collides", () => {
    expect(slugify("H&M")).toBe("h-and-m");
    expect(slugify("H and M")).toBe("h-and-m");
    expect(slugify("Dolce & Gabbana")).toBe(slugify("Dolce and Gabbana"));
  });

  it("preserves Bengali, including vowel signs", () => {
    // The reason diacritic stripping is limited to U+0300-U+036F. Removing
    // Bengali marks would change the word, and every Bengali brand would
    // collapse into a handful of consonant-only slugs.
    const bengali = "আড়ং";
    expect(slugify(bengali)).toBe(bengali.toLowerCase());
    expect(slugify("বাংলা ফ্যাশন")).toBe("বাংলা-ফ্যাশন");
    // Two genuinely different words must not collide.
    expect(slugify("কাল")).not.toBe(slugify("কালো"));
  });

  it("keeps Arabic and CJK intact", () => {
    expect(slugify("東京ストア")).toBe("東京ストア");
    expect(slugify("متجر الرياض")).toBe("متجر-الرياض");
  });

  it("collapses punctuation runs into a single hyphen and trims the ends", () => {
    expect(slugify("  --Acme...Corp!!  ")).toBe("acme-corp");
    expect(slugify("A / B / C")).toBe("a-b-c");
  });

  it("keeps digits", () => {
    expect(slugify("3M")).toBe("3m");
    expect(slugify("Levi's 501")).toBe("levi-s-501");
  });

  it("returns an empty slug for input with nothing alphanumeric", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("🔥🔥")).toBe("");
  });
});

describe("prepareCatalogTerm", () => {
  it("returns the trimmed display name alongside the slug", () => {
    const result = prepareCatalogTerm("  Samsung   Electronics ");
    expect(result).toEqual({
      ok: true,
      name: "Samsung Electronics",
      slug: "samsung-electronics",
    });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(prepareCatalogTerm("")).toEqual({ ok: false, reason: "empty" });
    expect(prepareCatalogTerm("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a name with no alphanumeric content", () => {
    // Without this, every emoji-only name slugs to "" and the second one
    // collides with the first on the unique index for no obvious reason.
    expect(prepareCatalogTerm("🔥🔥🔥")).toEqual({
      ok: false,
      reason: "no-alphanumeric",
    });
  });

  it("rejects an over-long name", () => {
    expect(prepareCatalogTerm("x".repeat(81))).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("preserves the user's casing in the display name", () => {
    const result = prepareCatalogTerm("iPhone");
    expect(result.ok && result.name).toBe("iPhone");
    expect(result.ok && result.slug).toBe("iphone");
  });
});
