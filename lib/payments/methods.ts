/**
 * The payment methods checkout can offer.
 *
 * In its own module rather than beside the action that uses it, because
 * lib/actions/checkout.ts carries "use server" and such a file may export only
 * async functions — exporting this array from there compiles fine and then
 * fails the production build with "a 'use server' file can only export async
 * functions, found object". A type export would have been erased and survived;
 * a const is not.
 *
 * `manual` is the pre-existing offline settlement: the buyer pays by cash on
 * delivery or bank transfer and an admin confirms it. `bkash` and `nagad` both
 * route through Jomma. `any` lets Jomma's hosted pay page pick whichever
 * receiving account is healthy at that moment.
 */
export const paymentMethods = ["manual", "bkash", "nagad", "any"] as const;

export type PaymentMethod = (typeof paymentMethods)[number];

/** Whether this method settles through Jomma rather than offline. */
export function isMobileMoney(method: PaymentMethod): boolean {
  return method !== "manual";
}
