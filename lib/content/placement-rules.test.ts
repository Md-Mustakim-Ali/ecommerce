import { describe, expect, it } from "vitest";
import {
  isScheduledNow,
  type PlacementTarget,
  placementApplies,
  type RouteContext,
} from "./placement-rules";

const include = (
  targetType: PlacementTarget["targetType"],
  targetValue: string | null = null,
): PlacementTarget => ({ targetType, targetValue, isExclusion: false });

const exclude = (
  targetType: PlacementTarget["targetType"],
  targetValue: string | null = null,
): PlacementTarget => ({ targetType, targetValue, isExclusion: true });

const home: RouteContext = { kind: "home" };
const cart: RouteContext = { kind: "cart" };
const headphones: RouteContext = {
  kind: "category",
  slug: "audio-headphones",
  categoryPath: ["electronics", "electronics-audio", "audio-headphones"],
};
const product: RouteContext = {
  kind: "product",
  slug: "merino-overshirt",
  categoryPath: ["apparel", "apparel-outerwear", "outerwear-overshirts"],
  storeSlug: "northmark-supply",
};

describe("placementApplies", () => {
  it("matches everywhere", () => {
    for (const route of [home, cart, headphones, product]) {
      expect(placementApplies([include("everywhere")], route)).toBe(true);
    }
  });

  it("matches nothing when there are no inclusion rules", () => {
    // A half-configured draft must not appear site-wide by default.
    expect(placementApplies([], home)).toBe(false);
    expect(placementApplies([exclude("cart")], home)).toBe(false);
  });

  it("targets one page", () => {
    expect(placementApplies([include("home")], home)).toBe(true);
    expect(placementApplies([include("home")], cart)).toBe(false);
  });

  it("matches a category and everything beneath it", () => {
    // A banner on Electronics has to reach Headphones, or every campaign
    // needs re-targeting whenever the tree changes.
    expect(
      placementApplies([include("category", "electronics")], headphones),
    ).toBe(true);
    expect(
      placementApplies([include("category", "audio-headphones")], headphones),
    ).toBe(true);
    expect(placementApplies([include("category", "apparel")], headphones)).toBe(
      false,
    );
  });

  it("reaches products filed under a targeted category", () => {
    expect(placementApplies([include("category", "apparel")], product)).toBe(
      true,
    );
  });

  it("targets all products, or one", () => {
    expect(placementApplies([include("product")], product)).toBe(true);
    expect(
      placementApplies([include("product", "merino-overshirt")], product),
    ).toBe(true);
    expect(
      placementApplies([include("product", "something-else")], product),
    ).toBe(false);
  });

  it("targets a store", () => {
    expect(
      placementApplies([include("store", "northmark-supply")], product),
    ).toBe(true);
    expect(placementApplies([include("store", "oakline")], product)).toBe(
      false,
    );
  });

  it("treats category listings as search", () => {
    expect(placementApplies([include("search")], headphones)).toBe(true);
    expect(placementApplies([include("search")], { kind: "search" })).toBe(
      true,
    );
  });

  it("bundles several rules", () => {
    // "The home page, plus everything under Electronics, plus this page."
    const bundle = [
      include("home"),
      include("category", "electronics"),
      include("page", "about"),
    ];
    expect(placementApplies(bundle, home)).toBe(true);
    expect(placementApplies(bundle, headphones)).toBe(true);
    expect(placementApplies(bundle, { kind: "page", slug: "about" })).toBe(
      true,
    );
    expect(placementApplies(bundle, product)).toBe(false);
  });

  it("lets an exclusion beat an inclusion", () => {
    // "Everywhere except checkout" as one placement, not an enumeration.
    const rules = [include("everywhere"), exclude("cart")];
    expect(placementApplies(rules, home)).toBe(true);
    expect(placementApplies(rules, cart)).toBe(false);
  });

  it("excludes a subtree from a broader inclusion", () => {
    const rules = [
      include("category", "electronics"),
      exclude("category", "audio-headphones"),
    ];
    expect(placementApplies(rules, headphones)).toBe(false);
    expect(
      placementApplies(rules, {
        kind: "category",
        slug: "computing-keyboards",
        categoryPath: [
          "electronics",
          "electronics-computing",
          "computing-keyboards",
        ],
      }),
    ).toBe(true);
  });
});

describe("isScheduledNow", () => {
  const now = new Date("2026-09-15T12:00:00Z");

  it("requires published status", () => {
    expect(
      isScheduledNow({ status: "draft", startsAt: null, endsAt: null }, now),
    ).toBe(false);
    expect(
      isScheduledNow({ status: "archived", startsAt: null, endsAt: null }, now),
    ).toBe(false);
  });

  it("runs immediately with no bounds", () => {
    expect(
      isScheduledNow(
        { status: "published", startsAt: null, endsAt: null },
        now,
      ),
    ).toBe(true);
  });

  it("waits for the start", () => {
    expect(
      isScheduledNow(
        { status: "published", startsAt: new Date("2026-09-20"), endsAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("stops at the end", () => {
    expect(
      isScheduledNow(
        { status: "published", startsAt: null, endsAt: new Date("2026-09-10") },
        now,
      ),
    ).toBe(false);
  });

  it("is inclusive of the start and exclusive of the end", () => {
    expect(
      isScheduledNow({ status: "published", startsAt: now, endsAt: null }, now),
    ).toBe(true);
    expect(
      isScheduledNow({ status: "published", startsAt: null, endsAt: now }, now),
    ).toBe(false);
  });
});
