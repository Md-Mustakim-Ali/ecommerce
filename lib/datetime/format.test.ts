import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, SHOP_TIME_ZONE } from "./format";

/**
 * These assert Dhaka time explicitly, which is the whole point: the bug they
 * pin cannot be reproduced on any machine that builds this project, because
 * those are all already on Dhaka time. Render is not, and that is where every
 * timestamp was six hours wrong. Run this file under `TZ=UTC` and it still
 * passes — that is the guarantee.
 *
 * The month is matched as `Sep\w*` on purpose. ICU renders en-GB September as
 * "Sep" or "Sept" depending on its CLDR version, so asserting either exact
 * string would turn a Node upgrade into a failing test about nothing. What
 * must hold is the day, the year and the time.
 */

/** 11:43 in Dhaka on 10 September 2026 — the real payment on ORD-2026-000015. */
const PAID = new Date("2026-09-10T05:43:00.000Z");

describe("formatDateTime", () => {
  it("renders an instant in the shop's zone, not the runtime's", () => {
    expect(formatDateTime(PAID)).toMatch(/^10 Sep\w* 2026, 11:43\u00a0AM$/);
  });

  /**
   * The case that makes this a correctness bug rather than a cosmetic one.
   * 00:30 Dhaka is 18:30 UTC the day BEFORE, so a UTC render moved the date
   * backwards for every order placed after six in the evening.
   *
   * It doubles as the midnight check for the 12-hour clock, where the hour
   * after midnight is 12 AM and not 0 AM.
   */
  it("keeps the date on the right side of midnight", () => {
    // 00:30 on 11 September in Dhaka.
    expect(formatDateTime(new Date("2026-09-10T18:30:00.000Z"))).toMatch(
      /^11 Sep\w* 2026, 12:30\u00a0AM$/,
    );
    // 23:59 on 10 September in Dhaka.
    expect(formatDateTime(new Date("2026-09-10T17:59:00.000Z"))).toMatch(
      /^10 Sep\w* 2026, 11:59\u00a0PM$/,
    );
  });

  it("reads the clock the way Bangladesh does: 12-hour, uppercase AM/PM", () => {
    // 17:00 Dhaka.
    expect(formatDateTime(new Date("2026-09-10T11:00:00.000Z"))).toMatch(
      /\b5:00\u00a0PM$/,
    );
    // Never a lowercase meridiem — en-GB's default, which this overrides.
    expect(formatDateTime(PAID)).not.toMatch(/\b(am|pm)\b/);
  });

  /** Noon is the other end of the trap midnight sets: 12 PM, not 0 PM. */
  it("gets noon right", () => {
    expect(formatDateTime(new Date("2026-09-10T06:00:00.000Z"))).toMatch(
      /12:00\u00a0PM$/,
    );
  });

  /** A single-digit hour is not padded — nobody writes `05:43 PM`. */
  it("does not zero-pad the hour", () => {
    expect(formatDateTime(new Date("2026-09-10T11:00:00.000Z"))).not.toMatch(
      /05:00/,
    );
  });

  /**
   * ICU puts U+202F NARROW NO-BREAK SPACE before the meridiem. Plenty of fonts
   * have no glyph for it, so it renders as a missing-character box or nothing
   * at all, and no keyboard types it — which makes every later comparison
   * against a formatted string a quiet trap. U+00A0 keeps the one property
   * that matters, that `11:43` and `AM` never split across a line.
   */
  it("uses a no-break space the fonts actually have", () => {
    const formatted = formatDateTime(PAID);
    expect(formatted).not.toContain("\u202f");
    expect(formatted).toContain("\u00a0");
    // And not a plain space, which would let the meridiem wrap onto its own line.
    expect(formatted).not.toMatch(/\d AM/);
  });
});

describe("formatDate", () => {
  it("names the month, so it cannot be read as the day", () => {
    expect(formatDate(PAID)).toMatch(/^10 Sep\w* 2026$/);
  });

  it("agrees with formatDateTime about which day it is", () => {
    const evening = new Date("2026-09-10T18:30:00.000Z");
    expect(formatDate(evening)).toMatch(/^11 Sep\w* 2026$/);
    expect(formatDateTime(evening)).toMatch(/^11 Sep\w* 2026,/);
  });
});

describe("missing and malformed values", () => {
  // Order columns are nullable — `placedAt` is null until an order is placed —
  // and every call site was writing its own `?? "—"` before this.
  it("shows an em dash rather than 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatDateTime(new Date("nope"))).toBe("—");
  });

  /**
   * Anything that crossed a serialisation boundary arrives as a string. A
   * client component receiving `createdAt` through props holds the ISO form,
   * never a Date.
   */
  it("accepts the ISO string a serialised date becomes", () => {
    expect(formatDateTime(PAID.toISOString())).toMatch(
      /^10 Sep\w* 2026, 11:43\u00a0AM$/,
    );
    expect(formatDate(PAID.getTime())).toMatch(/^10 Sep\w* 2026$/);
  });
});

describe("SHOP_TIME_ZONE", () => {
  it("is a real IANA zone", () => {
    expect(() =>
      new Intl.DateTimeFormat("en-GB", { timeZone: SHOP_TIME_ZONE }).format(
        PAID,
      ),
    ).not.toThrow();
  });
});
