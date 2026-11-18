import Image from "next/image";
import Link from "next/link";
import { MorphLink } from "@/components/motion/morph-link";
import { QuickAdd } from "@/components/shop/quick-add";
import { QuickView } from "@/components/shop/quick-view";
import { RatingStars } from "@/components/shop/rating-stars";
import { SaveButton } from "@/components/shop/save-button";
import { Badge } from "@/components/ui/badge";
import type { ProductListItem } from "@/lib/catalog/queries";
import { cardStockMessage } from "@/lib/catalog/stock";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { productMorphName } from "@/lib/motion/transition-name";
import { cn } from "@/lib/utils";

/**
 * The storefront's most repeated surface, so it sets the tone for everything.
 *
 * ── Why the hover is built this way ──────────────────────────────────────
 *
 * The card used to be wrapped in a PointerSurface component, which tilted it
 * in 3D and painted a specular highlight that tracked the pointer. Neither
 * ever ran here, and the reason is worth recording: the grid also puts
 * `.scroll-settle` on that same element, and that is a scroll-driven animation
 * on `transform`. A running animation beats a plain declaration in the
 * cascade, so the tilt was overwritten on every card, permanently.
 *
 * What survived was the sheen, because it lived on a pseudo-element and so was
 * not overwritten — a white radial blob sitting dead centre over the card for
 * as long as the pointer was anywhere on it. The card appeared to have no
 * motion and one static smudge, which is exactly what it had.
 *
 * That component and its CSS have since been deleted outright. A 3D tilt
 * across twenty-four cards is the wrong instrument regardless: it draws the
 * eye to the container rather than the product, and twenty-four of them
 * tilting is a novelty, not a shop.
 *
 * What replaced it is quiet, and lives on the inner <article>, which nothing
 * else animates — so the two systems cannot collide again.
 *
 * ── Why every part of it shares one duration ─────────────────────────────
 *
 * The first version of this staggered them: the card lifted over 240ms and
 * the photo scaled over 560ms, on the theory that a slower image reads as
 * depth. It does not, at this size. What it actually produces is a card that
 * finishes arriving while the picture inside it is still moving, and then —
 * worse — on the way out, a card that drops back to rest while the photo
 * spends another third of a second shrinking. The eye tracks that as two
 * separate things happening to one object, which is the precise sensation of
 * an interface that has not been finished.
 *
 * So the lift, the photo and the wash all run at --duration-slow. One gesture,
 * one duration, one curve. The pieces move different distances, which is where
 * the depth actually comes from.
 *
 * 300ms is also short enough to survive a grid: dragging the pointer across a
 * row leaves each card fully settled before the next is touched, where a
 * half-second scale leaves four images easing at once and the whole grid
 * smears.
 *
 * The actions in the corner are the exception and stay at --duration-base.
 * They are not part of the card moving — they are a control appearing, and a
 * control the shopper may be reaching for should be there before they arrive.
 *
 * All transform and opacity, so a grid of these holds frame on the mid-range
 * Android in the performance budget.
 */
export function ProductCard({
  product,
  saved = false,
  priority,
  className,
}: {
  product: ProductListItem;
  saved?: boolean;
  /** Set on the first row so the LCP image is not lazy-loaded. */
  priority?: boolean;
  className?: string;
}) {
  const onSale =
    product.compareAtCents !== null &&
    product.compareAtCents > product.priceCents;
  const soldOut = product.stock <= 0;
  // Uses the shared rule so a card cannot quote a summed total as though it
  // were a buyable quantity.
  const stock = cardStockMessage({
    totalQuantity: product.stock,
    display: product.stockDisplay,
    lowStockThreshold: product.lowStockThreshold,
  });
  const lowStock = stock.kind === "low";
  const discount = onSale
    ? Math.round((1 - product.priceCents / (product.compareAtCents ?? 1)) * 100)
    : 0;
  // Combinations can be priced differently, so a single number would be a
  // guess. Show the span the shopper will actually choose within.
  const hasRange = product.maxPriceCents > product.priceCents;

  // The brand is the headline when there is one; the seller still gets named,
  // because on a marketplace who you are buying from is part of the offer.
  const brand = product.brandName;
  const seller = product.storeName;

  return (
    <div className={cn("group", className)}>
      <article
        data-morph-scope
        className={cn(
          "flex h-full flex-col overflow-hidden rounded-xl bg-surface-1",
          "shadow-e1 ring-1 ring-border/60",
          // The lift. transform and box-shadow only, and on this element
          // rather than the one the grid's scroll animation owns.
          //
          // 6px, not the 4px this started at. Four pixels against a shadow
          // that is already soft is below the threshold where a lift reads as
          // a lift at all — it looked like the card had simply got brighter.
          "transition-[transform,box-shadow] duration-(--duration-slow) ease-(--ease-out)",
          "[@media(hover:hover)]:group-hover:-translate-y-1.5",
          "[@media(hover:hover)]:group-hover:shadow-e3",
          // Pressing pushes it back down, so a tap has an answer on touch too.
          "active:translate-y-0 active:shadow-e1 active:duration-(--duration-instant)",
        )}
      >
        <div className="relative overflow-hidden">
          {/*
            Decorative, and deliberately so. The title below links to the same
            product, so leaving this one in the accessibility tree would give
            every card two identical links and every grid forty-eight tab
            stops. It also has no accessible name of its own when a product has
            no photo — nothing in it but an empty div.
          */}
          <Link
            /*
              Counted through the delegated data-track listener rather than an
              onClick: this is a navigation, and a handler racing the router is
              how a click gets recorded on some browsers and not others.
            */
            data-track="product-card"
            data-track-product={product.id}
            href={`/p/${product.slug}`}
            prefetch
            aria-hidden
            tabIndex={-1}
            className="block outline-none"
          >
            {/*
              4:3 rather than square. A square photo on a grid column this wide
              is tall enough to push everything else below the fold of the
              card, which made the old one read as an image with a caption
              instead of a product.

              data-morph is what MorphLink names when the card is clicked.
            */}
            <div
              data-morph
              className="relative aspect-[4/3] overflow-hidden bg-surface-sunken"
            >
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.title}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  priority={priority}
                  placeholder={product.blurDataUrl ? "blur" : "empty"}
                  blurDataURL={product.blurDataUrl ?? undefined}
                  className={cn(
                    "object-cover",
                    // Same duration and curve as the lift above. The photo
                    // travels further than the card does, which is where the
                    // sense of depth comes from — not from taking longer.
                    "transition-transform duration-(--duration-slow) ease-(--ease-out)",
                    "[@media(hover:hover)]:group-hover:scale-[1.05]",
                    soldOut && "opacity-55 saturate-50",
                  )}
                />
              ) : (
                <div className="absolute inset-0 bg-surface-2" />
              )}

              {/*
                A wash from the bottom. It keeps the badges legible over
                whatever photo a seller uploaded, and deepening it slightly on
                hover makes the image read as lit rather than merely bigger.
              */}
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0",
                  "bg-gradient-to-t from-black/20 via-transparent to-transparent",
                  "opacity-70 transition-opacity duration-(--duration-slow) ease-(--ease-out)",
                  "[@media(hover:hover)]:group-hover:opacity-100",
                )}
              />
            </div>
          </Link>

          {/* Status, top-left. */}
          {soldOut || onSale || lowStock ? (
            <div className="pointer-events-none absolute top-2.5 left-2.5 flex flex-col items-start gap-1">
              {soldOut ? (
                <Badge variant="neutral">Sold out</Badge>
              ) : onSale ? (
                <Badge variant="default">-{discount}%</Badge>
              ) : null}
              {lowStock && !soldOut ? (
                <Badge variant="critical">{stock.text}</Badge>
              ) : null}
            </div>
          ) : null}

          {/*
            Actions, top-right. Always visible on touch — a hover-only control
            is unreachable on a phone, which is where most of this traffic is.
            On a pointer they slide down from the edge, so the movement reads
            as the card answering rather than a layer blinking on.
          */}
          <div
            className={cn(
              "absolute top-2.5 right-2.5 flex flex-col gap-1.5",
              "transition-[opacity,transform] duration-(--duration-base) ease-(--ease-out)",
              "[@media(hover:hover)]:-translate-y-2 [@media(hover:hover)]:opacity-0",
              "[@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100",
              "[@media(hover:hover)]:group-focus-within:translate-y-0 [@media(hover:hover)]:group-focus-within:opacity-100",
            )}
          >
            <SaveButton productId={product.id} initialSaved={saved} />
            <QuickView slug={product.slug} />
          </div>
        </div>

        {/*
          p-4, not p-3. The old value put the title 12px from the card edge,
          which is close enough to read as an accident rather than a margin.
        */}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate font-medium text-[0.6875rem] text-secondary-text uppercase tracking-wide">
                {brand ?? seller}
              </span>
              {/* Only when the brand took the line above, so it never repeats. */}
              {brand ? (
                <span className="block truncate text-tertiary-text text-xs">
                  {seller}
                </span>
              ) : null}
            </span>

            {product.ratingCount > 0 ? (
              <RatingStars
                average={product.ratingAverage}
                count={product.ratingCount}
              />
            ) : null}
          </div>

          {/*
            The card's one accessible link, so it is also the one that morphs.
            MorphLink finds the image through data-morph-scope on the card.
          */}
          <MorphLink
            href={`/p/${product.slug}`}
            name={productMorphName(product.slug)}
            prefetch
            className={cn(
              "line-clamp-2 font-medium text-[0.9375rem] leading-snug",
              "outline-none transition-colors duration-(--duration-fast)",
              "[@media(hover:hover)]:group-hover:text-accent-text",
              "focus-visible:underline focus-visible:decoration-2 focus-visible:underline-offset-2",
            )}
          >
            {product.title}
          </MorphLink>

          {/*
            The line the old card had nowhere to put. Both facts change whether
            somebody clicks: how many choices there are, and whether it is
            about to run out.
          */}
          <p className="text-tertiary-text text-xs">
            {product.variantCount > 1
              ? `${product.variantCount} options`
              : "One option"}
            {/* Only "in stock". Low and sold-out already have a badge on the
                image, and saying it twice on one card is noise. */}
            {stock.kind === "in-stock" ? ` · ${stock.text}` : ""}
          </p>

          {/*
            Price on its own row, then a full-width button.

            Side by side they did not fit: a range like "$129.00 – $159.00" is
            wider than the column has left once the button is placed, so it
            wrapped onto two lines and collided with it. Stacking also gives
            the only call to action on the card a proper tap target, which
            matters more on the phone than the row of saved height did.
          */}
          <div className="mt-auto flex flex-col gap-2.5 pt-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="tabular font-semibold text-base leading-none">
                {formatMoney(product.priceCents, PLATFORM_CURRENCY)}
                {hasRange ? (
                  <span className="font-normal text-secondary-text">
                    {" – "}
                    {formatMoney(product.maxPriceCents, PLATFORM_CURRENCY)}
                  </span>
                ) : null}
              </span>

              {/*
                The original range is struck through beside the current one.
                With per-combination pricing there is no single "was" price, so
                crossing out one number would misstate the discount.
              */}
              {onSale && product.compareAtCents !== null ? (
                <span className="tabular text-tertiary-text text-xs line-through">
                  {formatMoney(product.compareAtCents, PLATFORM_CURRENCY)}
                  {product.compareAtMaxCents !== null &&
                  product.compareAtMaxCents > product.compareAtCents
                    ? ` – ${formatMoney(product.compareAtMaxCents, PLATFORM_CURRENCY)}`
                    : ""}
                </span>
              ) : null}
            </div>

            <QuickAdd
              variantId={product.defaultVariantId}
              variantCount={product.variantCount}
              productSlug={product.slug}
              soldOut={soldOut}
              className="w-full justify-center"
            />
          </div>
        </div>
      </article>
    </div>
  );
}
