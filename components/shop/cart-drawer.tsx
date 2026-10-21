"use client";

import { Loader2, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Drawer } from "vaul";
import { useCart } from "@/components/shop/cart-provider";
import { Button } from "@/components/ui/button";
import {
  refreshCartAction,
  removeFromCartAction,
  setCartQuantityAction,
} from "@/lib/actions/cart";
import type { CartSummary } from "@/lib/cart";
import { formatMoney } from "@/lib/money/format";

/**
 * Cart drawer.
 *
 * Lines are fetched when it opens rather than held in context — the badge is
 * the only thing that has to be instant, and keeping full line data in a
 * provider means every add-to-cart re-renders the whole tree.
 *
 * Vaul handles drag-to-dismiss with a velocity threshold.
 */
export function CartDrawer({ trigger }: { trigger: React.ReactNode }) {
  const { open, setOpen, sync } = useCart();
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    refreshCartAction()
      .then((next) => {
        if (cancelled) return;
        setCart(next);
        sync(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sync]);

  function update(itemId: string, quantity: number) {
    startTransition(async () => {
      const result = await setCartQuantityAction({ itemId, quantity });
      if (result.ok) {
        setCart(result.cart);
        sync(result.cart);
      }
    });
  }

  function remove(itemId: string) {
    startTransition(async () => {
      const result = await removeFromCartAction({ itemId });
      if (result.ok) {
        setCart(result.cart);
        sync(result.cart);
      }
    });
  }

  const currency = "USD";

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} direction="right">
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(26rem,92vw)] flex-col bg-surface-1 shadow-e4 outline-none">
          <div className="flex items-center justify-between gap-2 border-border border-b px-5 py-4">
            <Drawer.Title className="font-semibold text-base">
              Your cart
            </Drawer.Title>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close cart"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>

          {loading && !cart ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2
                className="size-5 animate-spin text-tertiary-text"
                aria-hidden
              />
            </div>
          ) : !cart || cart.lines.length === 0 ? (
            // An empty state is an invitation to act, not a shrug.
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="grid size-14 place-items-center rounded-full bg-surface-2">
                <ShoppingBag
                  className="size-6 text-tertiary-text"
                  aria-hidden
                />
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-medium">Nothing in here yet</p>
                <p className="text-secondary-text text-sm">
                  Items you add from any store end up in this one cart.
                </p>
              </div>
              <Button
                render={<Link href="/search" />}
                onClick={() => setOpen(false)}
              >
                Browse products
              </Button>
            </div>
          ) : (
            <>
              <ul className="flex-1 divide-y divide-border overflow-y-auto">
                {cart.lines.map((line) => (
                  <li key={line.itemId} className="flex gap-3 px-5 py-4">
                    <div
                      className="size-16 shrink-0 overflow-hidden rounded-md bg-surface-sunken"
                      style={
                        line.imageUrl
                          ? {
                              backgroundImage: `url(${line.imageUrl})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link
                        href={`/p/${line.productSlug}`}
                        onClick={() => setOpen(false)}
                        className="line-clamp-2 font-medium text-sm"
                      >
                        {line.title}
                      </Link>
                      <p className="text-tertiary-text text-xs">
                        {line.storeName}
                        {line.variantLabel ? ` · ${line.variantLabel}` : ""}
                      </p>

                      <div className="mt-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 rounded-control border border-border">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Decrease quantity"
                            disabled={pending}
                            onClick={() =>
                              update(line.itemId, line.quantity - 1)
                            }
                          >
                            <Minus />
                          </Button>
                          <span className="tabular w-6 text-center text-sm">
                            {line.quantity}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Increase quantity"
                            disabled={pending || line.quantity >= line.stock}
                            onClick={() =>
                              update(line.itemId, line.quantity + 1)
                            }
                          >
                            <Plus />
                          </Button>
                        </div>

                        <span className="tabular font-medium text-sm">
                          {formatMoney(line.lineTotalCents, currency)}
                        </span>
                      </div>

                      {line.quantity > line.stock ? (
                        <p className="text-critical text-xs">
                          Only {line.stock} left — reduce the quantity to check
                          out.
                        </p>
                      ) : null}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${line.title}`}
                      disabled={pending}
                      onClick={() => remove(line.itemId)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-3 border-border border-t px-5 py-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-secondary-text text-sm">Subtotal</span>
                  <span className="tabular font-semibold text-lg">
                    {formatMoney(cart.subtotalCents, currency)}
                  </span>
                </div>
                <p className="text-tertiary-text text-xs">
                  Shipping is calculated at checkout, before the final step.
                </p>
                <Button
                  size="lg"
                  block
                  disabled={cart.problems.length > 0}
                  render={<Link href="/checkout" />}
                  onClick={() => setOpen(false)}
                >
                  Checkout
                </Button>
              </div>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
