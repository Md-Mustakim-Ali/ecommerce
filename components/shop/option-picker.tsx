"use client";

import { useMemo, useState } from "react";
import { AddToCart } from "@/components/shop/add-to-cart";
import { Badge } from "@/components/ui/badge";
import { type StockDisplay, stockMessage } from "@/lib/catalog/stock";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";

export type ProductAttribute = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  unit: string | null;
  role: "variant" | "spec";
  values: {
    id: string;
    value: string;
    slug: string;
    meta: Record<string, unknown>;
  }[];
};

export type PickerVariant = {
  id: string;
  sku: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stock: number;
  /** attributeId -> valueId */
  combination: Record<string, string>;
};

/**
 * Option picker.
 *
 * The set of variants IS the set of valid combinations. There is no separate
 * table of allowed pairings — if Large does not come in Navy, that variant was
 * never created, and this component reads that absence directly.
 *
 * A value is shown as unavailable when no variant exists that has it *and*
 * agrees with everything else currently chosen. That is what makes the
 * unavailability contextual: Navy may be fine on its own but impossible once
 * Large is selected, and the picker says so before the shopper commits rather
 * than failing afterwards.
 *
 * `onSelectionChange` lets the gallery follow along, so choosing a colour
 * shows the photo of that colour.
 */
export function OptionPicker({
  attributes,
  variants,
  currency = PLATFORM_CURRENCY,
  stockDisplay = "when_low",
  lowStockThreshold = 5,
  onSelectionChange,
}: {
  attributes: ProductAttribute[];
  variants: PickerVariant[];
  currency?: string;
  stockDisplay?: StockDisplay;
  lowStockThreshold?: number;
  onSelectionChange?: (selection: Record<string, string>) => void;
}) {
  const variantAttributes = useMemo(
    () => attributes.filter((a) => a.role === "variant"),
    [attributes],
  );
  const specAttributes = useMemo(
    () => attributes.filter((a) => a.role === "spec"),
    [attributes],
  );

  // Deliberately starts empty when the product has options. Pre-selecting a
  // combination shows one SKU and one price as though that were *the* price,
  // when the honest answer is a range until the shopper has actually chosen.
  const [selection, setSelection] = useState<Record<string, string>>({});

  const selected = useMemo(() => {
    if (variantAttributes.length === 0) return variants[0] ?? null;
    return (
      variants.find((variant) =>
        variantAttributes.every(
          (attribute) =>
            variant.combination[attribute.id] === selection[attribute.id],
        ),
      ) ?? null
    );
  }, [variants, variantAttributes, selection]);

  /**
   * Could this value still lead to a real variant, given everything else
   * already chosen? Checked against every other attribute, not just globally,
   * so availability narrows as choices are made.
   */
  function isReachable(attributeId: string, valueId: string) {
    return variants.some((variant) => {
      if (variant.combination[attributeId] !== valueId) return false;
      return variantAttributes.every((other) => {
        if (other.id === attributeId) return true;
        const chosen = selection[other.id];
        return !chosen || variant.combination[other.id] === chosen;
      });
    });
  }

  function choose(attributeId: string, valueId: string) {
    const next = { ...selection, [attributeId]: valueId };

    // Picking a value can strand the others. Repair by snapping to the closest
    // real variant rather than leaving the shopper on a combination that does
    // not exist.
    const exact = variants.find((variant) =>
      variantAttributes.every((a) => variant.combination[a.id] === next[a.id]),
    );

    const resolved = exact
      ? next
      : ((
          variants.find(
            (variant) =>
              variant.combination[attributeId] === valueId && variant.stock > 0,
          ) ??
          variants.find(
            (variant) => variant.combination[attributeId] === valueId,
          )
        )?.combination ?? next);

    setSelection(resolved);
    onSelectionChange?.(resolved);
    navigator.vibrate?.(10);
  }

  const isComplete =
    variantAttributes.length === 0 ||
    variantAttributes.every((a) => Boolean(selection[a.id]));

  // The range across every combination that exists, shown until the shopper
  // has picked enough to identify one.
  const priceRange = useMemo(() => {
    const prices = variants.map((v) => v.priceCents);
    return prices.length === 0
      ? { min: 0, max: 0 }
      : { min: Math.min(...prices), max: Math.max(...prices) };
  }, [variants]);

  const price = selected?.priceCents ?? priceRange.min;
  const compareAt = selected?.compareAtPriceCents ?? null;
  const onSale = compareAt !== null && compareAt > price;
  const soldOut = !selected || selected.stock === 0;
  const showRange =
    (!isComplete || !selected) && priceRange.min !== priceRange.max;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        {showRange ? (
          <span className="tabular font-semibold text-3xl tracking-tight">
            {formatMoney(priceRange.min, currency)}
            <span className="mx-1 text-tertiary-text">–</span>
            {formatMoney(priceRange.max, currency)}
          </span>
        ) : (
          <span className="tabular font-semibold text-3xl tracking-tight">
            {formatMoney(price, currency)}
          </span>
        )}
        {!showRange && onSale && compareAt !== null ? (
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

      {variantAttributes.map((attribute) => {
        const chosenValueId = selection[attribute.id];
        const chosen = attribute.values.find((v) => v.id === chosenValueId);

        return (
          <fieldset key={attribute.id} className="flex flex-col gap-2">
            <legend className="font-medium text-sm">
              {attribute.name}
              {chosen ? (
                <span className="ml-2 text-secondary-text">{chosen.value}</span>
              ) : null}
            </legend>

            <div className="flex flex-wrap gap-2">
              {attribute.values.map((value) => {
                const reachable = isReachable(attribute.id, value.id);
                const active = chosenValueId === value.id;
                const hex =
                  attribute.kind === "color"
                    ? (value.meta as { hex?: string }).hex
                    : undefined;

                if (hex) {
                  return (
                    <button
                      key={value.id}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${value.value}${reachable ? "" : " — unavailable with the current selection"}`}
                      title={value.value}
                      disabled={!reachable}
                      onClick={() => choose(attribute.id, value.id)}
                      className={cn(
                        "relative size-11 rounded-full border-2 transition-[border-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out)",
                        "touch-manipulation active:scale-[0.92]",
                        active
                          ? "border-ring ring-2 ring-ring/30"
                          : "border-border-strong",
                        !reachable && "cursor-not-allowed opacity-35",
                      )}
                    >
                      <span
                        className="absolute inset-1 rounded-full"
                        style={{ backgroundColor: hex }}
                      />
                      {!reachable ? (
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="h-px w-8 rotate-45 bg-critical" />
                        </span>
                      ) : null}
                    </button>
                  );
                }

                return (
                  <button
                    key={value.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!reachable}
                    onClick={() => choose(attribute.id, value.id)}
                    className={cn(
                      "min-h-11 rounded-control border px-4 text-sm transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-out)",
                      "touch-manipulation active:scale-[0.96]",
                      active
                        ? "border-transparent bg-accent text-on-accent shadow-e1"
                        : "border-border-strong hover:bg-surface-2",
                      // Struck through rather than merely dimmed, so it reads
                      // as unavailable and not as a rendering glitch.
                      !reachable &&
                        "cursor-not-allowed line-through opacity-40 hover:bg-transparent",
                    )}
                  >
                    {value.value}
                    {attribute.unit ? ` ${attribute.unit}` : ""}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-col gap-2">
        {/*
          The quantity is the selected variant's, never the product total —
          a product with 40 units across ten combinations has 4 of the one
          being looked at.
        */}
        {(() => {
          const message = stockMessage({
            quantity: selected?.stock ?? null,
            display: stockDisplay,
            lowStockThreshold,
            resolved: isComplete && Boolean(selected),
          });
          if (message.kind === "hidden") return null;
          return (
            <p
              className={
                message.kind === "low"
                  ? "text-critical text-sm"
                  : message.kind === "sold-out"
                    ? "text-secondary-text text-sm"
                    : "text-positive text-sm"
              }
            >
              {message.text}
            </p>
          );
        })()}

        <AddToCart
          variantId={isComplete ? (selected?.id ?? null) : null}
          soldOut={isComplete && soldOut}
        />

        {/*
          The SKU identifies one combination, so there is nothing honest to
          show until one is chosen. Each combination carries its own.
        */}
        {isComplete && selected ? (
          <p className="font-mono text-tertiary-text text-xs">{selected.sku}</p>
        ) : isComplete ? (
          <p className="text-secondary-text text-sm">
            That combination is not available. Try another.
          </p>
        ) : (
          <p className="text-secondary-text text-sm">
            Choose{" "}
            {variantAttributes
              .filter((a) => !selection[a.id])
              // Not lowercased: "RAM" is an acronym and reads as a typo otherwise.
              .map((a) => a.name)
              .join(" and ")}{" "}
            to see the price and add to cart.
          </p>
        )}
      </div>

      {specAttributes.length > 0 ? (
        <dl className="flex flex-col gap-1.5 border-border border-t pt-4 text-sm">
          {specAttributes.map((attribute) => (
            <div key={attribute.id} className="flex justify-between gap-4">
              <dt className="text-secondary-text">{attribute.name}</dt>
              <dd>
                {attribute.values.map((v) => v.value).join(", ")}
                {attribute.unit ? ` ${attribute.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
