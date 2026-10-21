"use client";

import { SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProductSort } from "@/lib/catalog/filters";
import { toggleParam, withParam } from "@/lib/catalog/search-params";
import { cn } from "@/lib/utils";

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "relevance", label: "Most relevant" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "price-desc", label: "Price, high to low" },
];

/**
 * Filters, driven entirely by the URL.
 *
 * Every control is a link, so the result is shareable, survives reload, and
 * works with the back button. router.replace with scroll:false keeps the
 * position steady — a filter change that jumps you to the top of the page
 * loses your place in a long grid.
 */
export function FilterBar({
  brands,
  total,
  hasQuery,
}: {
  brands: { name: string; slug: string; count: number }[];
  total: number;
  hasQuery: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const activeBrands = (params.get("brand") ?? "").split(",").filter(Boolean);
  const sort = (params.get("sort") ??
    (hasQuery ? "relevance" : "newest")) as ProductSort;
  const min = params.get("min") ?? "";
  const max = params.get("max") ?? "";
  const activeCount = activeBrands.length + (min ? 1 : 0) + (max ? 1 : 0);

  function go(query: string) {
    startTransition(() => {
      router.replace(`${pathname}${query}`, { scroll: false });
    });
  }

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

      {activeBrands.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {activeBrands.map((slug) => {
            const brand = brands.find((b) => b.slug === slug);
            return (
              <li key={slug}>
                <Link
                  href={`${pathname}${toggleParam(params, "brand", slug)}`}
                  scroll={false}
                  replace
                  className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2.5 py-1 text-accent-text text-xs"
                >
                  {brand?.name ?? slug}
                  <X className="size-3" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-5">
          {brands.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium text-sm">Brand</legend>
              <ul className="flex flex-wrap gap-1.5">
                {brands.map((brand) => {
                  const active = activeBrands.includes(brand.slug);
                  return (
                    <li key={brand.slug}>
                      <Link
                        href={`${pathname}${toggleParam(params, "brand", brand.slug)}`}
                        scroll={false}
                        replace
                        aria-pressed={active}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                          active
                            ? "border-transparent bg-accent text-on-accent"
                            : "border-border-strong hover:bg-surface-2",
                        )}
                      >
                        {brand.name}
                        <span className="tabular opacity-60">
                          {brand.count}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ) : null}

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const next = new URLSearchParams(params);
              const lo = String(data.get("min") ?? "").trim();
              const hi = String(data.get("max") ?? "").trim();
              lo ? next.set("min", lo) : next.delete("min");
              hi ? next.set("max", hi) : next.delete("max");
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
            {activeCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  go(hasQuery ? `?q=${params.get("q") ?? ""}` : "")
                }
              >
                Clear all
              </Button>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
