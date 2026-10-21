"use client";

import { useMemo, useState } from "react";
import { AddToCart } from "@/components/shop/add-to-cart";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";

export type SelectableVariant = {
  id: string;
  sku: string;
  optionValues: Record<string, string>;
  priceCents: number;
  compareAtPriceCents: number | null;
  stock: number;
};

/**
 * Variant selector.
 *
 * Combinations that are out of stock are shown as unavailable *before* they
 * are chosen, rather than failing after — AGENTS.md is explicit about this,
 * and it is the difference between "sold out" and "something went wrong".
 *
 * A product with one option-less variant renders no selector at all; the
 * default variant exists so the checkout code never branches.
 */
export function VariantSelector({
  variants,
  currency = "USD",
}: {
  variants: SelectableVariant[];
  currency?: string;
}) {
  const optionNames = useMemo(() => {
    const names = new Set<string>();
    for (const variant of variants) {
      for (const key of Object.keys(variant.optionValues ?? {})) names.add(key);
    }
    return [...names];
  }, [variants]);

  const firstAvailable = variants.find((v) => v.stock > 0) ?? variants[0];
  const [selection, setSelection] = useState<Record<string, string>>(
    firstAvailable?.optionValues ?? {},
  );

  const selected = useMemo(() => {
    if (optionNames.length === 0) return variants[0] ?? null;
    return (
      variants.find((variant) =>
        optionNames.every(
          (name) => variant.optionValues?.[name] === selection[name],
        ),
      ) ?? null
    );
  }, [variants, optionNames, selection]);

  /** Would picking this value leave any in-stock variant reachable? */
  function valueHasStock(name: string, value: string) {
    return variants.some(
      (variant) => variant.optionValues?.[name] === value && variant.stock > 0,
    );
  }

  const price = selected?.priceCents ?? variants[0]?.priceCents ?? 0;
  const compareAt = selected?.compareAtPriceCents ?? null;
  const onSale = compareAt !== null && compareAt > price;
  const soldOut = !selected || selected.stock === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="tabular font-semibold text-3xl tracking-tight">
          {formatMoney(price, currency)}
        </span>
        {onSale && compareAt !== null ? (
          <>
            <span className="tabular text-lg text-tertiary-text line-through">
              {formatMoney(compareAt, currency)}
            </span>
            <Badge variant="default">
              {Math.round((1 - price / compareAt) * 100)}% off
            </Badge>
          </>
        ) : null}
      </div>

      {optionNames.map((name) => {
        const values = [
          ...new Set(
            variants
              .map((v) => v.optionValues?.[name])
              .filter((v): v is string => Boolean(v)),
          ),
        ];

        return (
          <fieldset key={name} className="flex flex-col gap-2">
            <legend className="font-medium text-sm capitalize">{name}</legend>
            <div className="flex flex-wrap gap-2">
              {values.map((value) => {
                const available = valueHasStock(name, value);
                const active = selection[name] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    disabled={!available}
                    onClick={() => {
                      setSelection((s) => ({ ...s, [name]: value }));
                      navigator.vibrate?.(10);
                    }}
                    className={cn(
                      "min-h-11 rounded-control border px-4 text-sm transition-all",
                      "touch-manipulation active:scale-[0.96]",
                      active
                        ? "border-transparent bg-accent text-on-accent shadow-e1"
                        : "border-border-strong hover:bg-surface-2",
                      // Struck through rather than merely dimmed, so it reads
                      // as unavailable and not as a rendering glitch.
                      !available &&
                        "cursor-not-allowed line-through opacity-40 hover:bg-transparent",
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-col gap-2">
        {selected && selected.stock > 0 && selected.stock <= 5 ? (
          <p className="text-critical text-sm">
            Only {selected.stock} left in stock.
          </p>
        ) : null}

        <AddToCart variantId={selected?.id ?? null} soldOut={soldOut} />

        {selected ? (
          <p className="font-mono text-tertiary-text text-xs">{selected.sku}</p>
        ) : (
          <p className="text-secondary-text text-sm">
            That combination is not available. Try another.
          </p>
        )}
      </div>
    </div>
  );
}
