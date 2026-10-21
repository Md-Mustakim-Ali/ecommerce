import { CheckCircle2, Package } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSession } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/money/format";
import { getOrderForBuyer } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/orders/[orderId]">) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const session = await getSession();

  const order = await getOrderForBuyer({
    orderId,
    userId: session?.user.id ?? null,
  });
  // notFound rather than a 403: a uuid is not authorisation, and confirming
  // that an order exists but is not yours is a small leak with no upside.
  if (!order) notFound();

  const justPlaced = query.placed === "1";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      {justPlaced ? (
        <div className="flex items-start gap-3 rounded-xl bg-positive-muted p-5 text-positive">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Order placed</p>
            <p className="text-sm opacity-90">
              We have emailed a receipt to {order.email}.
              {order.subOrders.length > 1
                ? ` Your ${order.subOrders.length} sellers each ship their own part, so expect more than one parcel.`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-semibold text-xl tracking-tight">
            {order.orderNumber}
          </h1>
          <p className="text-secondary-text text-sm">
            Placed {order.placedAt?.toLocaleDateString() ?? "—"}
          </p>
        </div>
        <Badge variant={order.status === "paid" ? "positive" : "neutral"}>
          {order.status}
        </Badge>
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
                  {/* Snapshotted at purchase. Never joined to the live product. */}
                  <span className="line-clamp-1">{item.productTitle}</span>
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

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Shipping to</h2>
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
      </section>

      <Button
        variant="outline"
        render={<Link href="/account/orders" />}
        className="self-start"
      >
        All orders
      </Button>
    </div>
  );
}
