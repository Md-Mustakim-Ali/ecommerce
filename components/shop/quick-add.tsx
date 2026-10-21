"use client";

import { Check, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useCart } from "@/components/shop/cart-provider";
import { addToCartAction } from "@/lib/actions/cart";
import { cn } from "@/lib/utils";

/**
 * Quick add, straight from a card.
 *
 * Only adds directly when the product has exactly one variant. With options,
 * "add to cart" from a grid means guessing a size for someone, so it routes to
 * the product page instead — the honest behaviour, and the one that avoids a
 * return.
 */
export function QuickAdd({
  variantId,
  variantCount,
  productSlug,
  soldOut,
  className,
}: {
  variantId: string | null;
  variantCount: number;
  productSlug: string;
  soldOut: boolean;
  className?: string;
}) {
  const { bump, sync, setOpen } = useCart();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  const needsChoice = variantCount > 1;

  function handle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (soldOut) return;

    if (needsChoice || !variantId) {
      router.push(`/p/${productSlug}`);
      return;
    }

    bump(1);
    setAdded(true);
    navigator.vibrate?.(10);

    startTransition(async () => {
      const result = await addToCartAction({ variantId, quantity: 1 });
      if (!result.ok) {
        bump(-1);
        setAdded(false);
        return;
      }
      sync(result.cart);
      setOpen(true);
      setTimeout(() => setAdded(false), 1400);
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={soldOut || pending}
      aria-label={
        soldOut ? "Sold out" : needsChoice ? "Choose options" : "Add to cart"
      }
      title={
        soldOut ? "Sold out" : needsChoice ? "Choose options" : "Add to cart"
      }
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-control px-3 font-medium text-xs",
        "touch-manipulation transition-all active:scale-[0.94]",
        soldOut
          ? "cursor-not-allowed bg-surface-2 text-tertiary-text"
          : "bg-accent text-on-accent shadow-e1 hover:bg-accent-hover",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : added ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Plus className="size-3.5" aria-hidden />
      )}
      {soldOut ? "Sold out" : added ? "Added" : needsChoice ? "Options" : "Add"}
    </button>
  );
}
