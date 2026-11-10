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
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import type { PaymentMethod } from "@/lib/payments/methods";
import { cn } from "@/lib/utils";

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
/**
 * `manual` stays first and stays the default.
 *
 * Nothing here silently changes how an existing order settles: a buyer who
 * ignores this section gets exactly the behaviour the shop had before bKash
 * was added.
 */
const METHODS = [
  {
    value: "manual" as const,
    label: "Pay on delivery / bank transfer",
    description: "We confirm your payment before dispatch.",
  },
  {
    // One option, not one per provider.
    //
    // Splitting bKash and Nagad here was a mistake worth recording, because it
    // looked like giving the buyer control and actually took control away.
    // Jomma routes an intent by picking the *least utilised* healthy receiving
    // account across every provider. Naming one provider filters that pool
    // before it is sorted, so a buyer who chose bKash gets turned away when the
    // bKash number is near its daily cap — while an idle Nagad account sits
    // right there. It also removes failover: one phone drops off and that
    // checkout dies instead of routing around it.
    //
    // The choice is not lost, it moves to where it can be made properly. The
    // hosted pay page offers a provider switch with live knowledge of which
    // accounts are actually healthy, which a radio button rendered minutes
    // earlier on this page cannot have.
    value: "any" as const,
    label: "bKash / Nagad",
    description:
      "Send money from your mobile wallet. We verify it automatically and you pick the app on the next step.",
  },
];

export function CheckoutForm({
  cart,
  shippingCents,
  defaultEmail,
  defaultAddress,
  jommaAvailable,
}: {
  cart: CartSummary;
  shippingCents: number;
  defaultEmail: string;
  /** Whether bKash/Nagad can be offered. Decided on the server. */
  jommaAvailable: boolean;
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

  const [method, setMethod] = useState<PaymentMethod>("manual");
  // Anything that is not the offline path settles through Jomma.
  const mobileMoney = method !== "manual";

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
        // Re-validated on the server against the same enum. The browser names
        // a method; it does not get to name anything about the money.
        paymentMethod: method,
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

          {/*
            A delivery number, and only that.

            This field used to become required and relabel itself when bKash was
            selected, on the assumption that the number somebody wants a parcel
            delivered to is the number they pay from. Those are routinely
            different people — a parcel goes to the recipient, the payment comes
            from whoever is buying it — and conflating them would have quietly
            fed the wrong number into payment matching.

            The number to pay from is asked for on the pay page, where the
            question can actually be answered.
          */}
          <div className="grid gap-2">
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input
              id="phone"
              name="phone"
              defaultValue={defaultAddress?.phone ?? ""}
              type="tel"
              autoComplete="tel"
            />
            <p className="text-tertiary-text text-xs">
              For delivery updates. The courier may call this number.
            </p>
          </div>
        </section>

        {jommaAvailable ? (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
            <h2 className="font-medium">Payment</h2>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Payment method</legend>
              {METHODS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    method === option.value
                      ? "border-accent bg-accent-muted"
                      : "border-border hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={option.value}
                    checked={method === option.value}
                    onChange={() => setMethod(option.value)}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">{option.label}</span>
                    <span className="text-secondary-text text-xs">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>
        ) : null}
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
                  {formatMoney(line.lineTotalCents, PLATFORM_CURRENCY)}
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
              {formatMoney(cart.subtotalCents, PLATFORM_CURRENCY)}
            </dd>
          </div>

          {discount && discount.amountCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-positive">{discount.code}</dt>
              <dd className="tabular text-positive">
                −{formatMoney(discount.amountCents, PLATFORM_CURRENCY)}
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
                formatMoney(shippingAfter, PLATFORM_CURRENCY)
              )}
            </dd>
          </div>
        </dl>

        <Separator />

        <div className="flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="tabular font-semibold text-xl">
            {formatMoney(total, PLATFORM_CURRENCY)}
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
          {pending
            ? "Placing order…"
            : mobileMoney
              ? "Continue to payment"
              : "Place order"}
        </Button>

        {mobileMoney ? (
          <p className="text-tertiary-text text-xs">
            You will be taken to a secure page to choose bKash or Nagad and see
            the number to send to. Your order is confirmed once we have verified
            the payment.
          </p>
        ) : null}
      </aside>
    </form>
  );
}
