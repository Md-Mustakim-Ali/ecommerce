import { describe, expect, it } from "vitest";
import { createProductSchema, priceToCents } from "./product";

describe("priceToCents", () => {
  it("converts without floating point error", () => {
    // Number("19.99") * 100 is 1998.9999999999998. This is the whole reason
    // the conversion is done on strings.
    expect(priceToCents("19.99")).toBe(1999);
    expect(priceToCents("0.07")).toBe(7);
    expect(priceToCents("1234.56")).toBe(123456);
  });

  it("pads a single decimal place", () => {
    expect(priceToCents("5.5")).toBe(550);
  });

  it("handles whole numbers", () => {
    expect(priceToCents("42")).toBe(4200);
    expect(priceToCents("0")).toBe(0);
  });

  it("agrees with the naive float maths only where float maths is exact", () => {
    for (const value of ["10.00", "0.25", "1.50"]) {
      expect(priceToCents(value)).toBe(Math.round(Number(value) * 100));
    }
    // And differs where it is not.
    expect(priceToCents("19.99")).toBe(1999);
    expect(Number("19.99") * 100).not.toBe(1999);
  });
});

describe("createProductSchema", () => {
  const valid = {
    storeId: "01920000-0000-7000-8000-000000000001",
    title: "Merino overshirt",
    categoryId: "01920000-0000-7000-8000-000000000002",
    sku: "SKU-1",
    price: "19.99",
    stock: 5,
  };

  it("accepts a minimal valid product", () => {
    expect(createProductSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a malformed price", () => {
    for (const price of ["19.999", "abc", "-5", "1e3", ""]) {
      expect(
        createProductSchema.safeParse({ ...valid, price }).success,
        `price ${price}`,
      ).toBe(false);
    }
  });

  it("rejects negative stock", () => {
    expect(createProductSchema.safeParse({ ...valid, stock: -1 }).success).toBe(
      false,
    );
  });

  it("rejects a non-uuid category", () => {
    expect(
      createProductSchema.safeParse({ ...valid, categoryId: "electronics" })
        .success,
    ).toBe(false);
  });

  it("caps the tag count", () => {
    const tagIds = Array.from(
      { length: 13 },
      (_, i) => `01920000-0000-7000-8000-00000000${String(i).padStart(4, "0")}`,
    );
    expect(createProductSchema.safeParse({ ...valid, tagIds }).success).toBe(
      false,
    );
  });

  it("defaults to unpublished", () => {
    const parsed = createProductSchema.parse(valid);
    expect(parsed.publish).toBe(false);
    expect(parsed.tagIds).toEqual([]);
  });
});
