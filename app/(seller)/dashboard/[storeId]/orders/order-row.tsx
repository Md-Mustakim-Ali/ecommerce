"use client";

import {
  ChevronDown,
  FileText,
  Loader2,
  MessageSquare,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acceptOrderAction,
  cancelOrderAction,
  markDeliveredAction,
  shipOrderAction,
} from "@/lib/actions/fulfilment";
import { requestRefundAction } from "@/lib/actions/refunds";
import { formatDateTime } from "@/lib/datetime/format";
import type { AddressSnapshot } from "@/lib/db/schema";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { displayPhone } from "@/lib/validation/phone";
import { OrderThread } from "./order-thread";

type Item = {
  id: string;
  productTitle: string;
  variantLabel: string | null;
  sku: string | null;
  quantity: number;
  lineTotalCents: number;
};

export type SellerOrder = {
  id: string;
  status:
    | "pending"
    | "accepted"
    | "shipped"
    | "delivered"
    | "cancelled"
    | "refunded";
  orderNumber: string;
  /** One of these is always present; the orders table has a check saying so. */
  buyerEmail: string | null;
  buyerPhone: string | null;
  placedAt: string | null;
  subtotalCents: number;
  shippingCents: number;
  payoutCents: number;
  trackingCarrier: string | null;
  trackingNumber: string | null;
  shippingAddress: AddressSnapshot;
  items: Item[];
  noteCount: number;
  unreadFromBuyer: number;

  /*
    The parent order's own state, which is not this sub-order's.

    `status` above tracks fulfilment of this seller's part. This one carries
    whether the money arrived — and a seller deciding whether to pack something
    needs both. They disagree constantly and legitimately: a sub-order sits
    `pending` while the order says `paid`, and on cash on delivery the order
    stays `pending` for days by design.
  */
  orderStatus: string;
  /** "manual" is cash on delivery; anything else settles through Jomma. */
  paymentMethod: string | null;
  /** When the buyer proved their contact. Null when they never had to. */
  confirmedAt: string | null;
  /** The whole cart, which on a multi-seller order is more than this part. */
  orderTotalCents: number;
  commissionCents: number;

  /*
    Null when the role cannot see payments — withheld by the server rather than
    hidden here, so it never reaches the browser at all.
  */
  receivedCents: number | null;
  outstandingCents: number | null;
  transfers: {
    trxId: string | null;
    senderMsisdn: string | null;
    amountCents: number;
    at: string;
    matchedBy: string;
  }[];
};

const STATUS_BADGE: Record<
  SellerOrder["status"],
  {
    label: string;
    variant: "default" | "muted" | "neutral" | "positive" | "critical";
  }
> = {
  pending: { label: "New", variant: "default" },
  accepted: { label: "To ship", variant: "muted" },
  shipped: { label: "Shipped", variant: "neutral" },
  delivered: { label: "Delivered", variant: "positive" },
  cancelled: { label: "Cancelled", variant: "critical" },
  refunded: { label: "Refunded", variant: "critical" },
};

/**
 * One sub-order in the seller's queue.
 *
 * The row is collapsed by default and shows only what is needed to decide what
 * to do next. Packing details — address, SKUs, line totals — are one click
 * away, because a queue of forty orders each showing a full address is not a
 * queue anyone can work through.
 *
 * Every action's button is gated on the same permission the server action
 * checks. The hiding is a courtesy; the server call is the control.
 */
export function OrderRow({
  storeId,
  order,
  permissions,
}: {
  storeId: string;
  order: SellerOrder;
  permissions: {
    accept: boolean;
    ship: boolean;
    cancel: boolean;
    refund: boolean;
    note: boolean;
    contact: boolean;
    payment: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const badge = STATUS_BADGE[order.status];
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const closed = order.status === "cancelled" || order.status === "refunded";

  /*
    Is it safe to put this in a box?

    The single most useful thing this row was not telling anyone. Cash on
    delivery is collected at the door, so `pending` is its normal state and
    shipping it is correct. A Jomma order sitting `pending` means nobody has
    paid yet, and shipping that is giving away stock. Same word, opposite
    meaning, and until now the seller saw only the word.
  */
  const cashOnDelivery = (order.paymentMethod ?? "manual") === "manual";
  const settled =
    order.orderStatus === "paid" ||
    order.orderStatus === "fulfilled" ||
    order.orderStatus === "partially_fulfilled";
  const awaitingMoney = !cashOnDelivery && !settled;

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setShipping(false);
      setCancelling(false);
      setRefunding(false);
    });
  }

  return (
    <article className="rounded-md border border-border bg-surface-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronDown
            aria-hidden
            className={`size-4 shrink-0 text-tertiary-text transition-transform ${open ? "rotate-180" : ""}`}
          />
          <span className="min-w-0">
            <span className="block font-medium text-sm">
              {order.orderNumber}
            </span>
            <span className="block truncate text-secondary-text text-xs">
              {units} {units === 1 ? "item" : "items"} ·{" "}
              {order.buyerEmail ?? order.buyerPhone}
              {order.placedAt ? ` · ${formatDateTime(order.placedAt)}` : ""}
            </span>
          </span>
        </button>

        {/*
          Visible without expanding, because it changes whether the next action
          is safe. `critical` is not decoration here: shipping an unpaid prepaid
          order is stock leaving for nothing.
        */}
        {awaitingMoney ? (
          <Badge variant="critical" className="gap-1">
            <Wallet aria-hidden className="size-3" />
            Unpaid
          </Badge>
        ) : cashOnDelivery ? (
          <Badge
            variant="outline"
            className="gap-1"
            title="Collect on delivery"
          >
            <Wallet aria-hidden className="size-3" />
            COD
          </Badge>
        ) : null}

        {/*
          An unread buyer message is the one thing here that needs answering,
          so it gets a colour. A count of notes is just context.
        */}
        {order.unreadFromBuyer > 0 ? (
          <Badge variant="default" className="gap-1">
            <MessageSquare aria-hidden className="size-3" />
            {order.unreadFromBuyer}
          </Badge>
        ) : order.noteCount > 0 ? (
          <span
            className="flex items-center gap-1 text-tertiary-text text-xs"
            title={`${order.noteCount} ${order.noteCount === 1 ? "note" : "notes"}`}
          >
            <MessageSquare aria-hidden className="size-3.5" />
            {order.noteCount}
          </span>
        ) : null}

        <span className="tabular text-sm">
          {formatMoney(order.payoutCents, PLATFORM_CURRENCY)}
        </span>
        <Badge variant={badge.variant}>{badge.label}</Badge>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            Always present, whatever the order's state. A seller needs the
            document to put in the parcel before it ships and to attach to a
            warranty query long after, so gating it on "paid" would withhold it
            at both of the moments it is actually wanted.
          */}
          <Button
            size="sm"
            variant="ghost"
            render={
              <Link href={`/dashboard/${storeId}/orders/${order.id}/invoice`} />
            }
          >
            <FileText aria-hidden className="size-3.5" />
            Invoice
          </Button>

          {permissions.accept && order.status === "pending" ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => acceptOrderAction({ storeId, subOrderId: order.id }))
              }
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Accept
            </Button>
          ) : null}

          {permissions.ship &&
          (order.status === "accepted" || order.status === "pending") ? (
            <Button
              size="sm"
              variant={order.status === "accepted" ? "default" : "outline"}
              disabled={pending}
              onClick={() => {
                setShipping((value) => !value);
                setOpen(true);
              }}
            >
              Ship
            </Button>
          ) : null}

          {permissions.ship && order.status === "shipped" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  markDeliveredAction({ storeId, subOrderId: order.id }),
                )
              }
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Mark delivered
            </Button>
          ) : null}

          {/*
            Refunding is asking, not doing. The seller has order.refund; only
            platform.refund.approve moves money, so nothing happens here
            beyond a request being filed.
          */}
          {permissions.refund &&
          (order.status === "shipped" || order.status === "delivered") ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setRefunding((value) => !value);
                setOpen(true);
              }}
            >
              Refund
            </Button>
          ) : null}

          {permissions.cancel &&
          (order.status === "pending" || order.status === "accepted") ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setCancelling((value) => !value);
                setOpen(true);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {order.trackingNumber ? (
        <p className="border-border border-t px-4 py-2 text-secondary-text text-xs">
          {order.trackingCarrier} · {order.trackingNumber}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="px-4 pb-3 text-critical text-sm">
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-4 border-border border-t px-4 py-3">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <ul className="flex flex-col gap-1.5">
              {order.items.map((item) => (
                <li
                  key={item.id}
                  className="flex justify-between gap-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block">
                      {item.quantity} × {item.productTitle}
                    </span>
                    <span className="block text-tertiary-text text-xs">
                      {[item.variantLabel, item.sku]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-secondary-text">
                    {formatMoney(item.lineTotalCents, PLATFORM_CURRENCY)}
                  </span>
                </li>
              ))}
            </ul>

            {/*
              Payment, in full.

              Gated on its own permission: a role that packs parcels needs the
              address and the SKUs, not the number somebody's money came from.
              When the role lacks it the server sends nothing, so there is
              nothing here to hide.

              The amounts are deliberately of the WHOLE order, and labelled so.
              A buyer pays for the cart in one transfer, so on a two-seller
              order both sellers are looking at the same money — what this
              seller is owed out of it is the payout line, which is a different
              question and answered separately below.
            */}
            {permissions.payment ? (
              <section className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium text-sm">Payment</h4>
                  <span className="text-tertiary-text text-xs">
                    {cashOnDelivery
                      ? "Cash on delivery"
                      : `bKash / Nagad · order is ${order.orderStatus}`}
                  </span>
                </div>

                {cashOnDelivery ? (
                  <p className="text-secondary-text text-xs">
                    Collected at the door. Nothing is recorded here until the
                    courier integration reports it, so this order stays
                    <span className="font-medium"> pending</span> even after it
                    is delivered — that is expected, not a fault.
                  </p>
                ) : (
                  <dl className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-secondary-text">
                        Order total (all sellers)
                      </dt>
                      <dd className="tabular">
                        {formatMoney(order.orderTotalCents, PLATFORM_CURRENCY)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-secondary-text">Received</dt>
                      <dd className="tabular">
                        {formatMoney(
                          order.receivedCents ?? 0,
                          PLATFORM_CURRENCY,
                        )}
                      </dd>
                    </div>
                    {order.outstandingCents ? (
                      <div className="flex justify-between gap-3 font-medium text-critical">
                        <dt>Still owed</dt>
                        <dd className="tabular">
                          {formatMoney(
                            order.outstandingCents,
                            PLATFORM_CURRENCY,
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                )}

                {/*
                  Every transfer, with its transaction id. This is the first
                  thing either side reaches for when a payment is disputed, and
                  a seller being asked "I paid, where is my order" previously
                  had nothing to check it against.
                */}
                {order.transfers.length > 0 ? (
                  <ul className="flex flex-col gap-1 border-border border-t pt-2">
                    {order.transfers.map((transfer) => (
                      <li
                        key={`${transfer.trxId ?? "no-trx"}-${transfer.at}`}
                        className="flex flex-wrap justify-between gap-x-3 text-xs"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="font-mono">
                            {transfer.trxId ?? "No transaction id"}
                          </span>
                          <span className="text-tertiary-text">
                            {transfer.senderMsisdn
                              ? `From ${displayPhone(transfer.senderMsisdn)} · `
                              : ""}
                            {formatDateTime(transfer.at)}
                            {transfer.matchedBy !== "automatic"
                              ? ` · matched by ${transfer.matchedBy}`
                              : ""}
                          </span>
                        </span>
                        <span className="tabular shrink-0">
                          {formatMoney(transfer.amountCents, PLATFORM_CURRENCY)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : !cashOnDelivery ? (
                  <p className="border-border border-t pt-2 text-tertiary-text text-xs">
                    No money has arrived for this order yet.
                  </p>
                ) : null}

                {/* What this seller actually earns, kept apart from the above. */}
                <div className="flex justify-between gap-3 border-border border-t pt-2 text-xs">
                  <span className="text-secondary-text">
                    Your payout after{" "}
                    {formatMoney(order.commissionCents, PLATFORM_CURRENCY)}{" "}
                    commission
                  </span>
                  <span className="tabular font-medium">
                    {formatMoney(order.payoutCents, PLATFORM_CURRENCY)}
                  </span>
                </div>
              </section>
            ) : null}

            {/* Formatted as a shipping label, because that is what it is for. */}
            <address className="not-italic text-secondary-text text-xs leading-relaxed sm:text-right">
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
              {order.shippingAddress.phone ? (
                <>
                  <br />
                  {order.shippingAddress.phone}
                </>
              ) : null}
            </address>
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-1 border-border border-t pt-3 text-xs">
            <div className="flex gap-2">
              <dt className="text-tertiary-text">Items</dt>
              <dd className="tabular">
                {formatMoney(order.subtotalCents, PLATFORM_CURRENCY)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-tertiary-text">Shipping</dt>
              <dd className="tabular">
                {formatMoney(order.shippingCents, PLATFORM_CURRENCY)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-tertiary-text">Your payout</dt>
              <dd className="tabular font-medium">
                {formatMoney(order.payoutCents, PLATFORM_CURRENCY)}
              </dd>
            </div>
          </dl>

          {shipping && !closed ? (
            <form
              className="flex flex-wrap items-end gap-3 rounded-md bg-surface-2 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                run(() =>
                  shipOrderAction({
                    storeId,
                    subOrderId: order.id,
                    carrier: String(data.get("carrier") ?? ""),
                    trackingNumber: String(data.get("trackingNumber") ?? ""),
                  }),
                );
              }}
            >
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor={`carrier-${order.id}`}>Carrier</Label>
                <Input
                  id={`carrier-${order.id}`}
                  name="carrier"
                  defaultValue={order.trackingCarrier ?? ""}
                  placeholder="DHL"
                  required
                />
              </div>
              <div className="grid flex-[2] gap-1.5">
                <Label htmlFor={`tracking-${order.id}`}>Tracking number</Label>
                <Input
                  id={`tracking-${order.id}`}
                  name="trackingNumber"
                  defaultValue={order.trackingNumber ?? ""}
                  required
                />
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : null}
                Confirm shipped
              </Button>
            </form>
          ) : null}

          {refunding && !closed ? (
            <form
              className="flex flex-wrap items-end gap-3 rounded-md bg-surface-2 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                run(() =>
                  requestRefundAction({
                    storeId,
                    subOrderId: order.id,
                    amount: String(data.get("amount") ?? ""),
                    reason: String(data.get("reason") ?? ""),
                  }),
                );
              }}
            >
              <div className="grid w-32 gap-1.5">
                <Label htmlFor={`amount-${order.id}`}>Amount</Label>
                <Input
                  id={`amount-${order.id}`}
                  name="amount"
                  inputMode="decimal"
                  placeholder={(
                    (order.subtotalCents + order.shippingCents) /
                    100
                  ).toFixed(2)}
                />
              </div>
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor={`refund-reason-${order.id}`}>Reason</Label>
                <Input
                  id={`refund-reason-${order.id}`}
                  name="reason"
                  placeholder="Arrived damaged"
                  required
                />
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : null}
                Request refund
              </Button>
            </form>
          ) : null}

          {cancelling && !closed ? (
            <form
              className="flex flex-wrap items-end gap-3 rounded-md bg-critical-muted p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                run(() =>
                  cancelOrderAction({
                    storeId,
                    subOrderId: order.id,
                    reason: String(data.get("reason") ?? ""),
                  }),
                );
              }}
            >
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor={`reason-${order.id}`}>
                  Reason (recorded in the audit log)
                </Label>
                <Input
                  id={`reason-${order.id}`}
                  name="reason"
                  placeholder="Out of stock"
                  required
                />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : null}
                Cancel and restock
              </Button>
            </form>
          ) : null}

          {/*
            Rendered on expand, so the thread is fetched for the one order
            being looked at rather than for every row in the queue.
          */}
          <OrderThread
            storeId={storeId}
            subOrderId={order.id}
            buyerContact={order.buyerEmail ?? order.buyerPhone ?? ""}
            buyerHasEmail={order.buyerEmail !== null}
            permissions={{
              note: permissions.note,
              contact: permissions.contact,
            }}
          />
        </div>
      ) : null}
    </article>
  );
}
