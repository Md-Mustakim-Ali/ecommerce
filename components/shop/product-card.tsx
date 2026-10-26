import Image from "next/image";
import Link from "next/link";
import { MorphLink } from "@/components/motion/morph-link";
import { PointerSurface } from "@/components/motion/pointer-surface";
import { QuickAdd } from "@/components/shop/quick-add";
import { QuickView } from "@/components/shop/quick-view";
import { RatingStars } from "@/components/shop/rating-stars";
import { SaveButton } from "@/components/shop/save-button";
import { Badge } from "@/components/ui/badge";
import type { ProductListItem } from "@/lib/catalog/queries";
import { cardStockMessage } from "@/lib/catalog/stock";
import { formatMoney } from "@/lib/money/format";
import { productMorphName } from "@/lib/motion/transition-name";
import { cn } from "@/lib/utils";

/**
 * The storefront's most repeated surface, so it sets the tone for everything.
 *
 * Rebuilt from a version that read as a placeholder, for reasons worth writing
 * down because they are all the same reason:
 *
 * The image was square and inset inside a padded card, which made the photo
 * roughly two thirds of the card's height and left the information crammed
 * into what was left. The fix is not smaller padding — it is a shorter image
 * (4:3) that runs edge to edge, so the card has a top rather than a frame, and
 * the space saved goes to the text instead of to a margin around a picture.
 *
 * The text then gets real padding, because 12px against a card edge is what
 * made it feel stuck to the side rather than laid out.
 *
 * And there is more of it. A card carrying only a name and a price is asking
 * the shopper to open the page to learn anything, which on a grid of
 * twenty-four is twenty-four wasted trips. Seller, rating, stock and variant
 * count are all already loaded — showing them costs nothing and answers most
 * of the questions that would otherwise be a click.
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
    <PointerSurface className={cn("group rounded-xl", className)}>
      <article
        data-morph-scope
        className={cn(
          "flex h-full flex-col overflow-hidden rounded-xl bg-surface-1 shadow-e1",
          "ring-1 ring-border/60 transition-shadow duration-[--duration-base]",
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
            href={`/p/${product.slug}`}
            prefetch
            aria-hidden
            tabIndex={-1}
            className="block outline-none"
          >
            {/*
              4:3 rather than square. A square photo on a grid column this wide
              is tall enough to push everything else below the fold of the
              card, which is what made the old one feel like an image with a
              caption instead of a product.

              data-morph is what MorphLink names when the card is clicked.
            */}
            <div
              data-morph
              className="parallax relative aspect-[4/3] overflow-hidden bg-surface-sunken"
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
                    // The hover the card was missing. The photo is the biggest
                    // thing on the card and it did not move at all, which is
                    // why hovering felt like nothing was happening. Scale is
                    // compositor-only, so a grid of these still holds frame.
                    "transition-transform duration-[--duration-slow] ease-[--ease-out]",
                    "[@media(hover:hover)]:group-hover:scale-[1.06]",
                    soldOut && "opacity-60 saturate-50",
                  )}
                />
              ) : (
                <div className="absolute inset-0 bg-surface-2" />
              )}

              {/*
                A wash that deepens on hover, so the image reads as lit rather
                than simply enlarged, and the badges keep their contrast over
                whatever photo a seller uploaded.
              */}
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0",
                  "bg-gradient-to-t from-black/25 via-transparent to-transparent",
                  "opacity-60 transition-opacity duration-[--duration-base]",
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
            On a pointer they slide in from the edge rather than fading, so the
            movement reads as the card responding rather than a layer blinking
            on.
          */}
          <div
            className={cn(
              "absolute top-2.5 right-2.5 flex flex-col gap-1.5",
              "transition-[opacity,transform] duration-[--duration-base] ease-[--ease-out]",
              "[@media(hover:hover)]:-translate-y-1 [@media(hover:hover)]:opacity-0",
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
              "outline-none transition-colors hover:text-accent-text",
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
                {formatMoney(product.priceCents, "USD")}
                {hasRange ? (
                  <span className="font-normal text-secondary-text">
                    {" – "}
                    {formatMoney(product.maxPriceCents, "USD")}
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
                  {formatMoney(product.compareAtCents, "USD")}
                  {product.compareAtMaxCents !== null &&
                  product.compareAtMaxCents > product.compareAtCents
                    ? ` – ${formatMoney(product.compareAtMaxCents, "USD")}`
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
    </PointerSurface>
  );
}
