"use client";

import { Check, Loader2, ShoppingBag } from "lucide-react";
import { useState, useTransition } from "react";
import { useCart } from "@/components/shop/cart-provider";
import { Button } from "@/components/ui/button";
import { addToCartAction } from "@/lib/actions/cart";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/utils";

/**
 * Optimistic add to cart.
 *
 * The badge moves on press, before the request goes out, and reconciles from
 * the server's answer. If the server rejects it — sold out, or someone else
 * took the last one — the badge is put back and the reason is shown.
 *
 * navigator.vibrate is Android-only; iOS Safari does not implement it, so
 * nothing may depend on it firing.
 */
export function AddToCart({
  variantId,
  productId,
  storeId,
  disabled,
  soldOut,
  className,
  size = "lg",
}: {
  variantId: string | null;
  /*
    Only for the analytics event. Optional because the cart itself needs
    neither — it works from the variant — and a caller that cannot supply them
    should still be able to render a working button rather than be blocked by
    a reporting concern.
  */
  productId?: string;
  storeId?: string;
  disabled?: boolean;
  soldOut?: boolean;
  className?: string;
  size?: "default" | "lg";
}) {
  const { bump, sync, setOpen } = useCart();
  const [pending, startTransition] = useTransition();
  const [justAdded, setJustAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!variantId || pending) return;
    setError(null);

    // Optimistic: the badge is already correct by the time the press
    // animation finishes.
    bump(1);
    setJustAdded(true);
    navigator.vibrate?.(10);

    startTransition(async () => {
      const result = await addToCartAction({ variantId, quantity: 1 });

      if (!result.ok) {
        bump(-1);
        setJustAdded(false);
        setError(result.message);
        return;
      }

      // After the server agreed, never on the optimistic bump above: an add
      // that failed is not intent, it is a bug, and counting it would inflate
      // exactly the products whose stock keeps running out.
      track({ type: "add_to_cart", variantId, productId, storeId });

      sync(result.cart);
      setOpen(true);
      setTimeout(() => setJustAdded(false), 1400);
    });
  }

  if (soldOut) {
    return (
      <Button size={size} block disabled className={className}>
        Sold out
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        size={size}
        block
        // pointerdown, not click: the press should register the moment the
        // finger lands.
        onPointerDown={add}
        disabled={disabled || !variantId}
        className={cn("relative", className)}
        aria-live="polite"
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : justAdded ? (
          <Check aria-hidden />
        ) : (
          <ShoppingBag aria-hidden />
        )}
        {justAdded ? "Added" : "Add to cart"}
      </Button>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
