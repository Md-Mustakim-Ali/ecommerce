/**
 * Bangladeshi mobile numbers.
 *
 * One rule, in one place, used by two callers that must agree: the checkout
 * validator that decides whether to accept a number, and the payment path that
 * hands it to Jomma. If those two ever disagreed the failure would be silent —
 * checkout would accept a number Jomma then rejects, or worse, quietly
 * normalises differently, and the payment would land against a sender that does
 * not match.
 */

/** 11 digits: 01, an operator prefix of 3–9, then eight more. */
const BD_MOBILE = /^01[3-9]\d{8}$/;

/**
 * Reduces a typed number to the canonical `01XXXXXXXXX`, or null if it is not a
 * Bangladeshi mobile.
 *
 * Null is a real answer, not a failure: a Canadian delivery address has a
 * perfectly good phone number that simply is not this shape, and callers are
 * expected to treat that as "no BD mobile here" rather than "invalid input".
 *
 * Accepts the ways people actually write it — spaces, dashes, brackets, a +880
 * or 880 country prefix — because making a buyer guess our preferred
 * punctuation is not their problem, and a number rejected at checkout is a lost
 * order.
 */
export function normaliseBdMobile(input: string): string | null {
  const digitsOnly = input.replace(/[\s\-().]/g, "");

  // +8801712345678 and 8801712345678 both mean 01712345678. Done before the
  // pattern test so the country-coded form is not rejected for being too long.
  const local = digitsOnly.replace(/^\+?880/, "0");

  return BD_MOBILE.test(local) ? local : null;
}

/**
 * How a number should read on screen.
 *
 * Jomma reports the paying number as `8801771104100`. That is correct and it is
 * not how anybody in Dhaka writes a phone number — and everything the buyer
 * typed is stored as `01771104100`, so an order page showing both forms was
 * inviting the reader to wonder whether they were looking at two numbers or
 * one. They were looking at one.
 *
 * Anything that is not a BD mobile comes back untouched. A foreign sender is
 * still worth showing exactly as it arrived rather than hidden for failing a
 * pattern it was never meant to match.
 */
export function displayPhone(phone: string): string {
  return normaliseBdMobile(phone) ?? phone;
}

/**
 * Whether a phone is acceptable as a delivery number for a given country.
 *
 * Format is only enforced for Bangladesh, which is the one numbering plan this
 * shop can claim to know. Applying that pattern worldwide would reject valid
 * foreign numbers on a marketplace allowed to ship abroad; accepting anything
 * at all would pass "0171" to a courier as though it were a phone number. So
 * BD gets a real check and everywhere else gets "not empty".
 */
export function isDeliverablePhone(
  phone: string,
  countryCode: string,
): boolean {
  const trimmed = phone.trim();
  if (trimmed.length === 0) return false;
  if (countryCode.trim().toUpperCase() !== "BD") return true;
  return normaliseBdMobile(trimmed) !== null;
}
