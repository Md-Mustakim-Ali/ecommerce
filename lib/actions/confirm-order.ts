"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { confirmedPath, confirmOrder } from "@/lib/orders/confirmation";
import { resumePayment } from "@/lib/payments/jomma/resume";
import { checkRateLimit } from "@/lib/ratelimit";

/**
 * Confirming an order with the code from the email, rather than the link.
 *
 * The two are equal proof and reach the same place — see confirmOrder. This is
 * the path for a buyer whose mail client swallowed the button, or who is
 * reading email on their phone while the checkout is open on a laptop, which
 * on this marketplace is most of them.
 *
 * Ownership is not checked here, and that is not an oversight: knowing the code
 * *is* the proof. Anyone holding it received the message sent to the contact on
 * the order, which is the only thing confirming is meant to establish. What
 * matters instead is that the code cannot be found by guessing, which is what
 * the rate limit below is for.
 */

export type ConfirmCodeResult =
  | { ok: true; redirectUrl?: string; path: string }
  | { ok: false; message: string };

const schema = z.object({
  orderId: z.uuid(),
  // Trimmed and stripped of separators before comparison, because people paste
  // codes with spaces in them and a buyer who typed the right digits should not
  // be told they are wrong.
  code: z.string().trim().min(4).max(16),
});

export async function confirmOrderWithCodeAction(
  input: z.input<typeof schema>,
): Promise<ConfirmCodeResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter the 6-digit code from your email." };
  }
  const { orderId, code } = parsed.data;

  /*
    Keyed on the order, not the caller.

    Six digits is a million possibilities, which is plenty against a person and
    nothing against a script. Limiting by IP would limit the wrong thing — an
    attacker working on one order can rotate addresses freely, while a buyer on
    a shared mobile network cannot. The order is the thing being defended, so
    the order is what carries the budget.
  */
  const limit = await checkRateLimit("order-code", orderId);
  if (!limit.ok) return { ok: false, message: limit.message };

  const confirmed = await confirmOrder(orderId, { code });

  if (!confirmed.ok) {
    // Deliberately vague about which of the two it was. "No such order" and
    // "wrong code" are the same answer to anyone who should not be here.
    if (confirmed.reason === "expired") {
      return {
        ok: false,
        message:
          "This order expired before it was confirmed. Nothing was charged — please place it again.",
      };
    }
    return { ok: false, message: "That code is not right. Check your email." };
  }

  /*
    Straight on to paying, exactly as the emailed link does.

    Confirming and paying are one journey for a buyer who chose bKash, and
    stopping to say "confirmed!" in between would be a step that exists only
    because the code was typed rather than clicked.
  */
  const resumed = await resumePayment(confirmed.orderId);

  revalidatePath(`/orders/${confirmed.orderId}`);
  revalidatePath("/account/orders");

  return {
    ok: true,
    redirectUrl: resumed.kind === "pay" ? resumed.payUrl : undefined,
    path: confirmedPath(confirmed.orderId),
  };
}
