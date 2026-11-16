/**
 * Dates and times, as the shop shows them.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Every date on the site was a bare `toLocaleDateString()` or
 * `toLocaleString()`, which asks the *runtime* for both the locale and the
 * timezone. That is two bugs wearing one coat.
 *
 * The timezone one is a correctness bug, not a cosmetic one. Render's
 * containers run UTC, so an order paid at 11:43 in Dhaka rendered as 5:43 AM,
 * and — worse — anything placed after 18:00 local rendered with the *previous
 * day's* date. On an invoice, that is a document stating the wrong date.
 *
 * It survived because it cannot be reproduced here: every machine that builds
 * this is already on Dhaka time, so the output is right locally and wrong in
 * production. Setting TZ on the server moves the default, but it cannot fix a
 * client component — those render in whatever zone the buyer's browser is in —
 * so a server-rendered date and a client-rendered one would disagree on the
 * same page. Naming the zone is the only thing that makes them agree.
 *
 * The locale one is smaller but real: call sites variously passed `en-GB`,
 * `en-US`, or nothing at all, so the same instant appeared as `9/10/2026` and
 * `10/09/2026` on different pages. Those are different days to a reader, and
 * there is no way to tell which convention a given page used.
 *
 * ── The choices ──────────────────────────────────────────────────────────
 *
 * Asia/Dhaka, fixed. This is a Bangladeshi marketplace: it prices in BDT,
 * takes bKash and Nagad, and validates BD mobile numbers. An order's time is
 * most meaningful in the shop's own zone — that is the clock the seller packs
 * by and the courier delivers on — so rendering a buyer's local time would
 * make two people looking at one order disagree about when it happened.
 *
 * A named month, not a numeric one. `10 Sep 2026` cannot be misread; both
 * `10/09/2026` and `09/10/2026` can, and this shop has readers who use each.
 *
 * 24-hour time, which is what a `৳242.00 at 17:43` receipt should say rather
 * than leaving AM/PM to carry the meaning.
 */

/**
 * The shop's clock.
 *
 * One constant so a future settings-driven timezone has a single place to
 * come from, rather than 25 call sites to find.
 */
export const SHOP_TIME_ZONE = "Asia/Dhaka";

/** Unambiguous to every reader: `10 Sep 2026`. */
const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * `10 September 2026`, for documents.
 *
 * An invoice is filed, printed and occasionally argued over, and the spelled
 * month is what that register calls for. Kept here rather than left inline in
 * the two invoice renderers so they cannot drift from each other — or, as they
 * had, quietly render a UTC date on a document.
 */
const DATE_LONG = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** `10 Sep 2026, 11:43` */
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Accepts what the callers actually hold.
 *
 * Drizzle hands back a `Date` from a server component, while anything that
 * crossed a serialisation boundary — a client component's props, a server
 * action's return — holds the ISO string it became on the way. Both arrive
 * here, and making every call site remember which it has is how one of them
 * ends up calling `.toLocaleString()` on a string.
 */
type When = Date | string | number;

/** Null for anything unparseable, so a bad value shows the em dash. */
function toDate(value: When): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `10 Sep 2026`, or `—` when there is no date to show. */
export function formatDate(value: When | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = toDate(value);
  return date ? DATE.format(date) : "—";
}

/** `10 Sep 2026, 11:43`, or `—`. */
export function formatDateTime(value: When | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : "—";
}

/** `10 September 2026`, or `—`. For invoices and other documents. */
export function formatDateLong(value: When | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = toDate(value);
  return date ? DATE_LONG.format(date) : "—";
}
