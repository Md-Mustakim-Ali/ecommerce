"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { CartSummary } from "@/lib/cart";

type CartContextValue = {
  count: number;
  /** Bump the badge before the server has answered. */
  bump: (by: number) => void;
  /** Reconcile against the server's real cart. */
  sync: (cart: CartSummary) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Holds just enough cart state for the badge and the drawer.
 *
 * Deliberately not a state management library. AGENTS.md asks before adding
 * one, and the only truly global cart state is a number and a boolean — the
 * lines themselves are fetched by the drawer when it opens.
 *
 * The badge moves the instant you tap add-to-cart and reconciles when the
 * action returns. Waiting for a round trip is what makes an add feel slow even
 * when the request is fast.
 */
export function CartProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: React.ReactNode;
}) {
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);

  const bump = useCallback((by: number) => {
    setCount((current) => Math.max(0, current + by));
  }, []);

  const sync = useCallback((cart: CartSummary) => {
    setCount(cart.itemCount);
  }, []);

  const value = useMemo(
    () => ({ count, bump, sync, open, setOpen }),
    [count, bump, sync, open],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
