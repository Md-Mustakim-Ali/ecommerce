import { z } from "zod";
import {
  ATTRIBUTE_PARAM_PREFIX,
  DEFAULT_PER_PAGE,
  type ProductFilters,
} from "./filters";

/**
 * URL is the source of truth for filters.
 *
 * Filter state lives in the query string rather than in component state, so a
 * filtered view is shareable, survives a reload, and works with the back
 * button. AGENTS.md: URL state, no full page reload.
 *
 * searchParams is attacker-controlled, so everything is parsed rather than
 * cast, and anything unparseable falls back instead of throwing a 500 at a
 * buyer who edited the URL.
 */
const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  brand: z.union([z.string(), z.array(z.string())]).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  store: z.union([z.string(), z.array(z.string())]).optional(),
  min: z.coerce.number().min(0).max(1_000_000).optional(),
  max: z.coerce.number().min(0).max(1_000_000).optional(),
  rating: z.coerce.number().min(1).max(5).optional(),
  stock: z.enum(["in"]).optional(),
  sale: z.enum(["1"]).optional(),
  sort: z.enum(["relevance", "newest", "price-asc", "price-desc"]).optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
});

const toArray = (
  value: string | string[] | undefined,
): string[] | undefined => {
  if (value === undefined) return undefined;
  const list = (Array.isArray(value) ? value : [value])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
};

export function parseProductFilters(
  raw: Record<string, string | string[] | undefined>,
  extra: { categorySlug?: string } = {},
): ProductFilters {
  const parsed = listSchema.safeParse(raw);
  const data = parsed.success ? parsed.data : {};

  // Major units in the URL (min=10), minor units in the query layer.
  const minCents =
    data.min !== undefined ? Math.round(data.min * 100) : undefined;
  const maxCents =
    data.max !== undefined ? Math.round(data.max * 100) : undefined;

  // A reversed range returns nothing and looks broken. Swap instead.
  const [lo, hi] =
    minCents !== undefined && maxCents !== undefined && minCents > maxCents
      ? [maxCents, minCents]
      : [minCents, maxCents];

  // Attribute facets arrive as a_colour=navy,charcoal. Collected by prefix so
  // adding an attribute needs no change here — the vocabulary lives in the
  // database, not in this parser.
  const attributeFilters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(ATTRIBUTE_PARAM_PREFIX)) continue;
    const slug = key.slice(ATTRIBUTE_PARAM_PREFIX.length);
    // A slug is [a-z0-9-]; anything else is somebody probing the query string.
    if (!/^[\p{L}\p{N}-]+$/u.test(slug)) continue;
    const values = toArray(value as string | string[] | undefined);
    if (values) attributeFilters[slug] = values.slice(0, 20);
  }

  return {
    q: data.q,
    categorySlug: extra.categorySlug,
    brandSlugs: toArray(data.brand),
    tagSlugs: toArray(data.tag),
    storeSlugs: toArray(data.store),
    attributes:
      Object.keys(attributeFilters).length > 0 ? attributeFilters : undefined,
    minRating: data.rating,
    inStockOnly: data.stock === "in",
    onSaleOnly: data.sale === "1",
    minCents: lo,
    maxCents: hi,
    sort: data.sort ?? (data.q ? "relevance" : "newest"),
    page: data.page ?? 1,
    perPage: DEFAULT_PER_PAGE,
  };
}

/** Builds a URL with one filter changed, preserving the rest. */
export function withParam(
  current: URLSearchParams,
  key: string,
  value: string | null,
): string {
  const next = new URLSearchParams(current);
  if (value === null) next.delete(key);
  else next.set(key, value);
  // Any filter change invalidates the current page number.
  if (key !== "page") next.delete("page");
  const query = next.toString();
  return query ? `?${query}` : "";
}

/** Toggles one value inside a repeated param such as brand or tag. */
export function toggleParam(
  current: URLSearchParams,
  key: string,
  value: string,
): string {
  const next = new URLSearchParams(current);
  const existing = next
    .getAll(key)
    .flatMap((v) => v.split(","))
    .filter(Boolean);
  const updated = existing.includes(value)
    ? existing.filter((v) => v !== value)
    : [...existing, value];

  next.delete(key);
  if (updated.length > 0) next.set(key, updated.join(","));
  next.delete("page");

  const query = next.toString();
  return query ? `?${query}` : "";
}
