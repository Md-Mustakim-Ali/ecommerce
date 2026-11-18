import { relations, sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { products } from "./catalog";
import { reviews } from "./reviews";
import { stores } from "./stores";

/**
 * Somebody telling us something is wrong.
 *
 * A marketplace that lets anyone list anything needs a way for buyers to say
 * "this is counterfeit" or "this review is abuse", and until now there was
 * none: moderation could only act on what an admin happened to look at.
 *
 * ── Why one table for three targets ──────────────────────────────────────
 *
 * Products, reviews and stores are reported for overlapping reasons by the
 * same people through the same form, and every question worth asking — what is
 * reported most, which seller attracts complaints, what is still open — spans
 * all three. Three tables would mean three of every query and a union in each,
 * and the columns would be identical.
 *
 * The cost is that `target_id` cannot carry a foreign key, since it points at
 * one of three tables. `store_id` is a real reference and does the work that
 * matters: it is what scopes a seller to their own reports and what the heat
 * grids group by, so the row a seller must never see is excluded by a
 * constraint rather than by a filter somebody has to remember.
 */

export const reportTargetType = pgEnum("report_target_type", [
  "product",
  "review",
  "store",
]);

/**
 * Deliberately short, and deliberately not free text alone.
 *
 * A reason people pick from is countable; a paragraph is not, and "which of my
 * products draws complaints, and what kind" is the question this exists to
 * answer. The detail field is there as well, because a category alone rarely
 * tells an admin enough to act.
 */
export const reportReason = pgEnum("report_reason", [
  /** Fake or unlicensed goods sold as genuine. */
  "counterfeit",
  /** Illegal to sell, or against platform policy. */
  "prohibited",
  /** The listing does not describe what arrives. */
  "misleading",
  /** Abuse, hate, sexual content, harassment. */
  "offensive",
  /** Advertising, fake reviews, repetition. */
  "spam",
  /** Somebody else's photographs, text or brand. */
  "intellectual_property",
  "other",
]);

export const reportStatus = pgEnum("report_status", [
  /** Nobody has looked yet. */
  "open",
  /** An admin has it. Kept apart from open so two do not duplicate work. */
  "reviewing",
  /** Agreed, and acted on. */
  "upheld",
  /** Looked at, nothing wrong. */
  "dismissed",
]);

export const reports = pgTable(
  "reports",
  {
    id: primaryId(),

    /**
     * Signed-in only, and not nullable.
     *
     * An anonymous report button is a button for brigading a competitor, and
     * with nobody attached there is no way to notice the same person filing
     * forty. Requiring an account is a small barrier to a real complaint and a
     * large one to an automated campaign.
     */
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    targetType: reportTargetType("target_type").notNull(),

    /**
     * The product, review or store being reported.
     *
     * No foreign key, because it points at one of three tables — see the note
     * above. The typed columns below carry the real references for the two
     * cases that have one, so a deleted product takes its reports with it.
     */
    targetId: uuid("target_id").notNull(),

    /**
     * The store answerable for it, always set.
     *
     * For a reported store it is that store; for a product or review it is the
     * store that owns it. Denormalised on purpose: it is the scoping key for
     * everything a seller is allowed to see, and resolving it through two
     * joins on every read is how one query eventually forgets to.
     */
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),

    /** Set when the target is a product, so deletes cascade properly. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    /** Set when the target is a review. */
    reviewId: uuid("review_id").references(() => reviews.id, {
      onDelete: "cascade",
    }),

    reason: reportReason("reason").notNull(),
    /** What they actually said. Bounded in the action, not here. */
    detail: text("detail"),

    status: reportStatus("status").notNull().default("open"),

    resolvedById: text("resolved_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Why it was upheld or dismissed. Read by nobody but the next admin. */
    resolutionNote: text("resolution_note"),

    ...timestamps,
  },
  (t) => [
    /*
      One open report per person per thing.

      Without it, a single upset buyer refreshing the form produces forty rows
      and "most reported product" becomes "product most disliked by one
      person". Partial, so the same person may report something again after an
      earlier report was resolved — which is a legitimate thing to do when a
      seller reoffends.
    */
    uniqueIndex("reports_one_open_per_reporter")
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`status in ('open', 'reviewing')`),

    // The admin queue: oldest open first.
    index("reports_status_created_idx").on(t.status, t.createdAt),
    // A seller's own reports, and the heat grids.
    index("reports_store_status_idx").on(t.storeId, t.status),
    // "How many reports against this product" without a scan.
    index("reports_target_idx").on(t.targetType, t.targetId),
  ],
);

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(user, {
    fields: [reports.reporterId],
    references: [user.id],
    relationName: "reporter",
  }),
  store: one(stores, { fields: [reports.storeId], references: [stores.id] }),
  product: one(products, {
    fields: [reports.productId],
    references: [products.id],
  }),
  review: one(reviews, {
    fields: [reports.reviewId],
    references: [reviews.id],
  }),
}));
