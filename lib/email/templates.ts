// Relative for the same reason as lib/email/index.ts: the auth CLI loads this
// chain through jiti, which has no path aliases.
import { env } from "../env";
import { formatMoney } from "../money/format";
import { orderPath } from "../orders/access";
import type { EmailMessage } from "./provider";

/**
 * The transactional messages.
 *
 * Plain HTML, inline styles, tables for layout. Email clients are twenty years
 * behind browsers and Outlook still uses Word to render — a stylesheet, a flex
 * container or a modern selector all silently do nothing there. This looks
 * archaic because the medium is.
 *
 * Every message is also written as text, and the text version is written
 * first. If a message only makes sense with the markup, it is the wrong
 * message: screen readers, watch notifications and spam filters all read the
 * text part.
 *
 * No tracking pixels, no click-wrapped links. A receipt does not need to know
 * whether it was opened.
 */

const BRAND = "Marketplace";

function baseUrl(): string {
  return env.BETTER_AUTH_URL.replace(/\/$/, "");
}

/** Wraps body HTML in the one layout every message shares. */
function shell(heading: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(heading)}</title></head>
<body style="margin:0;padding:24px;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#161b22;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:12px;padding:32px;">
<tr><td>
<p style="margin:0 0 24px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#6b7683;">${BRAND}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;">${html(heading)}</h1>
${body}
</td></tr></table>
<p style="margin:20px 0 0;font-size:12px;color:#6b7683;">You are receiving this because of activity on your ${BRAND} account.</p>
</td></tr></table>
</body></html>`;
}

/**
 * HTML-escapes an interpolated value.
 *
 * Named `html` rather than `escape` because the global `escape` is a
 * deprecated URL-encoder — shadowing it invites someone to assume this does
 * that instead, and these strings are seller-supplied product titles going
 * into markup.
 */
function html(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0 0;"><a href="${html(href)}" style="display:inline-block;background:#161b22;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500;">${html(label)}</a></p>`;
}

// ---------------------------------------------------------------------------

export type OrderLine = {
  title: string;
  variantLabel: string | null;
  quantity: number;
  lineTotalCents: number;
};

/**
 * Asks a guest to prove the contact they checked out with.
 *
 * The order exists but is `unconfirmed` and invisible to the seller until this
 * link is followed. That is the point: on a cash-on-delivery marketplace a
 * fabricated address costs the seller a parcel and a return, and a guest
 * checkout is a stranger typing one.
 *
 * The link lands on the order itself, signed, so following it both confirms
 * the order and gives them somewhere to look at it — with no account, ever.
 * Nothing here suggests registering: somebody who wants an account can make
 * one, and that is its own flow with its own verification.
 */
export function confirmOrderRequest(input: {
  to: string;
  orderNumber: string;
  currency: string;
  totalCents: number;
  url: string;
  /** The typed alternative to the button. See lib/orders/confirmation.ts. */
  code: string;
  /** Whether confirming leads straight to a payment page. */
  paysOnline: boolean;
}): EmailMessage {
  const total = formatMoney(input.totalCents, input.currency);

  /*
    What happens after they confirm, said plainly.

    A buyer paying by bKash is about to be sent to a payment page, and one
    paying on delivery is not. Telling them which avoids the worst reading of
    "confirm your order" — that confirming is itself the payment.
  */
  const next = input.paysOnline
    ? "Confirming takes you straight to the bKash or Nagad payment page."
    : "Confirming is all we need — you pay when it arrives.";

  /*
    The deadline, stated because it is enforced.

    An unpaid order is swept after a day: the stock goes back on sale and the
    order stops existing. A buyer who is told that can act on it; one who is
    not simply finds their order gone and assumes we lost it.
  */
  const deadline = input.paysOnline
    ? "You have 24 hours to confirm and pay. After that the order is cancelled, nothing is charged, and the items go back on sale."
    : "You have 24 hours to confirm. After that the order is cancelled and the items go back on sale.";

  return {
    to: input.to,
    subject: `Confirm your order ${input.orderNumber}`,
    text: [
      `Almost done — order ${input.orderNumber} needs confirming.`,
      "",
      `Total: ${total}`,
      "",
      `Your confirmation code: ${input.code}`,
      "",
      "Enter that code on the checkout page, or open this link — either one works:",
      input.url,
      "",
      next,
      "",
      deadline,
      "",
      "If you did not place this order, ignore this — nothing happens without it.",
    ].join("\n"),
    html: shell(
      "Confirm your order",
      `<p style="margin:0 0 8px;font-size:15px;">Order <strong>${html(input.orderNumber)}</strong> is waiting on you.</p>
<p style="margin:0 0 16px;font-size:15px;">Total ${total}</p>
<p style="margin:0 0 8px;font-size:14px;color:#3f4750;">Your confirmation code</p>
<p style="margin:0 0 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#101418;">${html(input.code)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#3f4750;">Enter it on the checkout page, or use the button — either one works.</p>
${button(input.url, "Confirm my order")}
<p style="margin:16px 0 0;font-size:13px;color:#6b7683;">${html(next)}</p>
<p style="margin:12px 0 0;font-size:13px;color:#6b7683;">${html(deadline)}</p>
<p style="margin:12px 0 0;font-size:13px;color:#6b7683;">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;color:#3f4750;">${html(input.url)}</span></p>
<p style="margin:12px 0 0;font-size:13px;color:#6b7683;">If you did not place this order, ignore this; nothing happens without it.</p>`,
    ),
    replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM,
  };
}

/**
 * Sent the moment an order is placed, before any money has moved.
 *
 * Distinct from orderConfirmation, which means "we have your payment". Both
 * exist because on this platform they are usually days apart: `manual` — pay
 * on delivery or bank transfer — is the default method and the common one
 * here, so an order sits pending while the buyer arranges payment.
 *
 * Without this the buyer had nothing. The order link is signed for this order
 * (see lib/orders/access.ts), and until now the only copy of it was the
 * confirmation page shown once after checkout: close that tab and a guest had
 * no way back to their own order, and no email would arrive until payment.
 *
 * It deliberately does not mention accounts. A guest who wants one can make
 * one, and that is its own flow with its own verification — pushing somebody
 * to register in the middle of a purchase they have already completed is how
 * a receipt turns into marketing.
 */
export function orderPlaced(input: {
  to: string;
  orderNumber: string;
  orderId: string;
  currency: string;
  totalCents: number;
  /** Whether the buyer still has to send money, which changes what to say. */
  settlesOffline: boolean;
}): EmailMessage {
  const url = `${baseUrl()}${orderPath(input.orderId)}`;

  const next = input.settlesOffline
    ? "We will confirm your payment before dispatch. Nothing else is needed from you right now."
    : "We are checking your payment now. This page updates by itself once it clears.";

  return {
    to: input.to,
    subject: `We have your order ${input.orderNumber}`,
    text: [
      `Thanks — order ${input.orderNumber} is placed.`,
      "",
      `Total: ${formatMoney(input.totalCents, input.currency)}`,
      "",
      next,
      "",
      `Check its status any time: ${url}`,
      "",
      "Keep this link. It opens your order without signing in.",
    ].join("\n"),
    html: shell(
      `We have your order`,
      `<p style="margin:0 0 8px;font-size:15px;">Order <strong>${html(input.orderNumber)}</strong> is placed.</p>
<p style="margin:0 0 16px;font-size:15px;">Total ${formatMoney(input.totalCents, input.currency)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#3f4750;">${html(next)}</p>
${button(url, "Check your order")}
<p style="margin:16px 0 0;font-size:13px;color:#6b7683;">Keep this link — it opens your order without signing in.</p>`,
    ),
    replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM,
  };
}

export function orderConfirmation(input: {
  to: string;
  orderNumber: string;
  orderId: string;
  currency: string;
  totalCents: number;
  lines: OrderLine[];
  storeCount: number;
}): EmailMessage {
  const url = `${baseUrl()}${orderPath(input.orderId)}`;

  const rows = input.lines
    .map(
      (line) =>
        `<tr><td style="padding:8px 0;font-size:14px;">${html(line.title)}${
          line.variantLabel
            ? ` <span style="color:#6b7683;">${html(line.variantLabel)}</span>`
            : ""
        } <span style="color:#6b7683;">× ${line.quantity}</span></td>
        <td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;">${formatMoney(line.lineTotalCents, input.currency)}</td></tr>`,
    )
    .join("");

  // Stated up front, because a shopper who ordered from three sellers and
  // receives one parcel will otherwise assume the rest is missing.
  const split =
    input.storeCount > 1
      ? `Your order comes from ${input.storeCount} sellers, so expect more than one parcel.`
      : "";

  return {
    to: input.to,
    subject: `Order ${input.orderNumber} confirmed`,
    text: [
      `Order ${input.orderNumber} confirmed.`,
      "",
      ...input.lines.map(
        (line) =>
          `  ${line.quantity} × ${line.title}${line.variantLabel ? ` (${line.variantLabel})` : ""} — ${formatMoney(line.lineTotalCents, input.currency)}`,
      ),
      "",
      `Total: ${formatMoney(input.totalCents, input.currency)}`,
      split ? `\n${split}` : "",
      "",
      `Track it: ${url}`,
    ]
      .filter(Boolean)
      .join("\n"),
    html: shell(
      `Order ${html(input.orderNumber)} confirmed`,
      `${split ? `<p style="margin:0 0 16px;font-size:14px;color:#3f4750;">${html(split)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e6e9ee;margin-top:8px;">
${rows}
<tr><td style="padding:12px 0 0;border-top:1px solid #e6e9ee;font-size:15px;font-weight:600;">Total</td>
<td align="right" style="padding:12px 0 0;border-top:1px solid #e6e9ee;font-size:15px;font-weight:600;">${formatMoney(input.totalCents, input.currency)}</td></tr>
</table>
${button(url, "View your order")}`,
    ),
    replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM,
  };
}

export function shipmentNotice(input: {
  to: string;
  orderNumber: string;
  orderId: string;
  storeName: string;
  carrier: string | null;
  trackingNumber: string | null;
}): EmailMessage {
  const url = `${baseUrl()}${orderPath(input.orderId)}`;
  const tracking =
    input.carrier && input.trackingNumber
      ? `${input.carrier} ${input.trackingNumber}`
      : null;

  return {
    to: input.to,
    subject: `Your ${input.storeName} parcel is on its way`,
    text: [
      `${input.storeName} has shipped your part of order ${input.orderNumber}.`,
      tracking ? `\nTracking: ${tracking}` : "",
      "",
      `Details: ${url}`,
    ]
      .filter(Boolean)
      .join("\n"),
    html: shell(
      `${html(input.storeName)} has shipped your parcel`,
      `<p style="margin:0;font-size:14px;color:#3f4750;">Part of order ${html(input.orderNumber)}.</p>
${tracking ? `<p style="margin:16px 0 0;font-size:14px;">Tracking: <strong style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${html(tracking)}</strong></p>` : ""}
${button(url, "Track your order")}`,
    ),
    replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM,
  };
}

export function payoutNotice(input: {
  to: string;
  storeName: string;
  amountCents: number;
  currency: string;
  reference: string;
}): EmailMessage {
  const url = `${baseUrl()}/dashboard`;

  return {
    to: input.to,
    subject: `${formatMoney(input.amountCents, input.currency)} paid out to ${input.storeName}`,
    text: [
      `${formatMoney(input.amountCents, input.currency)} has been sent to ${input.storeName}.`,
      "",
      `Reference: ${input.reference}`,
      "",
      // The reference is what a seller quotes when the money has not arrived,
      // so it goes in the body rather than only in the dashboard.
      `Payouts: ${url}`,
    ].join("\n"),
    html: shell(
      `${formatMoney(input.amountCents, input.currency)} on its way to ${html(input.storeName)}`,
      `<p style="margin:0;font-size:14px;color:#3f4750;">Reference <strong style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${html(input.reference)}</strong>. Quote this if it does not arrive.</p>
${button(url, "Open your dashboard")}`,
    ),
    replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM,
  };
}

export function buyerMessageNotice(input: {
  to: string;
  storeName: string;
  orderNumber: string;
  orderId: string;
  body: string;
}): EmailMessage {
  const url = `${baseUrl()}${orderPath(input.orderId)}`;
  // Quoted, but the reply happens on the site — replying to this address would
  // reach a mailbox nobody watches, and threading it back onto the order is
  // what makes the conversation useful later.
  return {
    to: input.to,
    subject: `${input.storeName} replied about order ${input.orderNumber}`,
    text: [
      `${input.storeName} wrote:`,
      "",
      input.body,
      "",
      `Reply on the site: ${url}`,
    ].join("\n"),
    html: shell(
      `${html(input.storeName)} replied`,
      `<p style="margin:0 0 4px;font-size:13px;color:#6b7683;">About order ${html(input.orderNumber)}</p>
<blockquote style="margin:12px 0 0;padding:12px 16px;background:#f5f7fa;border-radius:8px;font-size:14px;white-space:pre-wrap;">${html(input.body)}</blockquote>
${button(url, "Reply on the site")}`,
    ),
    replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM,
  };
}

export function verifyEmail(input: { to: string; url: string }): EmailMessage {
  return {
    to: input.to,
    subject: `Confirm your ${BRAND} email`,
    text: [
      `Confirm your email address to finish setting up your ${BRAND} account.`,
      "",
      input.url,
      "",
      "If you did not sign up, ignore this — no account is created without it.",
    ].join("\n"),
    html: shell(
      "Confirm your email",
      `<p style="margin:0;font-size:14px;color:#3f4750;">One click and your account is ready.</p>
${button(input.url, "Confirm email")}
<p style="margin:20px 0 0;font-size:13px;color:#6b7683;">If you did not sign up, ignore this. No account is created without it.</p>`,
    ),
  };
}

export function resetPassword(input: {
  to: string;
  url: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: `Reset your ${BRAND} password`,
    text: [
      "Use this link to set a new password:",
      "",
      input.url,
      "",
      // Said explicitly, because a reset email nobody asked for is alarming
      // and the natural reaction — clicking to check — is the wrong one.
      "If you did not ask for this, ignore it. Your password has not changed.",
    ].join("\n"),
    html: shell(
      "Reset your password",
      `<p style="margin:0;font-size:14px;color:#3f4750;">This link works once, and expires shortly.</p>
${button(input.url, "Set a new password")}
<p style="margin:20px 0 0;font-size:13px;color:#6b7683;">If you did not ask for this, ignore it. Your password has not changed.</p>`,
    ),
  };
}
