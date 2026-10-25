import { DeleteReview } from "@/components/shop/delete-review";
import { RatingStars } from "@/components/shop/rating-stars";
import { ReviewForm } from "@/components/shop/review-form";
import { Separator } from "@/components/ui/separator";
import type { ReviewablePurchase, ReviewRow } from "@/lib/reviews/queries";

/**
 * Reviews on the product page.
 *
 * The histogram sits next to the average because a mean on its own hides
 * shape: 4.0 from forty fours and 4.0 from twenty ones and twenty fives are
 * very different products, and only one of them is safe to buy.
 *
 * Each review shows the variant that was actually bought. On a product where
 * one colour runs small, that detail is the review.
 */
export function ReviewSection({
  reviews,
  breakdown,
  reviewable,
}: {
  reviews: ReviewRow[];
  breakdown: {
    total: number;
    average: number | null;
    buckets: { rating: number; count: number }[];
  };
  /** The signed-in buyer's own delivered purchases of this product, if any. */
  reviewable: ReviewablePurchase[];
}) {
  return (
    <section
      id="reviews"
      className="flex scroll-mt-24 flex-col gap-6"
      aria-labelledby="reviews-heading"
    >
      <h2 id="reviews-heading" className="font-semibold text-lg tracking-tight">
        Reviews
      </h2>

      <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
        <div className="flex h-fit flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
          {breakdown.total === 0 ? (
            <p className="text-secondary-text text-sm">
              No reviews yet. Buy it and be the first.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-3xl tabular">
                  {breakdown.average?.toFixed(1)}
                </span>
                <RatingStars
                  average={breakdown.average}
                  count={breakdown.total}
                  size="md"
                />
                <span className="text-tertiary-text text-xs">
                  {breakdown.total}{" "}
                  {breakdown.total === 1 ? "review" : "reviews"}
                </span>
              </div>

              <ul className="flex flex-col gap-1.5">
                {breakdown.buckets.map((bucket) => {
                  const share =
                    breakdown.total === 0
                      ? 0
                      : (bucket.count / breakdown.total) * 100;
                  return (
                    <li
                      key={bucket.rating}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-3 text-tertiary-text tabular">
                        {bucket.rating}
                      </span>
                      <span
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
                        // The bar is decorative; the count beside it is the
                        // accessible value.
                        aria-hidden
                      >
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${share}%` }}
                        />
                      </span>
                      <span className="w-6 text-right text-tertiary-text tabular">
                        {bucket.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {reviewable.length > 0 ? (
            <>
              {reviewable.map((purchase) => (
                <ReviewForm key={purchase.orderItemId} purchase={purchase} />
              ))}
              <Separator />
            </>
          ) : null}

          {reviews.length === 0 ? (
            <p className="text-secondary-text text-sm">Nothing written yet.</p>
          ) : (
            <ul className="flex flex-col gap-5">
              {reviews.map((review) => (
                <li key={review.id} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <RatingStars average={review.rating} count={1} />
                    <span className="font-medium text-sm">
                      {review.authorName}
                    </span>
                    {/*
                      Every review is a verified purchase by construction —
                      there is no code path that creates one without an order
                      item — so this is a statement of fact, not a badge some
                      reviews lack.
                    */}
                    <span className="text-positive text-xs">
                      Verified purchase
                    </span>
                    {review.mine ? <DeleteReview reviewId={review.id} /> : null}
                    <time
                      dateTime={review.createdAt.toISOString()}
                      className="text-tertiary-text text-xs"
                    >
                      {review.createdAt.toLocaleDateString()}
                    </time>
                  </div>

                  {review.variantLabel ? (
                    <p className="text-tertiary-text text-xs">
                      Bought: {review.variantLabel}
                    </p>
                  ) : null}

                  {review.title ? (
                    <p className="font-medium text-sm">{review.title}</p>
                  ) : null}
                  {review.body ? (
                    <p className="text-secondary-text text-sm leading-relaxed">
                      {review.body}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
