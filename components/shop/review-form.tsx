"use client";

import { Loader2, Star } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitReviewAction } from "@/lib/actions/reviews";
import type { ReviewablePurchase } from "@/lib/reviews/queries";

/**
 * Writing or editing a review for one delivered purchase.
 *
 * The star picker is a radio group, not five buttons. Rating is a single
 * choice from a fixed set, which is what a radio group means — and it gets
 * arrow-key navigation and a proper announced value for free.
 */
export function ReviewForm({ purchase }: { purchase: ReviewablePurchase }) {
  const [rating, setRating] = useState(purchase.existing?.rating ?? 0);
  const [hovered, setHovered] = useState(0);
  const [open, setOpen] = useState(purchase.existing === null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = hovered || rating;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3">
        <p className="text-secondary-text text-sm">
          You reviewed this
          {purchase.variantLabel ? ` (${purchase.variantLabel})` : ""} —{" "}
          {purchase.existing?.rating} out of 5.
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Edit review
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await submitReviewAction({
            orderItemId: purchase.orderItemId,
            rating,
            title: String(data.get("title") ?? ""),
            body: String(data.get("body") ?? ""),
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setMessage(result.message);
          setOpen(false);
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-sm">
          {purchase.existing ? "Edit your review" : "Write a review"}
        </h3>
        <p className="text-tertiary-text text-xs">
          You bought this on {purchase.orderNumber}
          {purchase.variantLabel ? ` · ${purchase.variantLabel}` : ""}
        </p>
      </div>

      <fieldset
        className="flex flex-col gap-1.5"
        onMouseLeave={() => setHovered(0)}
      >
        <legend className="mb-1.5 font-medium text-xs">Rating</legend>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="cursor-pointer p-0.5"
              onMouseEnter={() => setHovered(value)}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="sr-only peer"
              />
              <Star
                aria-hidden
                className={`size-6 transition-transform peer-focus-visible:scale-110 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 ${
                  value <= shown
                    ? "fill-accent text-accent"
                    : "text-tertiary-text"
                }`}
              />
              <span className="sr-only">
                {value} star{value === 1 ? "" : "s"}
              </span>
            </label>
          ))}
          {rating > 0 ? (
            <span className="ml-2 text-secondary-text text-xs">
              {rating} out of 5
            </span>
          ) : null}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={`title-${purchase.orderItemId}`}>
          Headline (optional)
        </Label>
        <Input
          id={`title-${purchase.orderItemId}`}
          name="title"
          defaultValue={purchase.existing?.title ?? ""}
          placeholder="Held up better than I expected"
          maxLength={120}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`body-${purchase.orderItemId}`}>
          What should other people know?
        </Label>
        <textarea
          id={`body-${purchase.orderItemId}`}
          name="body"
          rows={4}
          maxLength={4000}
          defaultValue={purchase.existing?.body ?? ""}
          className="w-full rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          placeholder="Fit, quality, how it compares to what you expected."
        />
      </div>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
      {/* <output> is the native live region; role="status" on a <p> is the
          same announcement with none of the semantics. */}
      {message ? (
        <output className="block text-positive text-sm">{message}</output>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || rating === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {purchase.existing ? "Save review" : "Post review"}
        </Button>
        {purchase.existing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        ) : null}
        {rating === 0 ? (
          <span className="text-tertiary-text text-xs">
            Pick a rating to post.
          </span>
        ) : null}
      </div>
    </form>
  );
}
