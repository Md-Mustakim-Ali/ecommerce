import { after } from "next/server";
import { log } from "../observability/logger";
import { sweepStoreMedia } from "./sweeper";

/**
 * Sweeps a store's pending media on the way out of a page it already rendered.
 *
 * The scheduled sweep runs hourly, and GitHub's scheduler adds ten to thirty
 * minutes on top. That is the right cost for auto-publishing while nobody is
 * looking, and the wrong one for the seller refreshing the page waiting for
 * their video. This closes that gap by doing the work where they already are.
 *
 * It is close to free, which is the reason it is worth doing at all. The
 * expensive resource on a free instance is not CPU, it is the instance-hours
 * spent being awake — and the instance is awake, because somebody is using it.
 * The scheduled job's whole cost is that each ping wakes a sleeping server.
 *
 * `after` rather than a floating promise. A bare `void sweep()` races the
 * response: the framework is free to consider the request finished and tear
 * the context down mid-await, which fails as media that intermittently does
 * not advance and is close to undebuggable. `after` is the supported way to
 * say "run this once the response is out", and Next keeps the work alive.
 *
 * No throttle here on purpose. lib/media/schedule.ts already backs each asset
 * off exponentially and the sweep skips anything not yet due, so refreshing
 * the page ten times costs ten indexed queries and no Google calls. A second
 * throttle would only be able to disagree with the first.
 */
export function sweepStoreMediaAfterResponse(storeId: string): void {
  after(async () => {
    try {
      const summary = await sweepStoreMedia(storeId);

      // Only worth a line when something actually moved. A sweep that checked
      // nothing is the common case and would drown the log.
      if (summary.becameReady > 0 || summary.published.length > 0) {
        log.info("media advanced on dashboard load", {
          storeId,
          checked: summary.checked,
          becameReady: summary.becameReady,
          published: summary.published.length,
        });
      }
    } catch (error) {
      // Swallowed deliberately. This is a background courtesy attached to a
      // page that has already been sent — a Google outage must not turn into
      // an error the seller sees, and the scheduled sweep will retry anyway.
      log.warn("opportunistic media sweep failed", {
        storeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
