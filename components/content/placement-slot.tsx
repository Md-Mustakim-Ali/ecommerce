import { BadgeCheck, Store } from "lucide-react";
import { BlockRenderer } from "@/components/content/block-renderer";
import {
  getPlacementsForRoute,
  placementsInSlot,
  type RouteContext,
} from "@/lib/content/queries";
import type { PlacementSlotName } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/**
 * Renders whatever placements target this route in this slot.
 *
 * Dropped into existing pages rather than only into custom ones — a promo
 * banner is almost always wanted on the home page or across a category, not on
 * a page built specially to hold it.
 *
 * Renders nothing when nothing matches, so the slot costs one cached query and
 * no layout.
 */
export async function PlacementSlot({
  route,
  slot,
  className,
  /**
   * Whether to name the source above each placement.
   *
   * On by default everywhere a seller can place something. A buyer looking at
   * "free shipping this week" cannot otherwise tell whether the marketplace is
   * promising it or one seller is, and those are different promises with
   * different people behind them. Off for the announcement bar, which is
   * platform-only by construction and where a label would be noise.
   */
  attribution = true,
}: {
  route: RouteContext;
  slot: PlacementSlotName;
  className?: string;
  attribution?: boolean;
}) {
  const all = await getPlacementsForRoute(route);
  const matching = placementsInSlot(all, slot);
  if (matching.length === 0) return null;

  return (
    <div
      className={cn(
        slot === "announcement_bar" ? "flex flex-col" : "flex flex-col gap-4",
        className,
      )}
    >
      {matching.map((placement) => (
        <div key={placement.id} className="flex flex-col gap-1.5">
          {attribution ? (
            <p className="flex items-center gap-1.5 text-tertiary-text text-xs">
              {placement.scope === "platform" ? (
                <>
                  <BadgeCheck
                    aria-hidden
                    className="size-3.5 text-accent-text"
                  />
                  <span>Marketplace offer</span>
                </>
              ) : (
                <>
                  <Store aria-hidden className="size-3.5" />
                  <span>
                    Offer from{" "}
                    <span className="text-secondary-text">
                      {placement.storeName ?? "this store"}
                    </span>
                  </span>
                </>
              )}
            </p>
          ) : null}

          <BlockRenderer
            blocks={[
              {
                id: placement.id,
                type: placement.type,
                data: placement.data,
              },
            ]}
          />
        </div>
      ))}
    </div>
  );
}
