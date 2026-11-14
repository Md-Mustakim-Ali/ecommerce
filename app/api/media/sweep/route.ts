import { secretsMatch } from "@/lib/media/crypto";
import { reverifyLiveMedia, sweepPendingMedia } from "@/lib/media/sweeper";

/**
 * Advances pending media, and publishes whatever that unblocked.
 *
 * There is no cron in this project — Render's free plan has none, and
 * lib/ratelimit already establishes the pattern of sweeping opportunistically
 * rather than on a schedule. So this is an endpoint something external pokes:
 * a scheduled GitHub Action is the cheapest option that actually runs when the
 * instance is asleep, since the request itself wakes it.
 *
 * Shared-secret rather than open, because an unauthenticated endpoint that
 * makes Google API calls on behalf of every store is a free way to burn a
 * seller's entire daily quota.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const expected = process.env.MEDIA_SWEEP_SECRET;
  // Absent secret closes the endpoint rather than opening it. A missing
  // environment variable must never be the thing that makes an endpoint public.
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;

  return secretsMatch(token, expected);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? 25) || 25),
  );

  const now = new Date();
  const pending = await sweepPendingMedia(now, limit);

  // Re-verification only when the pending queue is quiet. Sellers waiting on
  // an upload right now matter more than a liveness check that can slip an
  // hour, and on a free instance the request budget is shared.
  const reverified =
    pending.checked === 0 ? await reverifyLiveMedia(now, limit) : null;

  return Response.json(
    { pending, reverified },
    { headers: { "cache-control": "no-store" } },
  );
}
