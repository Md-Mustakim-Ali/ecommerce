"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { placeOrderAction } from "@/lib/actions/checkout";
import type { CartSummary } from "@/lib/cart";
import { formatMoney } from "@/lib/money/format";

/**
 * Checkout.
 *
 * Guest checkout is allowed, so email is collected rather than assumed from a
 * session. Shipping is shown in the summary from the first render — revealing
 * it at the final step is the single most common reason a cart is abandoned.
 *
 * The order is grouped by store in the summary, because that is how it will
 * actually arrive: one payment, one parcel per seller.
 */
export function CheckoutForm({
  cart,
  shippingCents,
  defaultEmail,
}: {
  cart: CartSummary;
  shippingCents: number;
  defaultEmail: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byStore = new Map<string, typeof cart.lines>();
  for (const line of cart.lines) {
    byStore.set(line.storeId, [...(byStore.get(line.storeId) ?? []), line]);
  }

  const total = cart.subtotalCents + shippingCents;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await placeOrderAction({
        email: String(data.get("email") ?? ""),
        shippingAddress: {
          recipientName: String(data.get("recipientName") ?? ""),
          phone: String(data.get("phone") ?? ""),
          line1: String(data.get("line1") ?? ""),
          line2: String(data.get("line2") ?? ""),
          city: String(data.get("city") ?? ""),
          region: String(data.get("region") ?? ""),
          postalCode: String(data.get("postalCode") ?? ""),
          countryCode: String(data.get("countryCode") ?? "").toUpperCase(),
        },
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }

      router.push(`/orders/${result.orderId}?placed=1`);
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-8 lg:grid-cols-[1fr_22rem]"
      noValidate
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="font-medium">Contact</h2>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={defaultEmail}
              required
            />
            <p className="text-tertiary-text text-xs">
              We send the receipt and shipping updates here.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="font-medium">Shipping address</h2>

          <div className="grid gap-2">
            <Label htmlFor="recipientName">Full name</Label>
            <Input
              id="recipientName"
              name="recipientName"
              autoComplete="name"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="line1">Address</Label>
            <Input
              id="line1"
              name="line1"
              autoComplete="address-line1"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="line2">Apartment, suite (optional)</Label>
            <Input id="line2" name="line2" autoComplete="address-line2" />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                autoComplete="address-level2"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="region">Region</Label>
              <Input id="region" name="region" autoComplete="address-level1" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="postalCode">Postcode</Label>
              <Input
                id="postalCode"
                name="postalCode"
                autoComplete="postal-code"
                required
              />
            </div>
          </div>

          <div className="grid gap-2 sm:max-w-40">
            <Label htmlFor="countryCode">Country code</Label>
            <Input
              id="countryCode"
              name="countryCode"
              autoComplete="country"
              placeholder="US"
              maxLength={2}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input id="phone" name="phone" type="tel" autoComplete="tel" />
          </div>
        </section>
      </div>

      <aside className="flex h-fit flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5 lg:sticky lg:top-24">
        <h2 className="font-medium">Your order</h2>

        {/* Grouped by store, because that is how it arrives. */}
        {[...byStore.entries()].map(([storeId, lines]) => (
          <div key={storeId} className="flex flex-col gap-2">
            <p className="text-tertiary-text text-xs">{lines[0].storeName}</p>
            {lines.map((line) => (
              <div
                key={line.itemId}
                className="flex justify-between gap-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="line-clamp-1">{line.title}</span>
                  <span className="text-tertiary-text text-xs">
                    {line.variantLabel ? `${line.variantLabel} · ` : ""}
                    Qty {line.quantity}
                  </span>
                </span>
                <span className="tabular shrink-0">
                  {formatMoney(line.lineTotalCents, "USD")}
                </span>
              </div>
            ))}
          </div>
        ))}

        <Separator />

        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-secondary-text">Subtotal</dt>
            <dd className="tabular">
              {formatMoney(cart.subtotalCents, "USD")}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-secondary-text">Shipping</dt>
            <dd className="tabular">
              {shippingCents === 0 ? "Free" : formatMoney(shippingCents, "USD")}
            </dd>
          </div>
        </dl>

        <Separator />

        <div className="flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="tabular font-semibold text-xl">
            {formatMoney(total, "USD")}
          </span>
        </div>

        <p className="text-tertiary-text text-xs">
          {byStore.size > 1
            ? `Items from ${byStore.size} stores. One payment, ${byStore.size} parcels.`
            : "One payment, one parcel."}
        </p>

        {error ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? "Placing order…" : "Place order"}
        </Button>
      </aside>
    </form>
  );
}
