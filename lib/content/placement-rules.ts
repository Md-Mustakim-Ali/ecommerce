export type PlacementTargetType =
  | "everywhere"
  | "home"
  | "search"
  | "cart"
  | "category"
  | "product"
  | "store"
  | "page";

export type PlacementTarget = {
  targetType: PlacementTargetType;
  targetValue: string | null;
  isExclusion: boolean;
};

/** Where the shopper currently is. */
export type RouteContext = {
  kind: "home" | "search" | "category" | "product" | "cart" | "page" | "store";
  /** Category slug, product slug, or page slug depending on kind. */
  slug?: string;
  /** Every ancestor category slug plus the current one, for product and category pages. */
  categoryPath?: string[];
  storeSlug?: string;
};

/**
 * Does one target rule match the current route?
 *
 * Category matching walks the ancestor path, so a banner on "Electronics"
 * appears on "Headphones" and on the products filed under it. Targeting only
 * the exact slug would mean re-targeting every campaign whenever the tree
 * changes.
 */
export function targetMatches(
  target: PlacementTarget,
  route: RouteContext,
): boolean {
  switch (target.targetType) {
    case "everywhere":
      return true;

    case "home":
      return route.kind === "home";

    case "search":
      // Category listings are search results with a category pre-applied, so
      // "search" covers both. A campaign aimed at browsing means both.
      return route.kind === "search" || route.kind === "category";

    case "cart":
      return route.kind === "cart";

    case "category": {
      if (!target.targetValue) return route.kind === "category";
      const path = route.categoryPath ?? [];
      return path.includes(target.targetValue);
    }

    case "product":
      if (route.kind !== "product") return false;
      // A null value means every product page.
      return !target.targetValue || route.slug === target.targetValue;

    case "store":
      if (!target.targetValue) return Boolean(route.storeSlug);
      return route.storeSlug === target.targetValue;

    case "page":
      if (route.kind !== "page") return false;
      return !target.targetValue || route.slug === target.targetValue;

    default:
      return false;
  }
}

/**
 * Does a placement as a whole apply here?
 *
 * Any matching inclusion turns it on; any matching exclusion turns it off, and
 * exclusion wins. That ordering is what makes "everywhere except checkout" a
 * single placement rather than an enumeration of every page you did want.
 *
 * A placement with no inclusion rules matches nothing. Defaulting to
 * everywhere would mean a half-configured draft appearing site-wide.
 */
export function placementApplies(
  targets: readonly PlacementTarget[],
  route: RouteContext,
): boolean {
  const inclusions = targets.filter((t) => !t.isExclusion);
  const exclusions = targets.filter((t) => t.isExclusion);

  if (exclusions.some((t) => targetMatches(t, route))) return false;
  if (inclusions.length === 0) return false;
  return inclusions.some((t) => targetMatches(t, route));
}

/**
 * Is the placement live right now?
 *
 * Scheduling is checked here rather than left to somebody remembering to flip
 * a switch at midnight. Both bounds are optional: no start means already
 * running, no end means it runs until archived.
 */
export function isScheduledNow(
  placement: { status: string; startsAt: Date | null; endsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (placement.status !== "published") return false;
  if (placement.startsAt && placement.startsAt > now) return false;
  if (placement.endsAt && placement.endsAt <= now) return false;
  return true;
}
