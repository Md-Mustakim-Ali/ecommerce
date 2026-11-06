import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireStorePermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { listOrdersForStore } from "@/lib/orders/queries";
import { OrderRow } from "./order-row";

export const metadata: Metadata = { title: "Orders" };

const TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "New" },
  { value: "accepted", label: "To ship" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type Status = Exclude<(typeof TABS)[number]["value"], "">;

const STATUSES: ReadonlySet<string> = new Set(
  TABS.map((t) => t.value).filter(Boolean),
);

/**
 * The seller's order queue.
 *
 * `order.view` is the only permission required to open it. Each action inside
 * a row checks its own permission separately, so a packer who can ship but not
 * cancel sees the queue with one button rather than a page they cannot open.
 *
 * Filtering is a link, not client state. A seller working through the "to ship"
 * queue can bookmark it and send it to whoever is packing.
 */
export default async function StoreOrdersPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[storeId]/orders">) {
  const { storeId } = await params;
  const query = await searchParams;

  const access = await requireStorePermission(storeId, "order.view");

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true },
  });
  if (!store) notFound();

  const raw = Array.isArray(query.status) ? query.status[0] : query.status;
  const status = raw && STATUSES.has(raw) ? (raw as Status) : undefined;

  const orders = await listOrdersForStore(storeId, status);

  const permissions = {
    accept: access.permissions.has("order.accept"),
    ship: access.permissions.has("order.ship"),
    cancel: access.permissions.has("order.cancel"),
    refund: access.permissions.has("order.refund"),
    note: access.permissions.has("order.note"),
    contact: access.permissions.has("customer.contact"),
  };

  const revenue = orders
    .filter((o) => o.status !== "cancelled" && o.status !== "refunded")
    .reduce((sum, o) => sum + o.payoutCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">Orders</h1>
          <p className="text-secondary-text text-sm">
            {store.name} · {orders.length} shown ·{" "}
            <span className="tabular">
              {formatMoney(revenue, PLATFORM_CURRENCY)}
            </span>{" "}
            to you
          </p>
        </div>
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-sm hover:underline"
        >
          Back to store
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1 border-border border-b pb-2">
        {TABS.map((tab) => {
          const active = (status ?? "") === tab.value;
          return (
            <Link
              key={tab.label}
              href={
                tab.value
                  ? `/dashboard/${storeId}/orders?status=${tab.value}`
                  : `/dashboard/${storeId}/orders`
              }
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 font-medium text-sm ${
                active
                  ? "bg-surface-3 text-primary-text"
                  : "text-secondary-text hover:bg-surface-2"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {orders.length === 0 ? (
        <p className="rounded-md border border-border border-dashed px-4 py-8 text-center text-secondary-text text-sm">
          {status
            ? "Nothing in this queue."
            : "No orders yet. They land here the moment payment clears."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderRow
                storeId={storeId}
                order={{
                  id: order.id,
                  status: order.status,
                  orderNumber: order.orderNumber,
                  buyerEmail: order.buyerEmail,
                  placedAt: order.placedAt?.toISOString() ?? null,
                  subtotalCents: order.subtotalCents,
                  shippingCents: order.shippingCents,
                  payoutCents: order.payoutCents,
                  trackingCarrier: order.trackingCarrier,
                  trackingNumber: order.trackingNumber,
                  shippingAddress: order.shippingAddress,
                  noteCount: order.noteCount,
                  unreadFromBuyer: order.unreadFromBuyer,
                  items: order.items.map((item) => ({
                    id: item.id,
                    productTitle: item.productTitle,
                    variantLabel: item.variantLabel,
                    sku: item.sku,
                    quantity: item.quantity,
                    lineTotalCents: item.lineTotalCents,
                  })),
                }}
                permissions={permissions}
              />
            </li>
          ))}
        </ul>
      )}

      {!Object.values(permissions).some(Boolean) ? (
        <p className="text-tertiary-text text-xs">
          <Badge variant="outline">Read only</Badge> Your role can view orders
          but not act on them.
        </p>
      ) : null}
    </div>
  );
}
