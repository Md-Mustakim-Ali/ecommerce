import { describe, expect, it } from "vitest";
import { parseProductFilters, toggleParam, withParam } from "./search-params";

describe("parseProductFilters", () => {
  it("parses a full query string", () => {
    const filters = parseProductFilters({
      q: "wool",
      brand: "aureus,fenwick",
      tag: "recycled",
      min: "10",
      max: "50",
      sort: "price-asc",
      page: "2",
    });

    expect(filters.q).toBe("wool");
    expect(filters.brandSlugs).toEqual(["aureus", "fenwick"]);
    expect(filters.tagSlugs).toEqual(["recycled"]);
    // Major units in the URL, minor units internally.
    expect(filters.minCents).toBe(1000);
    expect(filters.maxCents).toBe(5000);
    expect(filters.sort).toBe("price-asc");
    expect(filters.page).toBe(2);
  });

  it("swaps a reversed price range rather than returning nothing", () => {
    const filters = parseProductFilters({ min: "80", max: "20" });
    expect(filters.minCents).toBe(2000);
    expect(filters.maxCents).toBe(8000);
  });

  it("falls back instead of throwing on junk input", () => {
    // searchParams is attacker-controlled. A hand-edited URL must not 500.
    const filters = parseProductFilters({
      min: "not-a-number",
      page: "-4",
      sort: "cheapest",
    });
    expect(filters.minCents).toBeUndefined();
    expect(filters.page).toBe(1);
    expect(filters.sort).toBe("newest");
  });

  it("defaults to relevance when there is a query and newest otherwise", () => {
    expect(parseProductFilters({ q: "wool" }).sort).toBe("relevance");
    expect(parseProductFilters({}).sort).toBe("newest");
  });

  it("accepts repeated params as well as comma-separated ones", () => {
    expect(parseProductFilters({ brand: ["a", "b"] }).brandSlugs).toEqual([
      "a",
      "b",
    ]);
    expect(parseProductFilters({ brand: "a,b" }).brandSlugs).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops empty values", () => {
    expect(parseProductFilters({ brand: ",,, " }).brandSlugs).toBeUndefined();
  });
});

describe("withParam", () => {
  it("sets a value and resets pagination", () => {
    const current = new URLSearchParams("q=wool&page=5");
    expect(withParam(current, "sort", "price-asc")).toBe(
      "?q=wool&sort=price-asc",
    );
  });

  it("removes a value when passed null", () => {
    const current = new URLSearchParams("q=wool&sort=newest");
    expect(withParam(current, "sort", null)).toBe("?q=wool");
  });

  it("keeps the page when the page itself is being changed", () => {
    const current = new URLSearchParams("q=wool");
    expect(withParam(current, "page", "3")).toBe("?q=wool&page=3");
  });
});

describe("toggleParam", () => {
  it("adds a value that is not present", () => {
    expect(
      toggleParam(new URLSearchParams("brand=aureus"), "brand", "fenwick"),
    ).toBe("?brand=aureus%2Cfenwick");
  });

  it("removes a value that is present", () => {
    expect(
      toggleParam(
        new URLSearchParams("brand=aureus,fenwick"),
        "brand",
        "aureus",
      ),
    ).toBe("?brand=fenwick");
  });

  it("drops the param entirely when the last value is removed", () => {
    expect(
      toggleParam(new URLSearchParams("brand=aureus&q=x"), "brand", "aureus"),
    ).toBe("?q=x");
  });

  it("resets pagination", () => {
    const result = toggleParam(
      new URLSearchParams("page=4"),
      "brand",
      "aureus",
    );
    expect(result).not.toContain("page");
  });
});

describe("parseProductFilters — extended facets", () => {
  it("collects attribute facets by prefix", () => {
    const filters = parseProductFilters({
      a_colour: "navy,charcoal",
      a_size: "m",
    });
    expect(filters.attributes).toEqual({
      colour: ["navy", "charcoal"],
      size: ["m"],
    });
  });

  it("ignores attribute keys that are not slug-shaped", () => {
    // The query string is attacker-controlled; a key like a_'; drop table
    // must never reach the query builder.
    const filters = parseProductFilters({ "a_colour; drop table": "navy" });
    expect(filters.attributes).toBeUndefined();
  });

  it("caps the values per attribute", () => {
    const many = Array.from({ length: 40 }, (_, i) => `v${i}`).join(",");
    const filters = parseProductFilters({ a_colour: many });
    expect(filters.attributes?.colour).toHaveLength(20);
  });

  it("parses the boolean and rating facets", () => {
    const filters = parseProductFilters({
      stock: "in",
      sale: "1",
      rating: "4",
      store: "oakline",
    });
    expect(filters.inStockOnly).toBe(true);
    expect(filters.onSaleOnly).toBe(true);
    expect(filters.minRating).toBe(4);
    expect(filters.storeSlugs).toEqual(["oakline"]);
  });

  it("drops an out-of-range rating rather than throwing", () => {
    expect(parseProductFilters({ rating: "9" }).minRating).toBeUndefined();
    expect(parseProductFilters({ stock: "maybe" }).inStockOnly).toBe(false);
  });
});
