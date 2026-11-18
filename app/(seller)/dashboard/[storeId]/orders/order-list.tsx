import type { listOrdersForStore } from "@/lib/orders/queries";
import { OrderRow } from "./order-row";

/**
 * A seller's orders, rendered the one way there is to render them.
 *
 * Extracted when the customers page needed the same list. Copying the mapping
 * would have been quicker and would have gone wrong the first time either side
 * changed — and one of the fields being mapped decides whether payment records
 * reach the browser, which is not a thing to keep two copies of.
 *
 * Takes an already-fetched list rather than fetching, because the two callers
 * ask different questions of the same query: the queue filters by status, the
 * customer page filters by sub-order id. Both go through listOrdersForStore, so
 * the store scoping is applied once, in SQL, where it cannot be forgotten.
 */

export type SellerOrderPermissions = {
  accept: boolean;
  ship: boolean;
  cancel: boolean;
  refund: boolean;
  note: boolean;
  contact: boolean;
  payment: boolean;
};

type Orders = Awaited<ReturnType<typeof listOrdersForStore>>;

export function SellerOrderList({
  storeId,
  orders,
  permissions,
}: {
  storeId: string;
  orders: Orders;
  permissions: SellerOrderPermissions;
}) {
  return (
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
              buyerPhone: order.buyerPhone,
              placedAt: order.placedAt?.toISOString() ?? null,
              subtotalCents: order.subtotalCents,
              shippingCents: order.shippingCents,
              payoutCents: order.payoutCents,
              trackingCarrier: order.trackingCarrier,
              trackingNumber: order.trackingNumber,
              shippingAddress: order.shippingAddress,
              noteCount: order.noteCount,
              unreadFromBuyer: order.unreadFromBuyer,
              orderStatus: order.orderStatus,
              paymentMethod: order.paymentMethod,
              confirmedAt: order.confirmedAt?.toISOString() ?? null,
              orderTotalCents: order.orderTotalCents,
              commissionCents: order.commissionCents,
              /*
                Withheld here, not hidden in the component. A role without
                order.payment.view never receives these values, so they cannot
                be read out of the page source — which is the difference
                between a permission and a CSS class.
              */
              receivedCents: permissions.payment ? order.receivedCents : null,
              outstandingCents: permissions.payment
                ? order.outstandingCents
                : null,
              transfers: permissions.payment
                ? order.transfers.map((transfer) => ({
                    trxId: transfer.trxId,
                    senderMsisdn: transfer.senderMsisdn,
                    amountCents: transfer.amountCents,
                    at: (
                      transfer.occurredAt ?? transfer.appliedAt
                    ).toISOString(),
                    matchedBy: transfer.matchedBy,
                  }))
                : [],
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
  );
}
