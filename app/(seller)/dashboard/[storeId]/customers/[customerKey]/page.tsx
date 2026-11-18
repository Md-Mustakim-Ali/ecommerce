import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getStoreAccess } from "@/lib/auth/access";
import { formatDate } from "@/lib/datetime/format";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { customerLabel, parseCustomerKey } from "@/lib/orders/customer-key";
import {
  listCustomersForStore,
  subOrderIdsForCustomer,
} from "@/lib/orders/customers";
import { listOrdersForStore } from "@/lib/orders/queries";
import { displayPhone } from "@/lib/validation/phone";
import { SellerOrderList } from "../../orders/order-list";

export const metadata: Metadata = { title: "Customer" };

/**
 * One customer's history with this store.
 *
 * The orders are rendered by the same component the queue uses, so everything
 * a seller can see and do there they can see and do here — payment records
 * behind their own permission, accept and ship behind theirs. A second, subtly
 * different rendering of an order is how one of them ends up missing a check.
 *
 * The store boundary is applied twice on purpose. subOrderIdsForCustomer
 * filters on store_id, and listOrdersForStore filters on it again. Neither
 * relies on the other being right, because the failure is a seller reading
 * another seller's sales.
 */
export default async function CustomerPage({
  params,
}: PageProps<"/dashboard/[storeId]/customers/[customerKey]">) {
  const { storeId, customerKey } = await params;

  const access = await getStoreAccess(storeId);
  if (!access || access.membershipStatus === "none") notFound();
  if (!access.permissions.has("customer.view")) notFound();

  // The key arrives from a URL, so it arrives from anyone. A malformed one is
  // not an error page — it is simply not a customer.
  const parsed = parseCustomerKey(decodeURIComponent(customerKey));
  if (!parsed) notFound();

  const subOrderIds = await subOrderIdsForCustomer(storeId, parsed);
  if (subOrderIds.length === 0) notFound();

  const [orders, everyone] = await Promise.all([
    listOrdersForStore(storeId, undefined, subOrderIds),
    listCustomersForStore(storeId, 500),
  ]);

  const customer = everyone.find((entry) => entry.key === customerKey);
  if (!customer) notFound();

  const permissions = {
    accept: access.permissions.has("order.accept"),
    ship: access.permissions.has("order.ship"),
    cancel: access.permissions.has("order.cancel"),
    refund: access.permissions.has("order.refund"),
    note: access.permissions.has("order.note"),
    contact: access.permissions.has("customer.contact"),
    payment: access.permissions.has("order.payment.view"),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/dashboard/${storeId}/customers`} />}
        >
          <ArrowLeft aria-hidden className="size-4" />
          All customers
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-lg tracking-tight">
              {customerLabel(customer)}
            </h1>
            <p className="text-secondary-text text-sm">
              {[
                customer.email,
                customer.contactPhone
                  ? displayPhone(customer.contactPhone)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "No contact on file"}
            </p>
          </div>
          <Badge variant={customer.buyerId ? "neutral" : "outline"}>
            {customer.buyerId ? "Has an account" : "Guest"}
          </Badge>
        </div>

        <dl className="grid gap-4 border-border border-t pt-3 sm:grid-cols-3">
          <div>
            <dt className="text-tertiary-text text-xs">Orders with you</dt>
            <dd className="font-medium text-sm">{customer.orderCount}</dd>
          </div>
          <div>
            <dt className="text-tertiary-text text-xs">Spent with you</dt>
            <dd className="tabular font-medium text-sm">
              {formatMoney(customer.spentCents, PLATFORM_CURRENCY)}
            </dd>
          </div>
          <div>
            <dt className="text-tertiary-text text-xs">First ordered</dt>
            <dd className="font-medium text-sm">
              {formatDate(customer.firstOrderAt)}
            </dd>
          </div>
        </dl>

        {/*
          Said plainly rather than left to be inferred. A seller looking at
          "1 order" for somebody they know has bought repeatedly will otherwise
          assume the page is broken, when what has happened is that the rest of
          the cart belonged to other sellers.
        */}
        <p className="text-tertiary-text text-xs">
          Counts and totals cover this store only. If their order also included
          other sellers, that part is theirs to see, not yours.
          {customer.buyerId
            ? ""
            : " This buyer has no account, so orders they placed with a different email or phone are not joined up here."}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/*
          Says when it is showing fewer than it counted.

          subOrderIdsForCustomer caps at 100. Without this the heading counted
          one number and the list showed another, which reads as data missing
          rather than a page limit — and a seller chasing a specific old order
          would conclude it had been deleted.
        */}
        <h2 className="font-medium text-sm">
          {orders.length < customer.orderCount
            ? `Most recent ${orders.length} of ${customer.orderCount} orders`
            : `${orders.length} ${orders.length === 1 ? "order" : "orders"}`}
        </h2>
        <SellerOrderList
          storeId={storeId}
          orders={orders}
          permissions={permissions}
        />
      </div>
    </div>
  );
}
