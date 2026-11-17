import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { emailIsConfigured, sendEmail } from "@/lib/email";
import { sendOrderPlaced } from "@/lib/email/notify";
import { confirmOrderRequest } from "@/lib/email/templates";
import { log } from "@/lib/observability/logger";
import { coverageForOrder } from "@/lib/payments/jomma/coverage";
import { releaseOrderStock } from "@/lib/payments/jomma/release";
import { isMobileMoney, type PaymentMethod } from "@/lib/payments/methods";
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

/**
 * How long an unproved order survives at all.
 *
 * Measured from checkout. Miss it and the order is deleted outright — see the
 * sweep at the bottom of this file.
 */
export const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a proved order stays payable.
 *
 * Measured from `confirmedAt`, not from checkout, because those can be far
 * apart: somebody who orders at midnight and reads their email at noon has not
 * spent half their window asleep.
 */
export const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

/** How many digits a buyer has to copy out of an email. */
const CODE_DIGITS = 6;

/**
 * The same proof, short enough to type.
 *
 * The link and the code are deliberately two spellings of one fact — that
 * whoever holds them received the message. A buyer whose mail client mangles
 * the button, or who is reading email on a different device from the one they
 * checked out on, needs the code; everyone else clicks.
 *
 * Derived rather than stored, like the token, so a resent email carries the
 * code the first one did and nothing has to be cleaned up when an order
 * expires. Six digits is guessable in a way a 32-character token is not, so it
 * is the one credential here that must be rate limited — see the `order-code`
 * bucket, keyed on the order.
 */
export function orderConfirmCode(orderId: string): string {
  const digest = createHmac("sha256", secret())
    .update(`order-code:${orderId}`)
    .digest();

  // A fixed slice, so the value is stable for the life of the order.
  return (digest.readUInt32BE(0) % 10 ** CODE_DIGITS)
    .toString()
    .padStart(CODE_DIGITS, "0");
}

/**
 * Constant-time, and forgiving about how it was typed.
 *
 * People paste codes with spaces in them, and a buyer who typed the right
 * digits should not be told they are wrong because their mail client inserted
 * a hyphen.
 */
export function verifyOrderConfirmCode(
  orderId: string,
  code: string | undefined | null,
): boolean {
  if (!code) return false;
  const cleaned = code.replace(/\D/g, "");
  const expected = Buffer.from(orderConfirmCode(orderId));
  const given = Buffer.from(cleaned);
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
      paymentMethod: orders.paymentMethod,
      paymentIntentId: orders.paymentIntentId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return;

  const url = `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")}/api/orders/confirm?id=${order.id}&t=${signOrderConfirm(order.id)}`;
  const code = orderConfirmCode(order.id);

  // Whether confirming leads to a payment page or straight to "we are packing
  // it". The email says which, so "confirm your order" cannot be read as
  // meaning the order is already paid for.
  const method = (order.paymentMethod ??
    (order.paymentIntentId?.startsWith("int_")
      ? "any"
      : "manual")) as PaymentMethod;
  const paysOnline = isMobileMoney(method);

  if (order.email && emailAvailable()) {
    await sendEmail(
      confirmOrderRequest({
        to: order.email,
        orderNumber: order.orderNumber,
        currency: order.currency,
        totalCents: order.totalCents,
        url,
        code,
        paysOnline,
      }),
    );
    return;
  }

  if (order.contactPhone && phoneAvailable()) {
    // The code first: on a phone, typing six digits back into the page beats
    // following a link out of an SMS into a different browser than the one the
    // checkout is open in.
    await sendSms({
      to: order.contactPhone,
      body: `${code} is your code for order ${order.orderNumber}. Or open: ${url} — expires in 24 hours.`,
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
  credential: { token?: string | null; code?: string | null },
): Promise<ConfirmResult> {
  /*
    Either proof is enough, and neither is stronger than the other.

    They carry the same claim — that this person received the message sent to
    the contact on the order — so accepting one and not the other would only
    punish whoever's mail client ate the button. The code is the guessable one,
    so its call site rate limits before reaching here.
  */
  const proved =
    verifyOrderConfirm(orderId, credential.token) ||
    verifyOrderConfirmCode(orderId, credential.code);

  if (!proved) return { ok: false, reason: "bad-token" };

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

    // `confirmedAt` starts the payment window. Written here, in the same
    // transaction as the status flip, so an order can never be pending without
    // a clock on it.
    await tx
      .update(orders)
      .set({ status: "pending", confirmedAt: new Date() })
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
 * Takes back what nobody ever finished paying for.
 *
 * ── Now the only thing that expires an order ─────────────────────────────
 *
 * Jomma's `payment.expired` webhook used to release stock the moment an intent
 * timed out, about fifteen minutes in. That is a payment window closing, not a
 * buyer giving up, and it made it impossible to offer them a way back. It now
 * only logs; this is the single authority, and it gives an order a full day.
 *
 * Two shapes of abandonment, and they are not the same:
 *
 *   - **Unconfirmed.** A contact that was never proved. Nothing was paid and
 *     nothing can have been, so releasing is unambiguous.
 *   - **Confirmed, prepay, never paid.** They proved their email, opened the
 *     pay page, and stopped. The stock is released and the order closes, which
 *     is what the buyer was told would happen.
 *
 * ── The case that is deliberately NOT swept ──────────────────────────────
 *
 * A prepay order that received *something* and then went quiet. Releasing it
 * would hand the stock back while still holding the buyer's money, turning an
 * unfinished payment into a silent debt with no record anyone would find. It is
 * logged for a person instead. That is rarer and worth a human.
 *
 * Cash on delivery is never swept at all: `pending` is its normal resting state
 * until a courier is paid, so a day of it means nothing has gone wrong.
 */
export async function expireUnconfirmedOrders(
  now: Date = new Date(),
): Promise<{ purged: number; closed: number; holdingMoney: number }> {
  const purged = await purgeUnproved(
    new Date(now.getTime() - CONFIRMATION_TTL_MS),
  );
  const closed = await closeUnpaid(new Date(now.getTime() - PAYMENT_WINDOW_MS));

  if (purged > 0 || closed.closed > 0) {
    log.info("abandoned orders swept", {
      purged,
      closed: closed.closed,
      holdingMoney: closed.holdingMoney,
    });
  }

  return { purged, closed: closed.closed, holdingMoney: closed.holdingMoney };
}

/**
 * Never proved, so it never happened.
 *
 * Deleted rather than cancelled, and that is the deliberate difference between
 * the two halves of this sweep. Nothing was proved, nothing was paid, and
 * nobody ever demonstrated they were a real person — keeping a cancelled row
 * for every abandoned checkout would fill the order history with the output of
 * anyone who felt like filling out a form. There is no trace, because there is
 * nothing worth tracing.
 *
 * Everything hanging off the order cascades: sub-orders and their items,
 * discount redemptions, and any Jomma rows. Stock is released first, through
 * the same path everything else uses, so the arithmetic lives in one place.
 */
async function purgeUnproved(deadline: Date): Promise<number> {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(eq(orders.status, "unconfirmed"), lt(orders.createdAt, deadline)),
    )
    .limit(200);

  let purged = 0;
  for (const order of stale) {
    await releaseOrderStock(order.id, "expired");
    await db.delete(orders).where(eq(orders.id, order.id));
    purged += 1;
  }
  return purged;
}

/**
 * Proved, then never paid. The stock goes back; the order stays.
 *
 * The opposite call to the one above, for the opposite reason. This buyer did
 * prove their contact, so the order is a real thing that really happened to a
 * real person — they are entitled to open it later and see what they sent, and
 * to have it appear in their history if they ever make an account with that
 * address. What they lose is the ability to keep paying: `cancelled` is not a
 * payable status, and resumePayment checks the window besides.
 *
 * A part-paid order is swept exactly like an unpaid one, with a loud log. It
 * would be worse to hold stock indefinitely against money that may never be
 * completed, and refunds here are handled by a person out of band — so the
 * useful thing this can do is put the goods back on sale and make sure the
 * amount held is written down somewhere a human will find it.
 *
 * Cash on delivery is never swept: `pending` is its resting state until a
 * courier is paid, so a day of it means nothing has gone wrong.
 */
async function closeUnpaid(
  deadline: Date,
): Promise<{ closed: number; holdingMoney: number }> {
  const stale = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      paymentMethod: orders.paymentMethod,
      paymentIntentId: orders.paymentIntentId,
      confirmedAt: orders.confirmedAt,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.status, "pending"))
    .limit(200);

  let closed = 0;
  let holdingMoney = 0;

  for (const order of stale) {
    // Dated from confirmation, so the query above cannot filter on it —
    // `confirmedAt` is null for orders that were never gated.
    if ((order.confirmedAt ?? order.createdAt) > deadline) continue;

    const method = (order.paymentMethod ??
      (order.paymentIntentId?.startsWith("int_")
        ? "any"
        : "manual")) as PaymentMethod;
    if (!isMobileMoney(method)) continue;

    const coverage = await coverageForOrder(order.id);
    if (coverage.covered) continue; // Paid; the settle just has not landed yet.

    if (coverage.receivedCents > 0) {
      holdingMoney += 1;
      log.warn("closing an order that holds a part payment", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        received: coverage.receivedCents,
        total: coverage.totalCents,
        refundOwed: coverage.receivedCents,
      });
    }

    const released = await releaseOrderStock(order.id, "expired");
    if (released.released) closed += 1;
  }

  return { closed, holdingMoney };
}
