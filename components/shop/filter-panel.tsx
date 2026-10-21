"use client";

import { Check, SlidersHorizontal, Star, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ATTRIBUTE_PARAM_PREFIX,
  type ProductSort,
} from "@/lib/catalog/filters";
import type { AttributeFacet } from "@/lib/catalog/queries";
import { toggleParam, withParam } from "@/lib/catalog/search-params";
import { cn } from "@/lib/utils";

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "relevance", label: "Most relevant" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "price-desc", label: "Price, high to low" },
];

export type Facets = {
  brands: { name: string; slug: string; count: number }[];
  stores: { name: string; slug: string; count: number }[];
  attributes: AttributeFacet[];
  tags: { name: string; slug: string; count: number }[];
};

/**
 * The full filter panel.
 *
 * Every control is a link and every bit of state lives in the URL, so a
 * filtered view is shareable, survives a reload and works with the back
 * button. router.replace with scroll:false keeps your place — a filter change
 * that jumps you to the top of a long grid loses it.
 *
 * Attribute facets are driven entirely by the database. Adding a new
 * attribute makes it appear here with no code change, which is what
 * deduplicating attributes globally was for.
 */
export function FilterPanel({
  facets,
  total,
  hasQuery,
}: {
  facets: Facets;
  total: number;
  hasQuery: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const listOf = (key: string) =>
    (params.get(key) ?? "").split(",").filter(Boolean);

  const activeBrands = listOf("brand");
  const activeStores = listOf("store");
  const activeTags = listOf("tag");
  const minRating = params.get("rating");
  const inStock = params.get("stock") === "in";
  const onSale = params.get("sale") === "1";
  const min = params.get("min") ?? "";
  const max = params.get("max") ?? "";
  const sort = (params.get("sort") ??
    (hasQuery ? "relevance" : "newest")) as ProductSort;

  const activeAttributes = facets.attributes.flatMap((facet) =>
    listOf(`${ATTRIBUTE_PARAM_PREFIX}${facet.slug}`).map((value) => ({
      facet,
      value,
    })),
  );

  const activeCount =
    activeBrands.length +
    activeStores.length +
    activeTags.length +
    activeAttributes.length +
    (minRating ? 1 : 0) +
    (inStock ? 1 : 0) +
    (onSale ? 1 : 0) +
    (min ? 1 : 0) +
    (max ? 1 : 0);

  function go(query: string) {
    startTransition(() =>
      router.replace(`${pathname}${query}`, { scroll: false }),
    );
  }

  const clearAll = () => go(hasQuery ? `?q=${params.get("q") ?? ""}` : "");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <SlidersHorizontal />
          Filters
          {activeCount > 0 ? (
            <Badge variant="default" className="ml-1">
              {activeCount}
            </Badge>
          ) : null}
        </Button>

        {/* Quick toggles, out of the panel because they are the common two. */}
        <Button
          variant={inStock ? "default" : "outline"}
          size="sm"
          onClick={() => go(withParam(params, "stock", inStock ? null : "in"))}
          aria-pressed={inStock}
        >
          {inStock ? <Check /> : null}
          In stock
        </Button>
        <Button
          variant={onSale ? "default" : "outline"}
          size="sm"
          onClick={() => go(withParam(params, "sale", onSale ? null : "1"))}
          aria-pressed={onSale}
        >
          {onSale ? <Check /> : null}
          On sale
        </Button>

        <label className="sr-only" htmlFor="sort">
          Sort
        </label>
        <select
          id="sort"
          value={sort}
          onChange={(e) => go(withParam(params, "sort", e.target.value))}
          className="h-9 rounded-control border border-border-strong bg-surface-sunken px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <span
          className={cn(
            "tabular ml-auto text-secondary-text text-sm transition-opacity",
            pending && "opacity-50",
          )}
        >
          {total} {total === 1 ? "product" : "products"}
        </span>
      </div>

      {activeCount > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5">
          {activeAttributes.map(({ facet, value }) => (
            <Chip
              key={`${facet.slug}-${value}`}
              href={`${pathname}${toggleParam(params, `${ATTRIBUTE_PARAM_PREFIX}${facet.slug}`, value)}`}
              label={`${facet.name}: ${facet.values.find((v) => v.slug === value)?.value ?? value}`}
            />
          ))}
          {activeBrands.map((slug) => (
            <Chip
              key={slug}
              href={`${pathname}${toggleParam(params, "brand", slug)}`}
              label={facets.brands.find((b) => b.slug === slug)?.name ?? slug}
            />
          ))}
          {activeStores.map((slug) => (
            <Chip
              key={slug}
              href={`${pathname}${toggleParam(params, "store", slug)}`}
              label={facets.stores.find((s) => s.slug === slug)?.name ?? slug}
            />
          ))}
          {activeTags.map((slug) => (
            <Chip
              key={slug}
              href={`${pathname}${toggleParam(params, "tag", slug)}`}
              label={facets.tags.find((t) => t.slug === slug)?.name ?? slug}
            />
          ))}
          {minRating ? (
            <Chip
              href={`${pathname}${withParam(params, "rating", null)}`}
              label={`${minRating}★ and up`}
            />
          ) : null}
          <li>
            <button
              type="button"
              onClick={clearAll}
              className="px-2 text-secondary-text text-xs underline underline-offset-4"
            >
              Clear all
            </button>
          </li>
        </ul>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface-1 p-5">
          {facets.attributes.map((facet) => {
            const key = `${ATTRIBUTE_PARAM_PREFIX}${facet.slug}`;
            const active = listOf(key);
            return (
              <fieldset key={facet.slug} className="flex flex-col gap-2">
                <legend className="font-medium text-sm">{facet.name}</legend>
                <ul className="flex flex-wrap gap-1.5">
                  {facet.values.map((value) => {
                    const isActive = active.includes(value.slug);
                    const hex =
                      facet.kind === "color"
                        ? (value.meta as { hex?: string }).hex
                        : undefined;
                    return (
                      <li key={value.slug}>
                        <Link
                          href={`${pathname}${toggleParam(params, key, value.slug)}`}
                          scroll={false}
                          replace
                          aria-pressed={isActive}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                            isActive
                              ? "border-transparent bg-accent text-on-accent"
                              : "border-border-strong hover:bg-surface-2",
                          )}
                        >
                          {hex ? (
                            <span
                              className="size-3 rounded-full border border-border-strong"
                              style={{ backgroundColor: hex }}
                              aria-hidden
                            />
                          ) : null}
                          {value.value}
                          <span className="tabular opacity-60">
                            {value.count}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}

          <FacetGroup
            legend="Brand"
            items={facets.brands}
            active={activeBrands}
            hrefFor={(slug) =>
              `${pathname}${toggleParam(params, "brand", slug)}`
            }
          />
          <FacetGroup
            legend="Store"
            items={facets.stores}
            active={activeStores}
            hrefFor={(slug) =>
              `${pathname}${toggleParam(params, "store", slug)}`
            }
          />
          <FacetGroup
            legend="Tag"
            items={facets.tags}
            active={activeTags}
            hrefFor={(slug) => `${pathname}${toggleParam(params, "tag", slug)}`}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium text-sm">Rating</legend>
            <div className="flex flex-wrap gap-1.5">
              {[4, 3, 2].map((value) => {
                const isActive = minRating === String(value);
                return (
                  <Link
                    key={value}
                    href={`${pathname}${withParam(params, "rating", isActive ? null : String(value))}`}
                    scroll={false}
                    replace
                    aria-pressed={isActive}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors",
                      isActive
                        ? "border-transparent bg-accent text-on-accent"
                        : "border-border-strong hover:bg-surface-2",
                    )}
                  >
                    <Star className="size-3 fill-current" aria-hidden />
                    {value} and up
                  </Link>
                );
              })}
            </div>
          </fieldset>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const next = new URLSearchParams(params);
              const lo = String(data.get("min") ?? "").trim();
              const hi = String(data.get("max") ?? "").trim();
              if (lo) next.set("min", lo);
              else next.delete("min");
              if (hi) next.set("max", hi);
              else next.delete("max");
              next.delete("page");
              go(next.toString() ? `?${next.toString()}` : "");
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="min" className="font-medium text-sm">
                Min price
              </label>
              <input
                id="min"
                name="min"
                inputMode="decimal"
                defaultValue={min}
                placeholder="0"
                className="tabular h-9 w-24 rounded-control border border-border-strong bg-surface-sunken px-3 text-sm outline-none focus-visible:border-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="max" className="font-medium text-sm">
                Max price
              </label>
              <input
                id="max"
                name="max"
                inputMode="decimal"
                defaultValue={max}
                placeholder="500"
                className="tabular h-9 w-24 rounded-control border border-border-strong bg-surface-sunken px-3 text-sm outline-none focus-visible:border-ring"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        replace
        className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2.5 py-1 text-accent-text text-xs"
      >
        {label}
        <X className="size-3" aria-hidden />
      </Link>
    </li>
  );
}

function FacetGroup({
  legend,
  items,
  active,
  hrefFor,
}: {
  legend: string;
  items: { name: string; slug: string; count: number }[];
  active: string[];
  hrefFor: (slug: string) => string;
}) {
  if (items.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium text-sm">{legend}</legend>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const isActive = active.includes(item.slug);
          return (
            <li key={item.slug}>
              <Link
                href={hrefFor(item.slug)}
                scroll={false}
                replace
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                  isActive
                    ? "border-transparent bg-accent text-on-accent"
                    : "border-border-strong hover:bg-surface-2",
                )}
              >
                {item.name}
                <span className="tabular opacity-60">{item.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
