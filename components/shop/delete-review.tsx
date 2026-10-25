"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteReviewAction } from "@/lib/actions/reviews";

/**
 * Lets someone take down their own review.
 *
 * A review is a public statement attached to a real name, and the person who
 * made it should be able to withdraw it — they may have been wrong, or the
 * seller may have put it right since. Moderation could already remove one;
 * only the author could not, which is backwards.
 *
 * Confirms first. This is not undoable: the review is deleted, the rating
 * average moves, and writing it again means having the order item still be
 * reviewable.
 */
export function DeleteReview({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 text-tertiary-text text-xs hover:text-critical"
      >
        <Trash2 aria-hidden className="size-3" />
        Delete mine
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="text-secondary-text">Delete this review?</span>
      <button
        type="button"
        disabled={pending}
        className="inline-flex items-center gap-1 font-medium text-critical"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await deleteReviewAction({ reviewId });
            if (!result.ok) {
              setError(result.message);
              setConfirming(false);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? (
          <Loader2 aria-hidden className="size-3 animate-spin" />
        ) : null}
        Delete
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-secondary-text"
      >
        Keep
      </button>
      {error ? (
        <span role="alert" className="text-critical">
          {error}
        </span>
      ) : null}
    </span>
  );
}
