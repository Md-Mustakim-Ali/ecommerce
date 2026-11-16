"use client";

import { Loader2, Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { saveAddressAction } from "@/lib/actions/addresses";
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

/** A row from the buyer's address book. Empty for guests. */
export type SavedCheckoutAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  countryCode: string;
  isDefaultShipping: boolean;
};

/** What actually gets submitted, whichever way the buyer arrived at it. */
type AddressFields = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
};

const EMPTY_ADDRESS: AddressFields = {
  recipientName: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "",
};

/** The "somewhere else" choice. Deliberately not a uuid, so it cannot collide. */
const NEW_ADDRESS = "new";

function toFields(address: SavedCheckoutAddress): AddressFields {
  return {
    recipientName: address.recipientName,
    // Optional in the address book, required to deliver — so a saved address
    // without one still has to be asked about before this order can be placed.
    phone: address.phone ?? "",
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    region: address.region ?? "",
    postalCode: address.postalCode,
    countryCode: address.countryCode,
  };
}

export function CheckoutForm({
  cart,
  shippingCents,
  defaultEmail,
  defaultContactPhone,
  savedAddresses,
  signedIn,
  jommaAvailable,
}: {
  cart: CartSummary;
  shippingCents: number;
  defaultEmail: string;
  /** The signed-in buyer's own number, if their account carries one. */
  defaultContactPhone: string;
  /** Whether bKash/Nagad can be offered. Decided on the server. */
  jommaAvailable: boolean;
  /** The buyer's address book, default first. Empty for guests. */
  savedAddresses: SavedCheckoutAddress[];
  /** Whether there is an account to save a new address into. */
  signedIn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Address selection.
   *
   * The saved default is preselected, which is what the old pre-fill did — the
   * difference is that the other saved addresses are now reachable without
   * retyping one over the top of another.
   *
   * `fields` is the address being submitted, not the address book. Editing it
   * changes this order only; the saved row is written from /account/addresses
   * or from the save-for-next-time offer below, never as a side effect of
   * correcting a postcode at checkout.
   */
  const preselected =
    savedAddresses.find((address) => address.isDefaultShipping) ??
    savedAddresses[0] ??
    null;
  const [selectedId, setSelectedId] = useState(preselected?.id ?? NEW_ADDRESS);
  const [fields, setFields] = useState<AddressFields>(
    preselected ? toFields(preselected) : EMPTY_ADDRESS,
  );
  // What was typed into the "somewhere else" form, kept across a detour to a
  // saved address so a half-filled address is not silently thrown away.
  const [draft, setDraft] = useState<AddressFields>(EMPTY_ADDRESS);
  const [editing, setEditing] = useState(false);
  const [saveToAccount, setSaveToAccount] = useState(false);

  /**
   * How to reach the buyer, as opposed to where the parcel goes.
   *
   * At least one of these, never neither — the same rule the server and the
   * orders table both enforce. It is also what an account claims this order
   * by later, which is why the number here is asked for separately from the
   * delivery number rather than assumed to be it.
   */
  const [contactEmail, setContactEmail] = useState(defaultEmail);
  const [contactPhone, setContactPhone] = useState(defaultContactPhone);
  /**
   * Defaulted on, because most people buy for themselves and the alternative
   * is making everyone type one number twice.
   *
   * Turning it off is the case that matters: a parcel sent to someone else
   * carries their number for the courier, and leaving that as the contact
   * would let them claim this order once they verified it. Cheap to fix, and
   * only fixable if the option is visible — hence a checkbox rather than a
   * silent copy.
   */
  const [phoneSameAsDelivery, setPhoneSameAsDelivery] = useState(
    defaultContactPhone.length === 0,
  );

  // What actually gets submitted as the contact number.
  const effectiveContactPhone = phoneSameAsDelivery
    ? fields.phone
    : contactPhone;

  const selected =
    savedAddresses.find((address) => address.id === selectedId) ?? null;
  const enteringNew = selectedId === NEW_ADDRESS;

  function selectAddress(id: string) {
    if (enteringNew) setDraft(fields);
    const address = savedAddresses.find((saved) => saved.id === id) ?? null;
    setFields(address ? toFields(address) : draft);
    setSelectedId(id);
    setEditing(false);
  }

  function setField(name: keyof AddressFields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

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

    // Read from state rather than the form, because a selected saved address
    // has its inputs collapsed and an unmounted input contributes nothing to
    // FormData.
    const shippingAddress = {
      ...fields,
      countryCode: fields.countryCode.toUpperCase(),
    };

    startTransition(async () => {
      const result = await placeOrderAction({
        discountCode: discount?.code,
        // Re-validated on the server against the same enum. The browser names
        // a method; it does not get to name anything about the money.
        paymentMethod: method,
        email: contactEmail.trim(),
        contactPhone: effectiveContactPhone.trim(),
        shippingAddress,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      // Only once the order exists, and never allowed to break it. The buyer
      // came here to buy; a full address book or a rejected field must not
      // turn a placed order into an error message on this page.
      if (saveToAccount && enteringNew) {
        try {
          await saveAddressAction({
            ...shippingAddress,
            // Their only address. Making it the default now saves a trip to
            // the address book to say the obvious thing.
            isDefaultShipping: savedAddresses.length === 0,
          });
        } catch {
          // Nothing to tell the buyer. The order is placed either way, and the
          // address can be saved from /account/addresses.
        }
      }

      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }

      /**
       * Always the order page, gated or not.
       *
       * This used to render a "check your email" panel from client state here,
       * which looked right and was not: placing an order empties the cart, the
       * checkout page re-renders on the server, sees nothing in it, and swaps
       * the whole form for "Nothing to check out". The buyer finished checkout
       * and was told their cart was empty.
       *
       * The order page reads the real status instead, so the message survives
       * a refresh and is still there when they come back to the link.
       *
       * The token comes back from the action because a guest has no session
       * and that page has nothing else to recognise them by.
       */
      router.push(
        `/orders/${result.orderId}?placed=1&t=${encodeURIComponent(result.accessToken)}`,
      );
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
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contactPhone">Your phone</Label>
            <Input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01712345678"
              value={effectiveContactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              disabled={phoneSameAsDelivery}
            />

            {/*
              The cross-option. Most orders go to the person placing them, so
              this starts on and the number is typed once — but a parcel sent
              to somebody else carries *their* number for the courier, and
              leaving that as the contact would hand them this order the day
              they made an account with it.
            */}
            <label className="flex items-center gap-2 text-secondary-text text-sm">
              <input
                type="checkbox"
                checked={phoneSameAsDelivery}
                onChange={(event) => {
                  setPhoneSameAsDelivery(event.target.checked);
                  // Carried over rather than blanked, so unticking it to make
                  // a small correction does not mean retyping the number.
                  if (!event.target.checked && contactPhone.length === 0) {
                    setContactPhone(fields.phone);
                  }
                }}
                className="size-4 accent-accent"
              />
              Same as the delivery number
            </label>
          </div>

          <p className="text-tertiary-text text-xs">
            Give at least one. Your receipt and order updates go here, and it is
            how this order finds your account if you make one later.
          </p>
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="font-medium">Shipping address</h2>

          {/*
            The address book, as a choice rather than a pre-fill.

            Checkout used to copy the default address into the fields and leave
            the buyer to overwrite it, which made every other saved address
            invisible: someone shipping to work had to retype it over their
            home address on every order.
          */}
          {savedAddresses.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Deliver to</legend>

              {savedAddresses.map((address) => (
                <label
                  key={address.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    selectedId === address.id
                      ? "border-accent bg-accent-muted"
                      : "border-border hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name="savedAddress"
                    value={address.id}
                    checked={selectedId === address.id}
                    onChange={() => selectAddress(address.id)}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
                      {address.label ?? address.recipientName}
                      {address.isDefaultShipping ? (
                        <Badge variant="muted">
                          <Star aria-hidden /> Default
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-secondary-text text-xs leading-relaxed">
                      {address.recipientName}, {address.line1}
                      {address.line2 ? `, ${address.line2}` : ""}
                      <br />
                      {address.city}
                      {address.region ? `, ${address.region}` : ""}{" "}
                      {address.postalCode}, {address.countryCode}
                    </span>
                  </span>
                </label>
              ))}

              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                  enteringNew
                    ? "border-accent bg-accent-muted"
                    : "border-border hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name="savedAddress"
                  value={NEW_ADDRESS}
                  checked={enteringNew}
                  onChange={() => selectAddress(NEW_ADDRESS)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium text-sm">
                    <Plus className="size-4" aria-hidden />
                    Ship somewhere else
                  </span>
                  <span className="text-secondary-text text-xs">
                    Enter an address for this order.
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}

          {selected && !editing ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                Edit for this order
              </Button>
              <p className="text-tertiary-text text-xs">
                Corrections apply to this order. Your saved address stays as it
                is.
              </p>
            </div>
          ) : null}

          {/*
            Hidden, not just unused, while a saved address is selected. The
            submitted address is read from state for exactly this reason.
          */}
          {selected && !editing ? null : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="recipientName">Full name</Label>
                <Input
                  id="recipientName"
                  name="recipientName"
                  value={fields.recipientName}
                  onChange={(event) =>
                    setField("recipientName", event.target.value)
                  }
                  autoComplete="name"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="line1">Address</Label>
                <Input
                  id="line1"
                  name="line1"
                  value={fields.line1}
                  onChange={(event) => setField("line1", event.target.value)}
                  autoComplete="address-line1"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="line2">Apartment, suite (optional)</Label>
                <Input
                  id="line2"
                  name="line2"
                  value={fields.line2}
                  onChange={(event) => setField("line2", event.target.value)}
                  autoComplete="address-line2"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    name="city"
                    value={fields.city}
                    onChange={(event) => setField("city", event.target.value)}
                    autoComplete="address-level2"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="region">Region</Label>
                  <Input
                    id="region"
                    name="region"
                    value={fields.region}
                    onChange={(event) => setField("region", event.target.value)}
                    autoComplete="address-level1"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="postalCode">Postcode</Label>
                  <Input
                    id="postalCode"
                    name="postalCode"
                    value={fields.postalCode}
                    onChange={(event) =>
                      setField("postalCode", event.target.value)
                    }
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
                  value={fields.countryCode}
                  onChange={(event) =>
                    setField("countryCode", event.target.value)
                  }
                  autoComplete="country"
                  placeholder="US"
                  maxLength={2}
                  required
                />
              </div>

              {editing && selected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => {
                    setFields(toFields(selected));
                    setEditing(false);
                  }}
                >
                  Undo changes
                </Button>
              ) : null}
            </div>
          )}

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

            Asked for outside the collapsed block, always. A phone number is
            optional in the address book and required to deliver, so a saved
            address can arrive here without one — and hiding the field behind
            "Edit for this order" would fail the order at the server with an
            error pointing at a field nobody can see.
          */}
          <div className="grid gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              name="phone"
              value={fields.phone}
              onChange={(event) => setField("phone", event.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01712345678"
              required
            />
            <p className="text-tertiary-text text-xs">
              The courier will call this number to deliver your order.
            </p>
          </div>

          {/*
            Offered last, once there is a whole address to save, and only for a
            new one — a saved address that was corrected for this delivery is
            not a second address worth keeping.
          */}
          {signedIn && enteringNew ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveToAccount}
                onChange={(event) => setSaveToAccount(event.target.checked)}
                className="size-4 accent-accent"
              />
              Save this address to my account
            </label>
          ) : null}
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
