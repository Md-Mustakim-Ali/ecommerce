/**
 * Money formatting.
 *
 * Input is always integer minor units. The division by 100 happens here, at
 * the very last moment before display, and nowhere else — every calculation
 * upstream stays in integers.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, locale: string) {
  const key = `${locale}:${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      // narrowSymbol, so BDT renders as ৳756.04 rather than "BDT 756.04".
      // The default for taka is the code, which reads like a bank statement
      // rather than a price. This is also why the switch to BDT did not need a
      // locale change: bn-BD would give ৭৫৬.০৪৳ in Bengali numerals, which is
      // not how prices are written on Bangladeshi storefronts.
      //
      // Safe for the currencies already in the database — narrowSymbol still
      // gives $756.04 for the USD orders placed before the switch.
      currencyDisplay: "narrowSymbol",
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

export function formatMoney(
  cents: number | bigint,
  currency: string,
  locale = "en",
): string {
  const value = typeof cents === "bigint" ? Number(cents) : cents;
  return formatterFor(currency, locale).format(value / 100);
}

/** Zero-decimal currencies exist, but none are in use yet. Revisit with the market. */
export function minorUnitsPerMajor(_currency: string): number {
  return 100;
}
