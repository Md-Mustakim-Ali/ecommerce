import { z } from "zod";

/** Shared between the client form and the server action. Parse, don't cast. */
export const createProductSchema = z.object({
  storeId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(2, "Enter a title")
    .max(140, "Title is too long"),
  description: z.string().trim().max(4000).optional(),
  categoryId: z.uuid("Pick a category"),
  brandId: z.uuid().nullable().optional(),
  tagIds: z.array(z.uuid()).max(12, "At most 12 tags").default([]),

  sku: z.string().trim().min(1, "Enter a SKU").max(64),
  // Entered as a decimal string and converted to integer minor units on the
  // server. Never parsed as a float and multiplied — 19.99 * 100 is 1998.9999
  // in binary floating point.
  price: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, "Use a price like 19.99"),
  stock: z.coerce
    .number()
    .int()
    .min(0, "Stock cannot be negative")
    .max(1_000_000),

  publish: z.boolean().default(false),
});

export type CreateProductInput = z.input<typeof createProductSchema>;

/**
 * "19.99" -> 1999.
 *
 * String arithmetic on purpose. Number("19.99") * 100 is 1998.9999999999998,
 * and Math.round hides that until a price ends up a cent short in a payout
 * six months later.
 */
export function priceToCents(price: string): number {
  const [whole, fraction = ""] = price.trim().split(".");
  const paddedFraction = fraction.padEnd(2, "0").slice(0, 2);
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(paddedFraction, 10);
}
