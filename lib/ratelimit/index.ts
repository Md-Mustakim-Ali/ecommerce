import { and, eq, lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";

/**
 * Rate limiting for the endpoints where abuse is cheap and costly.
 *
 * Three of them, for three different reasons:
 *
 *   sign-in     — password guessing. The only defence that scales, because a
 *                 correct password is indistinguishable from a lucky one.
 *   sign-up     — account farming, which is how a marketplace acquires the
 *                 fake sellers and fake reviews it later has to clean up.
 *   checkout    — card testing. Running stolen numbers through a checkout that
 *                 accepts any of them is a stolen-card validation service, and
 *                 the chargebacks land on this platform.
 *
 * Deliberately not on reads. Rate limiting a product page turns a traffic
 * spike into an outage, and there is nothing to steal there.
 */

export type Bucket =
  | "sign-in"
  | "sign-up"
  | "checkout"
  | "email"
  | "order-code";

type Rule = { limit: number; windowSeconds: number; message: string };

const RULES: Record<Bucket, Rule> = {
  // Ten in fifteen minutes. A person who has genuinely forgotten which of
  // their three passwords it was needs maybe five; an attacker needs
  // thousands, and this makes that take years.
  "sign-in": {
    limit: 10,
    windowSeconds: 15 * 60,
    message: "Too many sign-in attempts. Try again in a few minutes.",
  },
  // Five accounts an hour from one address. Higher than a person needs and low
  // enough that farming a hundred takes a day and a hundred addresses.
  "sign-up": {
    limit: 5,
    windowSeconds: 60 * 60,
    message: "Too many accounts created from here. Try again later.",
  },
  // Twenty an hour. A real shopper placing a fourth order in an hour is
  // unusual but plausible; twenty is not, and card testing needs hundreds.
  checkout: {
    limit: 20,
    windowSeconds: 60 * 60,
    message: "Too many checkout attempts. Wait a few minutes and try again.",
  },
  // Anything that causes mail to be sent. The cost here is someone else's
  // inbox and this domain's sending reputation, neither of which recovers
  // quickly.
  email: {
    limit: 5,
    windowSeconds: 60 * 60,
    message: "Too many requests. Check your inbox, including spam.",
  },
  /*
    Guessing the six-digit code emailed to a guest.

    Keyed on the ORDER, not on the caller — see the call site. Somebody
    attacking one order can rotate addresses freely, so limiting by address
    would limit the wrong thing entirely.

    Eight in fifteen minutes is roughly 750 guesses a day against a million
    possibilities, which puts an even chance of hitting one at some hundreds of
    years. A buyer copying a code out of an email needs one attempt, or two
    with a typo.
  */
  "order-code": {
    limit: 8,
    windowSeconds: 15 * 60,
    message: "Too many attempts. Use the button in your email instead.",
  },
};

export type LimitResult =
  | { ok: true; remaining: number }
  | { ok: false; message: string; retryAfterSeconds: number };

/**
 * The caller's address, as far as it can be trusted.
 *
 * Behind a proxy the socket address is the proxy's, so the forwarded header is
 * the only source — and it is client-controlled unless the proxy overwrites
 * it. Taking the FIRST entry is the standard reading (the original client),
 * and it is also the spoofable one; a deployment that terminates TLS at a
 * proxy it controls should have that proxy replace the header rather than
 * append to it.
 *
 * When there is no address at all the key becomes "unknown", which means every
 * anonymous caller shares one bucket. That is intentional: failing closed on a
 * shared bucket is safer than failing open on none.
 */
export async function callerKey(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return list.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Records one attempt and says whether it is allowed.
 *
 * Counts the attempt whether or not it succeeds. Only counting failures would
 * let an attacker with one valid account reset the counter at will.
 */
export async function checkRateLimit(
  bucket: Bucket,
  subject: string,
): Promise<LimitResult> {
  const rule = RULES[bucket];
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  // Floored to the window, so every request in the same window computes the
  // same value and therefore hits the same row.
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const key = `${bucket}:${subject}`;

  let count: number;
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        // Incremented in SQL, not read-then-written, so two concurrent
        // requests cannot both read 9 and both write 10.
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    count = row.count;
  } catch {
    // Fails OPEN. A limiter that takes the site down when its own table is
    // unavailable has caused a worse outage than the abuse it prevents. The
    // trade-off is stated here rather than left to be discovered.
    return { ok: true, remaining: rule.limit };
  }

  // Swept opportunistically rather than on a schedule: no cron to forget, and
  // the cost lands on the request that crossed the threshold rather than on a
  // shopper. Two windows back, so an in-flight request cannot lose its row.
  if (count === rule.limit + 1) {
    void db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now - windowMs * 2)))
      .catch(() => {});
  }

  if (count > rule.limit) {
    return {
      ok: false,
      message: rule.message,
      retryAfterSeconds: Math.ceil(
        (windowStart.getTime() + windowMs - now) / 1000,
      ),
    };
  }

  return { ok: true, remaining: rule.limit - count };
}

/** Clears a subject's counter. For tests and for support unblocking someone. */
export async function resetRateLimit(bucket: Bucket, subject: string) {
  await db.delete(rateLimits).where(eq(rateLimits.key, `${bucket}:${subject}`));
}

/** Reads the current count without recording an attempt. */
export async function peekRateLimit(
  bucket: Bucket,
  subject: string,
): Promise<number> {
  const rule = RULES[bucket];
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.key, `${bucket}:${subject}`),
        eq(rateLimits.windowStart, windowStart),
      ),
    )
    .limit(1);

  return row?.count ?? 0;
}

export { RULES as RATE_LIMIT_RULES };
