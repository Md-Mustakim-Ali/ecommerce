import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import {
  eventBatch,
  looksAutomated,
  recordEvents,
} from "@/lib/analytics/ingest";
import { getSession } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/ratelimit";

/**
 * Where the browser posts what happened.
 *
 * ── Always 204, whatever happens ─────────────────────────────────────────
 *
 * Analytics must never be visible to a shopper. A rejected batch, a rate limit,
 * a database having a bad second — none of it is the buyer's problem, and none
 * of it should produce a console error on a product page or, worse, a retry
 * loop. So every path returns the same empty success, and the reasons are
 * logged rather than returned.
 *
 * That also removes the endpoint's value as an oracle: it cannot be used to
 * probe which product ids exist, because it says the same thing either way.
 *
 * ── The session cookie ───────────────────────────────────────────────────
 *
 * Set here rather than taken from the payload. A client-supplied session id can
 * be a fresh one per request, which would make every view look like a different
 * person and make the "sessions" column a slower copy of "events". It is a
 * random value with no meaning, `httpOnly` so page scripts cannot read it, and
 * `SameSite=Lax` so it does not travel to anyone else.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "sid";
const YEAR = 60 * 60 * 24 * 365;

const noContent = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  try {
    const headerList = await headers();

    // Cheap and first: a crawler's events are worse than no events, because
    // they make a number look real.
    if (looksAutomated(headerList.get("user-agent"))) return noContent();

    const jar = await cookies();
    let sessionId = jar.get(COOKIE)?.value;
    if (!sessionId || sessionId.length !== 36) {
      sessionId = randomUUID();
      jar.set(COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: YEAR,
      });
    }

    /*
      Keyed on the session, not the address.

      A shared mobile network puts thousands of real shoppers behind one IP, so
      limiting by address would throttle a whole city to protect against one
      script. The session is what a flood actually comes from, and a browser
      that discards its cookie to get around this also discards its history —
      which is the thing being protected.
    */
    const limit = await checkRateLimit("events", sessionId);
    if (!limit.ok) return noContent();

    const parsed = eventBatch.safeParse(await request.json());
    if (!parsed.success) return noContent();

    const session = await getSession();

    await recordEvents(sessionId, session?.user.id ?? null, parsed.data.events);

    return noContent();
  } catch (error) {
    // Never surfaced. An analytics failure is not a shopping failure.
    console.error("[events] ingest failed", error);
    return noContent();
  }
}
