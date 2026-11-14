import { and, eq, isNotNull, type SQL } from "drizzle-orm";
import { productImages } from "@/lib/db/schema";

/**
 * Shared predicates for reading product media.
 *
 * These exist because product_images stopped being a list of finished images
 * the moment it started holding Drive uploads and YouTube videos. A row can
 * now be queued, transcoding, or pointing at a file the seller has since
 * deleted, and none of those have a URL worth rendering.
 *
 * Every buyer-facing read has to say which of those it wants, and the failure
 * mode of forgetting is quiet rather than loud: `select ... order by position
 * limit 1` will happily return a half-uploaded video as a product's cover
 * photo, and the cart will render a broken thumbnail with no error anywhere.
 * Naming the predicate makes the omission visible in review.
 */

/** Finished, and with something to point at. */
export function readyAsset(): SQL | undefined {
  return and(eq(productImages.state, "ready"), isNotNull(productImages.url));
}

/**
 * Finished gallery media — images and video, in the product's carousel.
 *
 * The placement filter is what keeps a picture embedded halfway down a
 * description out of the gallery it was never meant to appear in.
 */
export function readyMedia(): SQL | undefined {
  return and(readyAsset(), eq(productImages.placement, "gallery"));
}

/**
 * A finished still image from the gallery, never a video.
 *
 * This is what every thumbnail, cart line and order snapshot wants. A YouTube
 * row has no image URL of its own, so letting one through produces an empty
 * <img> in a checkout summary.
 */
export function readyImage(): SQL | undefined {
  return and(readyMedia(), eq(productImages.kind, "image"));
}

/**
 * Finished media embedded in the description.
 *
 * Fetched separately from the gallery because the document decides the order
 * and which assets appear at all — position on the row is meaningless here.
 */
export function readyDescriptionMedia(): SQL | undefined {
  return and(readyAsset(), eq(productImages.placement, "description"));
}

/**
 * Drops rows whose URL is null, narrowing the type as it goes.
 *
 * readyMedia() already excludes them in SQL, but Drizzle types the column from
 * the schema rather than from the where clause, so the compiler still sees
 * `string | null`. Casting would work until someone reuses the query without
 * the predicate; this cannot.
 */
export function withUrl<T extends { url: string | null }>(
  rows: T[],
): (T & { url: string })[] {
  return rows.filter((row): row is T & { url: string } => row.url !== null);
}
