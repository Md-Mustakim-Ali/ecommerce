import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { emailIsConfigured, sendEmail } from "@/lib/email";
import { sendOrderPlaced } from "@/lib/email/notify";
import { confirmOrderRequest } from "@/lib/email/templates";
import { log } from "@/lib/observability/logger";
import { releaseOrderStock } from "@/lib/payments/jomma/release";
import { sendSms, smsIsConfigured } from "@/lib/sms";
import { orderPath, signOrderAccess } from "./access";

/**
 * Proving a guest gave a contact they actually hold.
 *
 * A guest checkout is a stranger typing an address and a phone number, and on
 * a cash-on-delivery marketplace a fabricated one costs the seller a parcel
 * and a return. So the order is written `unconfirmed` and only becomes real
 * when the buyer follows a link sent to the contact they claimed.
 *
 * ── Channel-agnostic on purpose ──────────────────────────────────────────
 *
 * Which channel is used is decided by what the order carries and what is
 * actually configured, never hard-coded. Today that means email, because
 * lib/sms has only the console adapter. The day a real SMS gateway is added,
 * `smsIsConfigured()` flips and phone-only guests start being gated too —
 * with no change here.
 *
 * ── What is NOT gated ────────────────────────────────────────────────────
 *
 * A signed-in buyer whose contact is already verified. They proved it once;
 * making them prove it per order would be theatre.
 *
 * And a contact nobody can verify. If an order has only a phone and there is
 * no SMS gateway, gating it would mean the buyer can never complete an order
 * at all — so it is confirmed on the spot. Refusing to sell to somebody
 * because *we* have not finished building something is the worse failure.
 */

/** How long an unconfirmed order holds its stock before the sweep takes it. */
export const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Distinct from the access token, and deliberately so.
 *
 * Viewing an order and confirming one are different powers. If they shared a
 * token, every receipt link ever sent — which is a link people forward — would
 * also be able to confirm an order.
 */
export function signOrderConfirm(orderId: string): string {
  return createHmac("sha256", secret())
    .update(`order-confirm:${orderId}`)
    .digest("base64url")
    .slice(0, 32);
}

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) {
    throw new Error("BETTER_AUTH_SECRET is required to confirm orders.");
  }
  return value;
}

export function verifyOrderConfirm(
  orderId: string,
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  const expected = Buffer.from(signOrderConfirm(orderId));
  const given = Buffer.from(token);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Whether this order has to be proved before it counts.
 *
 * `buyerVerified` is the caller's answer to "is this a signed-in buyer whose
 * contact is already confirmed", passed in rather than looked up so this stays
 * a pure decision.
 */
export function needsConfirmation(input: {
  email: string | null;
  contactPhone: string | null;
  buyerVerified: boolean;
}): boolean {
  if (input.buyerVerified) return false;
  return canVerify(input.email, input.contactPhone);
}

/**
 * Whether a channel can actually deliver, decided in ONE place.
 *
 * Both the "should this order be gated" question and the "send the link"
 * routine ask these, and they must agree. When they did not, the gate held an
 * order that nothing then sent a link for — the buyer was left waiting on an
 * email that was never going to arrive, which is the worst possible outcome of
 * a feature meant to build trust.
 *
 * Development counts, mirroring phoneAuthAvailable(): the console adapters
 * print to the terminal, which is a real delivery to whoever is running the
 * server, and both refuse outright in production.
 */
function emailAvailable(): boolean {
  return emailIsConfigured() || process.env.NODE_ENV !== "production";
}

function phoneAvailable(): boolean {
  return smsIsConfigured() || process.env.NODE_ENV !== "production";
}

/** Whether any available channel could actually reach this order's contact. */
function canVerify(email: string | null, phone: string | null): boolean {
  if (email && emailAvailable()) return true;
  if (phone && phoneAvailable()) return true;
  return false;
}

/**
 * Sends the "confirm your order" link down whichever channel is available.
 *
 * Email is preferred when present because a link is richer than an SMS and
 * costs nothing to send. A phone-only order goes by SMS once a gateway exists.
 */
export async function sendConfirmationRequest(orderId: string): Promise<void> {
  const [order] = await db
    .select({
      id: orders.id,
      email: orders.email,
      contactPhone: orders.contactPhone,
      orderNumber: orders.orderNumber,
      totalCents: orders.totalCents,
      currency: orders.currency,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return;

  const url = `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")}/api/orders/confirm?id=${order.id}&t=${signOrderConfirm(order.id)}`;

  if (order.email && emailAvailable()) {
    await sendEmail(
      confirmOrderRequest({
        to: order.email,
        orderNumber: order.orderNumber,
        currency: order.currency,
        totalCents: order.totalCents,
        url,
      }),
    );
    return;
  }

  if (order.contactPhone && phoneAvailable()) {
    await sendSms({
      to: order.contactPhone,
      body: `Confirm order ${order.orderNumber}: ${url}`,
    });
  }
}

export type ConfirmResult =
  | { ok: true; orderId: string; alreadyConfirmed: boolean }
  | { ok: false; reason: "bad-token" | "not-found" | "expired" };

/**
 * Turns an unconfirmed order into a real one.
 *
 * The status flip is guarded inside a transaction with the row locked, so two
 * clicks on the same link cannot both "confirm" — the second sees `pending`
 * and reports it as already done rather than as a failure, because from the
 * buyer's side it is.
 */
export async function confirmOrder(
  orderId: string,
  token: string | undefined,
): Promise<ConfirmResult> {
  if (!verifyOrderConfirm(orderId, token)) {
    return { ok: false, reason: "bad-token" };
  }

  const result = await flipToPending(orderId);

  // Outside the transaction, and only the first time. This is the "we have
  // your order" note with the link that opens it later — the confirmation
  // page they are about to land on is not something they can find again.
  if (result.ok && !result.alreadyConfirmed) {
    await sendOrderPlaced(orderId, true);
  }

  return result;
}

async function flipToPending(orderId: string): Promise<ConfirmResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    if (!order) return { ok: false as const, reason: "not-found" as const };

    if (order.status !== "unconfirmed") {
      // Already confirmed, or paid, or cancelled. A buyer clicking twice is
      // not an error, and a cancelled order says so on the page they land on.
      return { ok: true as const, orderId, alreadyConfirmed: true };
    }

    if (Date.now() - order.createdAt.getTime() > CONFIRMATION_TTL_MS) {
      return { ok: false as const, reason: "expired" as const };
    }

    await tx
      .update(orders)
      .set({ status: "pending" })
      .where(eq(orders.id, orderId));

    return { ok: true as const, orderId, alreadyConfirmed: false };
  });
}

/** Where to send the buyer once their order is real. */
export function confirmedPath(orderId: string): string {
  return `${orderPath(orderId)}&placed=1`;
}

export { signOrderAccess };

/**
 * Releases orders nobody ever confirmed.
 *
 * Without this an abandoned checkout holds its stock forever, and a bored
 * person with a script holds all of it. Mirrors what Jomma's TTL does for
 * unpaid orders, and reuses the same release path so the stock arithmetic
 * lives in exactly one place.
 */
export async function expireUnconfirmedOrders(
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "unconfirmed"),
        lt(orders.createdAt, new Date(now.getTime() - CONFIRMATION_TTL_MS)),
      ),
    )
    .limit(200);

  let expired = 0;
  for (const order of stale) {
    const released = await releaseOrderStock(order.id, "expired");
    if (released.released) expired += 1;
  }

  if (expired > 0) log.info("unconfirmed orders expired", { count: expired });
  return { expired };
}
