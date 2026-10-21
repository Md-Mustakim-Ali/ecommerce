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
  categorySlug?: string;
  brandSlugs?: string[];
  tagSlugs?: string[];
  minCents?: number;
  maxCents?: number;
  sort?: ProductSort;
  page?: number;
  perPage?: number;
};
