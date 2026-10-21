import type { Metadata } from "next";
import Link from "next/link";
import { PlacementSlot } from "@/components/content/placement-slot";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/guards";
import { getCart } from "@/lib/cart";
import { shippingFor } from "@/lib/orders/shipping";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const [cart, session] = await Promise.all([getCart(), getSession()]);

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
        <h1 className="font-semibold text-2xl tracking-tight">
          Nothing to check out
        </h1>
        <p className="text-secondary-text text-sm">
          Your cart is empty. Add something first.
        </p>
        <Button render={<Link href="/search" />}>Browse products</Button>
      </div>
    );
  }

  // Shipping is shown here, before the final step. AGENTS.md is explicit that
  // it must never be revealed at the end.
  const shippingCents = shippingFor(cart.subtotalCents);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <PlacementSlot route={{ kind: "cart" }} slot="above_content" />

      <h1 className="font-semibold text-2xl tracking-tight">Checkout</h1>

      <CheckoutForm
        cart={cart}
        shippingCents={shippingCents}
        defaultEmail={session?.user.email ?? ""}
      />
    </div>
  );
}
