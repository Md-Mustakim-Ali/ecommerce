/**
 * Filter shape and constants, deliberately free of any database import.
 *
 * search-params.ts previously pulled DEFAULT_PER_PAGE out of queries.ts, which
 * dragged the Drizzle client — and therefore the env parsing — into a module
 * that only parses a query string. That made a pure unit test require a
 * database connection.
 */

export const DEFAULT_PER_PAGE = 24;

export type ProductSort = "relevance" | "newest" | "price-asc" | "price-desc";

export type ProductFilters = {
  q?: string;
  /**
   * Restricts to specific products.
   *
   * Used by the saved-items page, which starts from a list of ids and needs
   * them run through the same visibility rules as everything else — so a saved
   * product whose store was suspended disappears here too.
   */
  productIds?: string[];
  categorySlug?: string;
  brandSlugs?: string[];
  tagSlugs?: string[];
  storeSlugs?: string[];
  /**
   * Attribute filters, keyed by attribute slug: { colour: ["navy"], size: ["m"] }.
   *
   * Values within one attribute are OR'd (navy or charcoal); different
   * attributes are AND'd (navy AND medium). That is what shoppers expect and
   * the opposite of what a naive implementation does.
   */
  attributes?: Record<string, string[]>;
  minCents?: number;
  maxCents?: number;
  /** Minimum average rating, 1-5. */
  minRating?: number;
  /** Hide anything with no stock left. */
  inStockOnly?: boolean;
  /** Only products with a compare-at price above the current one. */
  onSaleOnly?: boolean;
  sort?: ProductSort;
  page?: number;
  perPage?: number;
};

/** Query-string keys that are not attribute filters. */
export const RESERVED_FILTER_KEYS = new Set([
  "q",
  "brand",
  "tag",
  "store",
  "min",
  "max",
  "rating",
  "stock",
  "sale",
  "sort",
  "page",
]);

/** Attribute facets arrive as `a_colour=navy,charcoal`. */
export const ATTRIBUTE_PARAM_PREFIX = "a_";
