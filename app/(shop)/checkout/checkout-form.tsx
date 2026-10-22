"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { placeOrderAction } from "@/lib/actions/checkout";
import { checkDiscountAction } from "@/lib/actions/discounts";
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
  defaultAddress,
}: {
  cart: CartSummary;
  shippingCents: number;
  defaultEmail: string;
  /** The buyer's saved default, pre-filled. Null for guests. */
  defaultAddress: {
    recipientName: string;
    phone: string | null;
    line1: string;
    line2: string | null;
    city: string;
    region: string | null;
    postalCode: string;
    countryCode: string;
  } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [discount, setDiscount] = useState<{
    code: string;
    label: string;
    amountCents: number;
    shippingDiscountCents: number;
    description: string | null;
  } | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();

  const byStore = new Map<string, typeof cart.lines>();
  for (const line of cart.lines) {
    byStore.set(line.storeId, [...(byStore.get(line.storeId) ?? []), line]);
  }

  const shippingAfter = Math.max(
    0,
    shippingCents - (discount?.shippingDiscountCents ?? 0),
  );
  const total =
    cart.subtotalCents + shippingAfter - (discount?.amountCents ?? 0);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await placeOrderAction({
        discountCode: discount?.code,
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
              defaultValue={defaultAddress?.recipientName ?? ""}
              autoComplete="name"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="line1">Address</Label>
            <Input
              id="line1"
              name="line1"
              defaultValue={defaultAddress?.line1 ?? ""}
              autoComplete="address-line1"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="line2">Apartment, suite (optional)</Label>
            <Input
              id="line2"
              name="line2"
              defaultValue={defaultAddress?.line2 ?? ""}
              autoComplete="address-line2"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                defaultValue={defaultAddress?.city ?? ""}
                autoComplete="address-level2"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="region">Region</Label>
              <Input
                id="region"
                name="region"
                defaultValue={defaultAddress?.region ?? ""}
                autoComplete="address-level1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="postalCode">Postcode</Label>
              <Input
                id="postalCode"
                name="postalCode"
                defaultValue={defaultAddress?.postalCode ?? ""}
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
              defaultValue={defaultAddress?.countryCode ?? ""}
              autoComplete="country"
              placeholder="US"
              maxLength={2}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input
              id="phone"
              name="phone"
              defaultValue={defaultAddress?.phone ?? ""}
              type="tel"
              autoComplete="tel"
            />
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

        {/*
          A nested <form> is invalid HTML, so this is a div with its own submit
          handler. Enter still applies the code rather than placing the order,
          which is what someone typing a coupon expects.
        */}
        <div className="flex flex-col gap-2">
          {discount ? (
            <div className="flex items-start justify-between gap-3 rounded-lg bg-positive-muted px-3 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium text-positive text-sm">
                  {discount.code} applied
                </span>
                <span className="text-secondary-text text-xs">
                  {discount.description ?? discount.label}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDiscount(null);
                  setDiscountError(null);
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="discountCode">Discount code</Label>
              <div className="flex gap-2">
                <Input
                  id="discountCode"
                  name="discountCode"
                  placeholder="SAVE10"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="uppercase"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const input = event.currentTarget;
                    startChecking(async () => {
                      const result = await checkDiscountAction({
                        code: input.value,
                      });
                      if (!result.ok) {
                        setDiscount(null);
                        setDiscountError(result.message);
                        return;
                      }
                      setDiscountError(null);
                      setDiscount(result);
                    });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={checking}
                  onClick={(event) => {
                    const input =
                      event.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                        "#discountCode",
                      );
                    if (!input) return;
                    startChecking(async () => {
                      const result = await checkDiscountAction({
                        code: input.value,
                      });
                      if (!result.ok) {
                        setDiscount(null);
                        setDiscountError(result.message);
                        return;
                      }
                      setDiscountError(null);
                      setDiscount(result);
                    });
                  }}
                >
                  {checking ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  Apply
                </Button>
              </div>
              {discountError ? (
                <p role="alert" className="text-critical text-xs">
                  {discountError}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <Separator />

        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-secondary-text">Subtotal</dt>
            <dd className="tabular">
              {formatMoney(cart.subtotalCents, "USD")}
            </dd>
          </div>

          {discount && discount.amountCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-positive">{discount.code}</dt>
              <dd className="tabular text-positive">
                −{formatMoney(discount.amountCents, "USD")}
              </dd>
            </div>
          ) : null}

          <div className="flex justify-between">
            <dt className="text-secondary-text">Shipping</dt>
            <dd className="tabular">
              {shippingAfter === 0 ? (
                discount && discount.shippingDiscountCents > 0 ? (
                  <span className="text-positive">Free</span>
                ) : (
                  "Free"
                )
              ) : (
                formatMoney(shippingAfter, "USD")
              )}
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
