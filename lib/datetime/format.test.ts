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
    expect(formatDateTime(PAID)).toMatch(/^10 Sep\w* 2026, 11:43$/);
  });

  /**
   * The case that makes this a correctness bug rather than a cosmetic one.
   * 00:30 Dhaka is 18:30 UTC the day BEFORE, so a UTC render moved the date
   * backwards for every order placed after six in the evening.
   */
  it("keeps the date on the right side of midnight", () => {
    // 00:30 on 11 September in Dhaka.
    expect(formatDateTime(new Date("2026-09-10T18:30:00.000Z"))).toMatch(
      /^11 Sep\w* 2026, 00:30$/,
    );
    // 23:59 on 10 September in Dhaka.
    expect(formatDateTime(new Date("2026-09-10T17:59:00.000Z"))).toMatch(
      /^10 Sep\w* 2026, 23:59$/,
    );
  });

  it("uses a 24-hour clock", () => {
    expect(formatDateTime(new Date("2026-09-10T11:00:00.000Z"))).toMatch(
      /17:00$/,
    );
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
      /^10 Sep\w* 2026, 11:43$/,
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
