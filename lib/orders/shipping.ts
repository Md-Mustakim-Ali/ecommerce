/**
 * Flat shipping, for now.
 *
 * A real rate depends on the market, the carrier and the parcel, none of which
 * are decided. These are single constants so there is exactly one place to
 * change when they are, rather than a formula that looks authoritative and is
 * not.
 *
 * Lives outside lib/actions because a `"use server"` module may only export
 * async functions — every export there becomes a callable server endpoint, and
 * a pure calculation has no business being one. The checkout page needs this
 * to render the summary before anything is submitted.
 */

const FLAT_SHIPPING_CENTS = 599;
const FREE_SHIPPING_THRESHOLD_CENTS = 7500;

export function shippingFor(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : FLAT_SHIPPING_CENTS;
}
