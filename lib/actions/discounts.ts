"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { getCart } from "@/lib/cart";
import { resolveDiscountForCart } from "@/lib/discounts/resolve";
import { getPlatformSettings, shippingFor } from "@/lib/settings";

/**
 * Checking a discount code from the checkout form.
 *
 * The code is evaluated against the server's own view of the cart, never
 * against totals sent by the browser. A client that could name its own
 * subtotal could clear a minimum-spend rule by asking nicely.
 *
 * This only previews the discount. It is claimed for real inside the order
 * transaction, where the redemption counter is incremented conditionally —
 * otherwise two simultaneous checkouts could both take the last use of a
 * limited code.
 */

export type CheckDiscountResult =
  | {
      ok: true;
      code: string;
      label: string;
      amountCents: number;
      shippingDiscountCents: number;
      description: string | null;
    }
  | { ok: false; message: string };

const schema = z.object({
  code: z.string().trim().min(1, "Enter a code").max(60),
  /** Identifies a guest for the per-customer limit. */
  email: z.string().trim().max(200).optional(),
});

export async function checkDiscountAction(
  input: z.input<typeof schema>,
): Promise<CheckDiscountResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const session = await getSession();
  const cart = await getCart();

  if (cart.lines.length === 0) {
    return { ok: false, message: "Your cart is empty." };
  }

  const outcome = await resolveDiscountForCart({
    code: parsed.data.code,
    cart,
    shippingCents: shippingFor(cart.subtotalCents, await getPlatformSettings()),
    userId: session?.user.id ?? null,
    email: session?.user.email ?? parsed.data.email ?? null,
  });

  // Every rejection reads the same way to the caller. Telling somebody a code
  // exists but is not for them turns this form into an oracle for guessing
  // campaign names.
  if (!outcome.ok) return { ok: false, message: outcome.message };

  return {
    ok: true,
    code: outcome.code,
    label: outcome.label,
    amountCents: outcome.amountCents,
    shippingDiscountCents: outcome.shippingDiscountCents,
    description: null,
  };
}
