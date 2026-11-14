import { and, eq, inArray, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import type { AddressSnapshot } from "@/lib/db/schema";
import {
  orderItems,
  orders,
  refundRequests,
  stores,
  subOrders,
} from "@/lib/db/schema";
import { orderBelongsTo } from "./ownership";

/**
 * Invoice data.
 *
 * ── This is evidence, so it is held to a different standard ──────────────
 *
 * An invoice is not a summary screen. It gets printed, filed, and produced
 * months later to claim a warranty, return an item, or settle a dispute — and
 * at that point nobody can check it against the database. Every figure on it
 * therefore has to be one the system can still stand behind, and anything the
 * system does not actually know must be absent rather than approximated.
 *
 * Three rules follow, and they shaped everything below:
 *
 *   1. No invented numbers. The order-level discount is not apportioned across
 *      sellers, because no such apportionment exists — sub_orders has no
 *      discount column and recordOrderPaid credits sellers the gross
 *      subtotal + shipping. Splitting it here would print a figure that
 *      reconciles against nothing in the ledger.
 *   2. No invented dates. There is no paid_at column, so no invoice claims a
 *      payment date. It states when the order was placed, which is a fact.
 *   3. Refunds are subtracted, and only approved ones. A document saying
 *      "PAID ৳500" for an order that was refunded is the exact kind of wrong
 *      that surfaces in a dispute, months later, in front of someone who
 *      believes it.
 *
 * ── Why there are two scopes ─────────────────────────────────────────────
 *
 * A buyer's order can span three sellers. The buyer paid once and is owed one
 * document for the whole thing. Each seller supplied part of it, is owed a
 * document for their part, and must not see the rest — the same boundary order
 * notes enforce. The seller query starts from the sub-order and never widens.
 *
 * ── Why an unpaid order still gets one ───────────────────────────────────
 *
 * Because that is what an invoice is. A receipt proves money moved; an invoice
 * requests it, and is most useful before payment. The payment state is printed
 * prominently enough that an unpaid invoice cannot be mistaken for a receipt.
 */

export type PaymentState =
  | "pending"
  | "paid"
  | "partially_fulfilled"
  | "fulfilled"
  | "cancelled"
  | "refunded"
  | "payment_reversed";

export type FulfilmentState =
  | "pending"
  | "accepted"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export type InvoiceLine = {
  productTitle: string;
  variantLabel: string | null;
  /** Printed because a warranty claim is usually made against exactly this. */
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type InvoiceGroup = {
  storeName: string;
  /** The legal entity, where the seller recorded one. Falls back to the name. */
  billingName: string | null;
  billingAddress: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  fulfilment: FulfilmentState;
  lines: InvoiceLine[];
  subtotalCents: number;
  shippingCents: number;
  /** Approved refunds against this shipment. Requested ones do not count. */
  refundedCents: number;
};

export type Invoice = {
  invoiceNumber: string;
  orderNumber: string;
  /** When the order was placed. Never "now" — a reprint is not a new event. */
  placedAt: Date;
  currency: string;
  payment: PaymentState;

  /**
   * The provider's reference for the payment, when there is one.
   *
   * Worth printing: it is the only string that ties this document to a bKash
   * or Nagad transaction, and it is what support will ask for first.
   */
  paymentReference: string | null;

  /**
   * How the buyer was reached. Whichever they gave — an invoice for a
   * phone-only order prints the number, because a document with no way to
   * identify the customer is no use to either side in a dispute.
   */
  buyerEmail: string | null;
  buyerPhone: string | null;
  shippingAddress: AddressSnapshot;
  billingAddress: AddressSnapshot | null;

  groups: InvoiceGroup[];

  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  taxCents: number;
  /** What was charged. On a seller invoice, what this shipment came to. */
  totalCents: number;
  /** Approved refunds within this invoice's scope. */
  refundedCents: number;

  scope: "buyer" | "seller";

  /**
   * Seller invoices only: the parent order carried a discount this document
   * does not show, because there is no per-seller share of it to show.
   *
   * A boolean rather than the amount. The seller needs to know the buyer's
   * total differs from this one; they do not need a figure from which the
   * value of another seller's goods could be worked out.
   */
  parentOrderHadDiscount: boolean;
};

function toLine(item: {
  productTitle: string;
  variantLabel: string | null;
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}): InvoiceLine {
  return {
    productTitle: item.productTitle,
    variantLabel: item.variantLabel,
    sku: item.sku,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    lineTotalCents: item.lineTotalCents,
  };
}

/** Approved refunds per sub-order. Requested and rejected ones are not money. */
async function approvedRefundsBySubOrder(
  subOrderIds: string[],
): Promise<Map<string, number>> {
  if (subOrderIds.length === 0) return new Map();

  const rows = await db
    .select({
      subOrderId: refundRequests.subOrderId,
      total: sum(refundRequests.amountCents),
    })
    .from(refundRequests)
    .where(
      and(
        inArray(refundRequests.subOrderId, subOrderIds),
        eq(refundRequests.status, "approved"),
      ),
    )
    .groupBy(refundRequests.subOrderId);

  // sum() comes back as a string from the driver, because a SQL sum can exceed
  // what a JS number holds. These are minor units in a single order, so Number
  // is safe here in a way it would not be over the whole ledger.
  return new Map(rows.map((row) => [row.subOrderId, Number(row.total ?? 0)]));
}

/**
 * The buyer's invoice: the whole order, grouped by who supplied what.
 *
 * Authorisation mirrors getOrderForBuyer exactly — by account, or by the email
 * the order was placed with so a guest can open theirs from the receipt link.
 * A uuid is not authorisation.
 */
export async function getInvoiceForBuyer(input: {
  orderId: string;
  userId: string | null;
  email?: string;
  phone?: string;
}): Promise<Invoice | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  if (!order) return null;

  if (!orderBelongsTo(order, input)) return null;

  const subs = await db
    .select({
      id: subOrders.id,
      status: subOrders.status,
      subtotalCents: subOrders.subtotalCents,
      shippingCents: subOrders.shippingCents,
      storeName: stores.name,
      billingName: stores.billingName,
      billingAddress: stores.billingAddress,
      supportEmail: stores.supportEmail,
      supportPhone: stores.supportPhone,
    })
    .from(subOrders)
    .innerJoin(stores, eq(stores.id, subOrders.storeId))
    .where(eq(subOrders.orderId, order.id));

  const items = await db
    .select()
    .from(orderItems)
    .innerJoin(subOrders, eq(subOrders.id, orderItems.subOrderId))
    .where(eq(subOrders.orderId, order.id));

  const refunds = await approvedRefundsBySubOrder(subs.map((sub) => sub.id));

  const groups: InvoiceGroup[] = subs.map((sub) => ({
    storeName: sub.storeName,
    billingName: sub.billingName,
    billingAddress: sub.billingAddress,
    supportEmail: sub.supportEmail,
    supportPhone: sub.supportPhone,
    fulfilment: sub.status,
    subtotalCents: sub.subtotalCents,
    shippingCents: sub.shippingCents,
    refundedCents: refunds.get(sub.id) ?? 0,
    lines: items
      .filter((row) => row.order_items.subOrderId === sub.id)
      .map((row) => toLine(row.order_items)),
  }));

  return {
    invoiceNumber: `INV-${order.orderNumber.replace(/^ORD-/, "")}`,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt ?? order.createdAt,
    currency: order.currency,
    payment: order.status,
    paymentReference: order.paymentIntentId,
    buyerEmail: order.email,
    buyerPhone: order.contactPhone,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    groups,
    // Order-level figures, which are exactly what the buyer was charged.
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    refundedCents: [...refunds.values()].reduce((sum, n) => sum + n, 0),
    scope: "buyer",
    parentOrderHadDiscount: false,
  };
}

/**
 * A seller's invoice: one sub-order, and nothing about the rest of the order.
 *
 * The store id is part of the WHERE rather than checked afterwards, so a
 * sub-order id belonging to another shop resolves to null instead of returning
 * data somebody then has to remember to filter.
 *
 * The total is this shipment's subtotal plus its shipping, which is exactly
 * what the ledger credits the seller. It is deliberately NOT the buyer's share
 * of the payment: with an order-level discount the two differ, and no
 * per-seller share of that discount exists to report. `parentOrderHadDiscount`
 * says so on the document rather than leaving the difference unexplained.
 */
export async function getInvoiceForStore(input: {
  subOrderId: string;
  storeId: string;
}): Promise<Invoice | null> {
  const [row] = await db
    .select({
      subId: subOrders.id,
      subStatus: subOrders.status,
      subtotalCents: subOrders.subtotalCents,
      shippingCents: subOrders.shippingCents,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      orderDiscountCents: orders.discountCents,
      paymentIntentId: orders.paymentIntentId,
      currency: orders.currency,
      buyerEmail: orders.email,
      buyerPhone: orders.contactPhone,
      shippingAddress: orders.shippingAddress,
      billingAddress: orders.billingAddress,
      placedAt: orders.placedAt,
      createdAt: orders.createdAt,
      storeName: stores.name,
      billingName: stores.billingName,
      storeBillingAddress: stores.billingAddress,
      supportEmail: stores.supportEmail,
      supportPhone: stores.supportPhone,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .innerJoin(stores, eq(stores.id, subOrders.storeId))
    .where(
      and(
        eq(subOrders.id, input.subOrderId),
        eq(subOrders.storeId, input.storeId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.subOrderId, input.subOrderId));

  const refunds = await approvedRefundsBySubOrder([input.subOrderId]);
  const refundedCents = refunds.get(input.subOrderId) ?? 0;

  return {
    // Suffixed with the sub-order, because two sellers on one order would
    // otherwise both issue a document numbered INV-2026-000123.
    invoiceNumber: `INV-${row.orderNumber.replace(/^ORD-/, "")}-${input.subOrderId.slice(0, 4).toUpperCase()}`,
    orderNumber: row.orderNumber,
    placedAt: row.placedAt ?? row.createdAt,
    currency: row.currency,
    payment: row.orderStatus,
    paymentReference: row.paymentIntentId,
    buyerEmail: row.buyerEmail,
    buyerPhone: row.buyerPhone,
    shippingAddress: row.shippingAddress,
    billingAddress: row.billingAddress,
    groups: [
      {
        storeName: row.storeName,
        billingName: row.billingName,
        billingAddress: row.storeBillingAddress,
        supportEmail: row.supportEmail,
        supportPhone: row.supportPhone,
        fulfilment: row.subStatus,
        lines: items.map(toLine),
        subtotalCents: row.subtotalCents,
        shippingCents: row.shippingCents,
        refundedCents,
      },
    ],
    subtotalCents: row.subtotalCents,
    shippingCents: row.shippingCents,
    // Zero rather than a share of the order's discount, which does not exist.
    discountCents: 0,
    taxCents: 0,
    totalCents: row.subtotalCents + row.shippingCents,
    refundedCents,
    scope: "seller",
    parentOrderHadDiscount: row.orderDiscountCents > 0,
  };
}
