import type { Db } from "@/lib/db";
import {
  pageBlocks,
  pages,
  placements,
  placementTargets,
} from "@/lib/db/schema";

/**
 * Demo content.
 *
 * Deliberately includes placements that target pages which already exist —
 * site-wide with an exclusion, a category subtree, and one scoped to a single
 * store. That is the case the targeting system exists for, and it is worth
 * having real rows exercising it rather than only unit tests.
 */
export async function seedContent(
  db: Db,
  input: { adminId: string; storeId: string },
) {
  const [aboutPage] = await db
    .insert(pages)
    .values({
      scope: "platform",
      slug: "how-it-works",
      title: "How this marketplace works",
      excerpt:
        "Independent stores, one cart, one payment. Here is what that means for you.",
      status: "published",
      publishedAt: new Date(),
      createdBy: input.adminId,
    })
    .returning({ id: pages.id });

  await db.insert(pageBlocks).values([
    {
      pageId: aboutPage.id,
      type: "richText",
      position: 0,
      data: {
        body: "Every store here is run by an independent seller.\n\nYou can put items from several of them in one cart and pay once. Each seller ships their own part, so an order may arrive in more than one parcel.",
      },
    },
    {
      pageId: aboutPage.id,
      type: "faq",
      position: 1,
      data: {
        items: [
          {
            question: "Why did my order arrive in separate parcels?",
            answer:
              "One payment splits into one fulfilment per store, and each seller ships independently.",
          },
          {
            question: "Who do I contact about a return?",
            answer:
              "The store that sold the item. Their details are on the order.",
          },
        ],
      },
    },
    {
      pageId: aboutPage.id,
      type: "productGrid",
      position: 2,
      data: { title: "Recently listed", source: "newest", limit: 4 },
    },
  ]);

  const [storePage] = await db
    .insert(pages)
    .values({
      scope: "store",
      storeId: input.storeId,
      slug: "shipping",
      title: "Shipping and returns",
      excerpt: "How we pack, post and take things back.",
      status: "published",
      publishedAt: new Date(),
      createdBy: input.adminId,
    })
    .returning({ id: pages.id });

  await db.insert(pageBlocks).values({
    pageId: storePage.id,
    type: "richText",
    position: 0,
    data: {
      body: "Orders leave within two working days.\n\nAnything unworn can come back within 30 days.",
    },
  });

  // Site-wide, everywhere except the cart. The exclusion is what makes this one
  // placement rather than an enumeration of every page that is not the cart.
  const [sitewide] = await db
    .insert(placements)
    .values({
      scope: "platform",
      type: "banner",
      slot: "above_content",
      data: {
        title: "Free delivery over $75",
        body: "Applies across every store, automatically at checkout.",
        tone: "accent",
        ctaLabel: "Start browsing",
        ctaHref: "/search",
      },
      priority: 10,
      status: "published",
      createdBy: input.adminId,
    })
    .returning({ id: placements.id });

  await db.insert(placementTargets).values([
    { placementId: sitewide.id, targetType: "everywhere", targetValue: null },
    {
      placementId: sitewide.id,
      targetType: "cart",
      targetValue: null,
      isExclusion: true,
    },
  ]);

  // An offer on a category subtree, so it reaches every descendant category and
  // the products filed beneath them without being re-targeted.
  const [categoryOffer] = await db
    .insert(placements)
    .values({
      scope: "platform",
      type: "offerCard",
      slot: "above_content",
      data: {
        title: "20% off audio this week",
        body: "Applies to every pair of headphones and every speaker.",
        code: "AUDIO20",
        discountLabel: "-20%",
        ctaLabel: "Shop audio",
        ctaHref: "/c/electronics-audio",
      },
      priority: 20,
      status: "published",
      createdBy: input.adminId,
    })
    .returning({ id: placements.id });

  await db.insert(placementTargets).values({
    placementId: categoryOffer.id,
    targetType: "category",
    targetValue: "electronics",
  });

  // Store-scoped, so it only ever reaches this seller's own product pages.
  const [storeBanner] = await db
    .insert(placements)
    .values({
      scope: "store",
      storeId: input.storeId,
      type: "banner",
      slot: "above_content",
      data: {
        title: "Made to be repaired",
        body: "Every seam on this range can be re-stitched by us for free.",
        tone: "neutral",
      },
      priority: 5,
      status: "published",
      createdBy: input.adminId,
    })
    .returning({ id: placements.id });

  await db.insert(placementTargets).values({
    placementId: storeBanner.id,
    targetType: "product",
    targetValue: null,
  });

  return { pages: 2, placements: 3 };
}
