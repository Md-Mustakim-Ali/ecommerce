"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  moderateProductAction,
  moderateReviewAction,
} from "@/lib/actions/moderation";

type Product = {
  id: string;
  title: string;
  slug: string;
  status: string;
  storeName: string;
  createdAt: string;
};

type Review = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: "published" | "flagged" | "removed";
  createdAt: string;
  productTitle: string;
  productSlug: string;
  authorName: string;
};

/**
 * Moderation.
 *
 * Taking something down archives it rather than deleting it. A past order
 * references the variant, and a takedown that turns out to be wrong has to be
 * reversible — a moderator working under time pressure will occasionally be
 * wrong, and the tool should assume so.
 */
export function ModerationPanels({
  products,
  reviews,
  canModerateReviews,
}: {
  products: Product[];
  reviews: Review[];
  canModerateReviews: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-sm">Recently published</h2>
          <p className="text-muted-foreground text-xs">
            The newest live listings. Taking one down archives it, so the seller
            keeps it and it can be restored.
          </p>
        </div>

        {products.length === 0 ? (
          <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            Nothing published recently.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
            {products.map((product) => (
              <li key={product.id} className="bg-background">
                <ProductRow product={product} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canModerateReviews ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-medium text-sm">Reviews needing a look</h2>
            <p className="text-muted-foreground text-xs">
              Flagged reviews first, then anything rated one or two stars —
              which is where complaints land. Removing one stops it counting
              toward the product's rating.
            </p>
          </div>

          {reviews.length === 0 ? (
            <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
              Nothing to look at.
            </p>
          ) : (
            <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
              {reviews.map((review) => (
                <li key={review.id} className="bg-background">
                  <ReviewRow review={review} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ProductRow({ product }: { product: Product }) {
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={`/p/${product.slug}`}
            className="truncate font-medium text-sm hover:underline"
          >
            {product.title}
          </Link>
          <span className="text-muted-foreground text-xs">
            {product.storeName} ·{" "}
            {new Date(product.createdAt).toLocaleDateString()}
          </span>
        </div>

        {!taking ? (
          <Button size="sm" variant="ghost" onClick={() => setTaking(true)}>
            Take down
          </Button>
        ) : null}
      </div>

      {taking ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(
              new FormData(event.currentTarget).get("reason") ?? "",
            );
            setError(null);
            startTransition(async () => {
              const result = await moderateProductAction({
                productId: product.id,
                reason,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(result.message);
              setTaking(false);
            });
          }}
        >
          <div className="flex-1">
            <Input
              name="reason"
              required
              maxLength={300}
              placeholder="Why is this being taken down?"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Archive it
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setTaking(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-xs">
          {message}
        </output>
      ) : null}
    </div>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(status: "published" | "flagged" | "removed", reason?: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await moderateReviewAction({
        reviewId: review.id,
        status,
        reason,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
      setRemoving(false);
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
            {"★".repeat(review.rating)}
            {"☆".repeat(5 - review.rating)}
            <Link
              href={`/p/${review.productSlug}#reviews`}
              className="hover:underline"
            >
              {review.productTitle}
            </Link>
            <Badge
              variant={
                review.status === "removed"
                  ? "critical"
                  : review.status === "flagged"
                    ? "neutral"
                    : "positive"
              }
            >
              {review.status}
            </Badge>
          </span>
          <span className="text-muted-foreground text-xs">
            {review.authorName} ·{" "}
            {new Date(review.createdAt).toLocaleDateString()}
          </span>
          {review.title ? (
            <span className="text-sm">{review.title}</span>
          ) : null}
          {review.body ? (
            <span className="text-muted-foreground text-xs">{review.body}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {review.status !== "published" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => move("published")}
            >
              Restore
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => move("flagged")}
            >
              Flag
            </Button>
          )}
          {review.status !== "removed" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setRemoving(true)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {removing ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            move(
              "removed",
              String(new FormData(event.currentTarget).get("reason") ?? ""),
            );
          }}
        >
          <div className="flex-1">
            <Input
              name="reason"
              required
              maxLength={300}
              placeholder="Why is this being removed?"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Remove
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRemoving(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-xs">
          {message}
        </output>
      ) : null}
    </div>
  );
}
