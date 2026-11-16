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
 * 12-hour time with AM/PM, because that is how Bangladesh reads a clock. This
 * started as 24-hour on the reasoning that a receipt should not lean on AM/PM
 * to carry its meaning, which was a preference dressed up as an argument — the
 * market writes `11:43 AM`, so the shop writes `11:43 AM`.
 *
 * Uppercase, and that takes a little work. en-GB gives the day-first order
 * Bangladesh uses but renders a lowercase `am`; en-US and en-BD both give the
 * uppercase form and put the month first, which is the wrong way round here.
 * So the parts are assembled by hand: en-GB's ordering, with the day period
 * upcased.
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

/**
 * `10 Sep 2026, 11:43 AM`
 *
 * `hour: "numeric"`, not `"2-digit"`. On a 12-hour clock the padded form reads
 * `05:43 PM`, which nobody writes.
 */
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * A regular no-break space, replacing the narrow one ICU emits.
 *
 * Current ICU separates the time from the meridiem with U+202F NARROW NO-BREAK
 * SPACE. It is the typographically correct character and it is a nuisance:
 * plenty of fonts have no glyph for it, so it lands as a missing-character box
 * or silently nothing, and any code comparing or searching the formatted string
 * has to know to type a character no keyboard produces.
 *
 * U+00A0 keeps the property that actually matters — `11:43` and `AM` never end
 * up on separate lines — with support everywhere.
 */
const NARROW_NO_BREAK = /\u202f/g;

/**
 * en-GB's ordering with an upcased meridiem.
 *
 * Done through `formatToParts` rather than a regex over the finished string,
 * so it upcases the day period and nothing else. A blunt `.toUpperCase()` on
 * the whole thing would shout the month too, and a regex for `/am|pm/` risks
 * matching inside whatever a future locale or month abbreviation contains.
 */
function withUpperMeridiem(formatter: Intl.DateTimeFormat, date: Date): string {
  return formatter
    .formatToParts(date)
    .map((part) =>
      part.type === "dayPeriod" ? part.value.toUpperCase() : part.value,
    )
    .join("")
    .replace(NARROW_NO_BREAK, "\u00a0");
}

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

/** `10 Sep 2026, 11:43 AM`, or `—`. */
export function formatDateTime(value: When | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = toDate(value);
  return date ? withUpperMeridiem(DATE_TIME, date) : "—";
}

/** `10 September 2026`, or `—`. For invoices and other documents. */
export function formatDateLong(value: When | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = toDate(value);
  return date ? DATE_LONG.format(date) : "—";
}
