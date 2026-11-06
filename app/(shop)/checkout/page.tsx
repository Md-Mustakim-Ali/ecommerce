import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { PlacementSlot } from "@/components/content/placement-slot";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/guards";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { addresses } from "@/lib/db/schema";
import { jommaConfigured } from "@/lib/payments/jomma/client";
import { getPlatformSettings, shippingFor } from "@/lib/settings";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const [cart, session] = await Promise.all([getCart(), getSession()]);

  // The saved default, if there is one. A signed-in buyer retyping the same
  // address on every order is the most avoidable friction in checkout.
  const [defaultAddress] = session
    ? await db
        .select()
        .from(addresses)
        .where(
          and(
            eq(addresses.userId, session.user.id),
            eq(addresses.isDefaultShipping, true),
          ),
        )
        .limit(1)
    : [];

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
  const settings = await getPlatformSettings();
  const shippingCents = shippingFor(cart.subtotalCents, settings);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <PlacementSlot route={{ kind: "cart" }} slot="above_content" />

      <h1 className="font-semibold text-2xl tracking-tight">Checkout</h1>

      <CheckoutForm
        cart={cart}
        shippingCents={shippingCents}
        // Read on the server. The form must not decide this for itself: the
        // check reads JOMMA_* environment variables, which never reach the
        // browser, and offering a method that cannot start is worse than not
        // offering it.
        jommaAvailable={jommaConfigured()}
        defaultEmail={session?.user.email ?? ""}
        defaultAddress={
          defaultAddress
            ? {
                recipientName: defaultAddress.recipientName,
                phone: defaultAddress.phone,
                line1: defaultAddress.line1,
                line2: defaultAddress.line2,
                city: defaultAddress.city,
                region: defaultAddress.region,
                postalCode: defaultAddress.postalCode,
                countryCode: defaultAddress.countryCode,
              }
            : null
        }
      />
    </div>
  );
}
