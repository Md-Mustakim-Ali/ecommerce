import { BlockRenderer } from "@/components/content/block-renderer";
import {
  getPlacementsForRoute,
  placementsInSlot,
  type ResolvedPlacement,
  type RouteContext,
} from "@/lib/content/queries";
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
}: {
  route: RouteContext;
  slot: ResolvedPlacement["slot"];
  className?: string;
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
      <BlockRenderer
        blocks={matching.map((placement) => ({
          id: placement.id,
          type: placement.type,
          data: placement.data,
        }))}
      />
    </div>
  );
}
