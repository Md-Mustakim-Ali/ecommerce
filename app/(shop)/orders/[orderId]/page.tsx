import {
  CheckCircle2,
  FileText,
  Mail,
  Package,
  Phone,
  Receipt,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSession } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime/format";
import { formatMoney } from "@/lib/money/format";
import { withAccessToken } from "@/lib/orders/access";
import {
  getAppliedPaymentsForOrder,
  getOrderForBuyer,
} from "@/lib/orders/queries";
import { displayPhone } from "@/lib/validation/phone";
import { DemoPayButton } from "./demo-pay";
import { MessageThread } from "./message-thread";
import { PaymentStatus } from "./payment-status";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/orders/[orderId]">) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const session = await getSession();

  // A guest arrives with no session and nothing this page could ask them for,
  // so the receipt link and the redirect out of checkout carry a token signed
  // for this order. Without it, guest checkout has no confirmation page at all.
  // It is also handed to the two client components below, whose server actions
  // are a second request and so start again with no session of their own.
  const accessToken = typeof query.t === "string" ? query.t : undefined;

  const order = await getOrderForBuyer({
    orderId,
    userId: session?.user.id ?? null,
    accessToken,
  });
  // notFound rather than a 403: a uuid is not authorisation, and confirming
  // that an order exists but is not yours is a small leak with no upside.
  if (!order) notFound();

  const justPlaced = query.placed === "1";

  /*
    Whether to watch this order's payment.

    Not keyed on `?awaiting=1` any more, and that is the point. The query string
    is set by Jomma's returnUrl, so an order the buyer reached any other way —
    from their order list, from the emailed link, or after closing the tab and
    coming back — used to get no waiting card at all and no way to find out it
    had settled. The condition that matters is the order's own state, not how
    the buyer happened to arrive.

    `int_` distinguishes a real Jomma intent from the `manual_` ids the offline
    provider writes into the same column; polling Jomma about one of those would
    only ever 404.
  */
  const watchPayment =
    order.status === "pending" && order.paymentIntentId?.startsWith("int_");

  // Every transfer Jomma applied. More than one is a split payment.
  const appliedPayments = await getAppliedPaymentsForOrder(order.id);

  /*
    The number the money actually came from.

    Jomma prefills the checkout phone on its pay page and then lets the buyer
    say "use a different number", so this is routinely not the contact on the
    order — it is whichever handset bKash was open on. That makes it the one
    detail neither side can reconstruct later, and the first thing both reach
    for when a payment is disputed.

    One intent takes one sending number, but it can take several transfers from
    it, so the same number appears once per transfer. Deduplicated for that —
    not because a split can arrive from two handsets. Normalised because Jomma
    reports `8801771104100` where the rest of this page says `01771104100`.
  */
  const payingNumbers = [
    ...new Set(
      appliedPayments
        .map((payment) => payment.senderMsisdn)
        .filter((msisdn): msisdn is string => Boolean(msisdn))
        .map(displayPhone),
    ),
  ];

  /*
    What the transfers add up to, against what the order costs.

    A split payment is the case this exists for: Jomma keeps one intent open
    across several transfers, so the buyer who sends half now and half later is
    doing something supported, not something broken. Listing the transfers
    without reconciling them left the buyer to add up their own payments to
    find out whether they still owed anything — and a shortfall is precisely
    when they need to be told, because the order does not ship until it is
    covered.

    Both directions matter. Over is not a rounding curiosity: it is money of
    theirs we are holding, and saying so on the order is the difference between
    a refund we offer and one they have to chase.
  */
  const receivedCents = appliedPayments.reduce(
    (total, payment) => total + payment.amountCents,
    0,
  );
  const shortfallCents = Math.max(0, order.totalCents - receivedCents);
  const excessCents = Math.max(0, receivedCents - order.totalCents);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      {watchPayment ? (
        <PaymentStatus
          orderId={order.id}
          currency={order.currency}
          initialTotalCents={order.totalCents}
          accessToken={accessToken}
        />
      ) : null}

      {/*
        Read from the order's own status rather than from `?placed=1`.

        The first attempt at this put a "check your email" panel in the
        checkout form's client state, which was wrong in a way that only showed
        up on the live site: placing an order empties the cart, so the checkout
        page re-renders, finds nothing in it, and replaces the whole form with
        "Nothing to check out". The buyer finished checkout and was told their
        cart was empty. Driving it from the status means the message survives a
        refresh and is still here when they come back to the link.
      */}
      {order.status === "unconfirmed" ? (
        <div className="flex items-start gap-3 rounded-xl bg-accent-muted p-5">
          <Mail
            className="mt-0.5 size-5 shrink-0 text-accent-text"
            aria-hidden
          />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-accent-text">
              One more click and it is yours
            </p>
            <p className="text-secondary-text text-sm">
              We sent a confirmation link
              {order.email ? (
                <>
                  {" "}
                  to <span className="font-medium">{order.email}</span>
                </>
              ) : null}
              . Open it and we will start packing. Your items are held for 24
              hours, and nothing has been charged.
            </p>
          </div>
        </div>
      ) : justPlaced ? (
        <div className="flex items-start gap-3 rounded-xl bg-positive-muted p-5 text-positive">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Order placed</p>
            <p className="text-sm opacity-90">
              {order.email
                ? `We have emailed a receipt to ${order.email}.`
                : "Keep this page's link — it opens your order any time."}
              {order.subOrders.length > 1
                ? ` Your ${order.subOrders.length} sellers each ship their own part, so expect more than one parcel.`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* Only while it is still pending, and only outside production. */}
      {order.status === "pending" && process.env.NODE_ENV !== "production" ? (
        <DemoPayButton
          orderId={order.id}
          totalLabel={formatMoney(order.totalCents, order.currency)}
          accessToken={accessToken}
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-semibold text-xl tracking-tight">
            {order.orderNumber}
          </h1>
          <p className="text-secondary-text text-sm">
            {/* The time, not just the date. "Placed 10 Sep" is not enough to
                find an order by on a day somebody bought twice, and it was the
                half that made the timezone bug invisible. */}
            Placed {formatDateTime(order.placedAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={order.status === "paid" ? "positive" : "neutral"}>
            {order.status}
          </Badge>
          {/*
            Offered whatever the order's state. An unpaid invoice is the normal
            thing to want before paying by transfer, and the document itself
            says which it is rather than relying on this button to gate it.
          */}
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                href={withAccessToken(
                  `/orders/${order.id}/invoice`,
                  accessToken,
                )}
              />
            }
          >
            <FileText aria-hidden className="size-4" />
            Invoice
          </Button>
        </div>
      </div>

      {/*
        One card per store. This is the split made visible: one payment, one
        fulfilment per seller, each tracked separately.
      */}
      {order.subOrders.map((sub) => (
        <section
          key={sub.id}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-tertiary-text" aria-hidden />
              <span className="font-medium text-sm">{sub.storeName}</span>
            </div>
            <Badge
              variant={sub.status === "delivered" ? "positive" : "neutral"}
            >
              {sub.status}
            </Badge>
          </div>

          <ul className="flex flex-col gap-3">
            {sub.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0">
                  {/*
                    The title is snapshotted at purchase and never read from the
                    live product — a rename must not change what this order says
                    it was. The link is a separate matter: it is navigation, and
                    it is null whenever the product or its store is no longer
                    active, so an archived product renders as plain text rather
                    than as a link to a 404.
                  */}
                  {item.productSlug ? (
                    <Link
                      href={`/p/${item.productSlug}`}
                      className="line-clamp-1 hover:underline"
                    >
                      {item.productTitle}
                    </Link>
                  ) : (
                    <span className="line-clamp-1">{item.productTitle}</span>
                  )}
                  <span className="text-tertiary-text text-xs">
                    {item.variantLabel ? `${item.variantLabel} · ` : ""}
                    Qty {item.quantity}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </span>
                </span>
                <span className="tabular shrink-0">
                  {formatMoney(item.lineTotalCents, order.currency)}
                </span>
              </li>
            ))}
          </ul>

          {sub.trackingNumber ? (
            <p className="text-secondary-text text-sm">
              {sub.trackingCarrier}{" "}
              <span className="font-mono">{sub.trackingNumber}</span>
            </p>
          ) : null}

          {/*
            Signed-in buyers only. A guest has no account to attribute a reply
            to, and threading messages onto an email address is how you end up
            showing one person's conversation to whoever guessed it.
          */}
          {session ? (
            <MessageThread
              subOrderId={sub.id}
              storeName={sub.storeName}
              messages={sub.messages.map((message) => ({
                id: message.id,
                authorRole: message.authorRole,
                authorName: message.authorName,
                body: message.body,
                createdAt: message.createdAt.toISOString(),
              }))}
            />
          ) : null}
        </section>
      ))}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="font-medium text-sm">Summary</h2>
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-secondary-text">Subtotal</dt>
            <dd className="tabular">
              {formatMoney(order.subtotalCents, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-secondary-text">Shipping</dt>
            <dd className="tabular">
              {order.shippingCents === 0
                ? "Free"
                : formatMoney(order.shippingCents, order.currency)}
            </dd>
          </div>
        </dl>
        <Separator />
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="tabular font-semibold text-lg">
            {formatMoney(order.totalCents, order.currency)}
          </span>
        </div>
      </section>

      {/*
        What actually paid for this.

        Rendered as a list because a payment is not always one transfer. Somebody
        who sends part of the total and tops it up later produces two, each with
        its own TrxID and its own amount — Jomma holds the one intent open and
        applies both. Showing only the last one would hide half of what the
        buyer sent, and the TrxID is the first thing either side reaches for
        when a payment is disputed.
      */}
      {appliedPayments.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
          <div className="flex items-center gap-2">
            <Receipt className="size-4 text-tertiary-text" aria-hidden />
            <h2 className="font-medium text-sm">
              {appliedPayments.length > 1
                ? `Payment · ${appliedPayments.length} transfers`
                : "Payment"}
            </h2>
          </div>

          <ul className="flex flex-col gap-3">
            {appliedPayments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-xs">
                    {payment.trxId ?? "No transaction id"}
                  </span>
                  <span className="text-tertiary-text text-xs">
                    {payment.senderMsisdn
                      ? `From ${displayPhone(payment.senderMsisdn)} · `
                      : ""}
                    {formatDateTime(payment.occurredAt ?? payment.appliedAt)}
                    {/* `manual` and `admin` mean a human resolved this rather
                        than the matcher, which is worth saying plainly. */}
                    {payment.matchedBy !== "automatic"
                      ? ` · matched by ${payment.matchedBy}`
                      : ""}
                  </span>
                </span>
                <span className="tabular shrink-0">
                  {formatMoney(payment.amountCents, order.currency)}
                </span>
              </li>
            ))}
          </ul>

          {/*
            Shown for a split, and for anything that does not add up to the
            total. A single transfer covering the order exactly needs no
            summary — it is the line directly above.
          */}
          {appliedPayments.length > 1 ||
          shortfallCents > 0 ||
          excessCents > 0 ? (
            <>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-secondary-text">
                  Total received
                  {appliedPayments.length > 1
                    ? ` · ${appliedPayments.length} transfers`
                    : ""}
                </span>
                <span className="tabular font-medium">
                  {formatMoney(receivedCents, order.currency)}
                </span>
              </div>

              {shortfallCents > 0 ? (
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Still to pay</span>
                  <span className="tabular font-semibold">
                    {formatMoney(shortfallCents, order.currency)}
                  </span>
                </div>
              ) : null}

              {/*
                Deliberately worded as a debt of ours. "Overpaid" alone reads
                like a mistake the buyer made; what it actually describes is
                money of theirs that we are holding.
              */}
              {excessCents > 0 ? (
                <div className="flex justify-between text-sm text-positive">
                  <span className="font-medium">We owe you back</span>
                  <span className="tabular font-semibold">
                    {formatMoney(excessCents, order.currency)}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {/*
        Order details.

        Was a lone "Shipping to" block, which left the buyer unable to see the
        contact the order was actually placed against — the email a receipt was
        sent to, or the number a courier will ring. That matters most to the
        guest who typed it minutes ago and wants to check they got it right,
        and it is the same answer for a signed-in buyer, whose account address
        is not necessarily the one this order carries.
      */}
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="font-medium text-sm">Details</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2 text-sm">
            <h3 className="text-tertiary-text text-xs uppercase tracking-wide">
              Contact
            </h3>
            {/*
              Every row labelled. The icons carry the meaning at a glance, but
              "another Bangladeshi mobile number" is genuinely ambiguous without
              a word next to it — the whole point of showing the paying number
              is that it is a *different* number from the contact one.
            */}
            <dl className="flex flex-col gap-2 text-secondary-text">
              {/* An order carries an email, a phone, or both — the schema's
                  check constraint requires at least one, never neither. */}
              {order.email ? (
                <DetailRow icon={<Mail aria-hidden className="size-4" />}>
                  <dt className="text-tertiary-text text-xs">Email</dt>
                  <dd className="break-words">{order.email}</dd>
                </DetailRow>
              ) : null}

              {order.contactPhone ? (
                <DetailRow icon={<Phone aria-hidden className="size-4" />}>
                  <dt className="text-tertiary-text text-xs">Phone</dt>
                  <dd>{displayPhone(order.contactPhone)}</dd>
                </DetailRow>
              ) : null}

              {/*
                One row, however many transfers, because an intent takes one
                sending number — a split is several amounts from that same
                number, not several handsets. Still rendered from the list
                rather than `[0]`: if two ever did appear, showing one of them
                under a confident label would be the worst of both.
              */}
              {payingNumbers.length > 0 ? (
                <DetailRow icon={<Wallet aria-hidden className="size-4" />}>
                  <dt className="text-tertiary-text text-xs">Paid from</dt>
                  {payingNumbers.map((msisdn) => (
                    <dd key={msisdn}>{msisdn}</dd>
                  ))}
                </DetailRow>
              ) : null}
            </dl>
            {order.shippingAddress.phone &&
            order.shippingAddress.phone !== order.contactPhone ? (
              <p className="text-tertiary-text text-xs">
                Delivery number {displayPhone(order.shippingAddress.phone)}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <h3 className="text-tertiary-text text-xs uppercase tracking-wide">
              Shipping to
            </h3>
            <address className="text-secondary-text not-italic">
              {order.shippingAddress.recipientName}
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? (
                <>
                  <br />
                  {order.shippingAddress.line2}
                </>
              ) : null}
              <br />
              {order.shippingAddress.city}
              {order.shippingAddress.region
                ? `, ${order.shippingAddress.region}`
                : ""}{" "}
              {order.shippingAddress.postalCode}
              <br />
              {order.shippingAddress.countryCode}
            </address>
          </div>
        </div>
      </section>

      {/*
        Only for somebody who has an order list to go to.

        A guest has no account, so this sent them to a page that redirects to
        sign-in — an invitation to leave the one page that can show them their
        order, since the token that authorises it is in this URL and nowhere
        else. They get the shop instead.
      */}
      {session ? (
        <Button
          variant="outline"
          render={<Link href="/account/orders" />}
          className="self-start"
        >
          All orders
        </Button>
      ) : (
        <Button
          variant="outline"
          render={<Link href="/" />}
          className="self-start"
        >
          Continue shopping
        </Button>
      )}
    </div>
  );
}

/**
 * A labelled line in the Details section.
 *
 * The icon is decorative — the `<dt>` beside it is what a screen reader
 * announces, so the row is not "an icon, then a number with no indication of
 * which number it is". That matters most on the paying number, whose entire
 * reason for being on the page is that it differs from the contact one.
 */
function DetailRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-tertiary-text">{icon}</span>
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  );
}
