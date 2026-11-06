/**
 * The platform's settlement currency.
 *
 * This was "USD" as a literal in seventy-two places. It is one constant now
 * because bKash and Nagad settle Bangladeshi taka and nothing else — a price
 * rendered as $756.04 against an intent for ৳756.04 is not a formatting bug,
 * it is a hundred-and-ten-fold underpayment that the webhook's amount check
 * would then reject on every order.
 *
 * BDT's minor unit is the poisha, and there are 100 to the taka, which is the
 * same shape as cents. That is why the switch is a constant and not a
 * migration: every `*_cents` column already holds exactly what Jomma calls
 * `amount`, and `order.totalCents` can be handed to `intents.create` with no
 * conversion, no rate, and no floating point anywhere in the path.
 *
 * Orders placed before the switch keep the currency stored on the row. Nothing
 * here rewrites history — `formatMoney` takes the currency as an argument, so
 * an old USD order still renders as dollars.
 */
export const PLATFORM_CURRENCY = "BDT";

/**
 * The smallest amount an intent may be created for.
 *
 * Jomma matches against real Send Money messages, and a payment below this is
 * not worth a reference code and a fifteen-minute lock on a receiving account.
 */
export const MIN_INTENT_MINOR_UNITS = 100; // ৳1.00

/**
 * Asserts an amount is safe to send as an integer minor-unit value.
 *
 * Rule one of the Jomma integration is that no float ever touches this path.
 * Every amount in this codebase comes from an `integer` column so this should
 * be unreachable — which is exactly why it is worth having. The failure it
 * catches is somebody introducing a rate conversion or a percentage later and
 * producing 75603.99999999999, which would round somewhere unpredictable and
 * leave a buyer permanently one poisha short of settling their order.
 */
export function assertMinorUnits(amount: number, label: string): number {
  if (!Number.isInteger(amount)) {
    throw new Error(
      `${label} must be an integer number of minor units, got ${amount}. ` +
        `Money never becomes a float on the payment path.`,
    );
  }
  if (amount < 0) {
    throw new Error(`${label} must not be negative, got ${amount}.`);
  }
  return amount;
}
