"use client";

import { Flag, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { submitReportAction } from "@/lib/actions/reports";

/**
 * "Something is wrong with this."
 *
 * ── Deliberately quiet ───────────────────────────────────────────────────
 *
 * A small text control, not a button competing with Add to cart. The people who
 * need it will look for it; making it prominent invites idle clicking, and on a
 * marketplace the cost of a frivolous report is a seller's time.
 *
 * ── Reasons first, detail second ─────────────────────────────────────────
 *
 * A reason picked from a list is countable, which is what makes "what kind of
 * trouble does this product attract" answerable at all. Free text alone would
 * be a pile of paragraphs nobody aggregates. The box is there too, because a
 * category rarely tells an admin enough to act on.
 *
 * ── Why it thanks people for a duplicate ─────────────────────────────────
 *
 * Reporting the same thing twice returns success, not an error. The outcome
 * they wanted is already true, and "you have already reported this" is an
 * invitation to go looking for a way around it.
 */

const REASONS: { value: string; label: string }[] = [
  { value: "counterfeit", label: "Fake or unlicensed goods" },
  { value: "prohibited", label: "Illegal or against the rules" },
  { value: "misleading", label: "Does not match the description" },
  { value: "intellectual_property", label: "Uses someone else's work" },
  { value: "offensive", label: "Abusive or offensive" },
  { value: "spam", label: "Spam or fake reviews" },
  { value: "other", label: "Something else" },
];

export function ReportButton({
  targetType,
  targetId,
  label = "Report this",
}: {
  targetType: "product" | "review" | "store";
  targetId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <p role="status" className="text-secondary-text text-xs">
        {done}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-tertiary-text text-xs hover:text-secondary-text hover:underline"
      >
        <Flag aria-hidden className="size-3" />
        {label}
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);

        startTransition(async () => {
          const result = await submitReportAction({
            targetType,
            targetId,
            // The schema rejects anything not in the enum; this cast only
            // satisfies the compiler, it is not where the checking happens.
            reason: reason as (typeof REASONS)[number]["value"] as never,
            detail: detail.trim() || undefined,
          });

          if (!result.ok) {
            setError(result.message);
            return;
          }
          setDone(result.message);
        });
      }}
    >
      <p className="font-medium text-sm">What is wrong with it?</p>

      <div className="flex flex-col gap-1.5">
        {REASONS.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-secondary-text text-sm"
          >
            <input
              type="radio"
              name="reason"
              value={option.value}
              checked={reason === option.value}
              onChange={(event) => setReason(event.target.value)}
              className="size-3.5"
            />
            {option.label}
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-secondary-text text-xs">
        Anything else we should know? (optional)
        <textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          maxLength={1000}
          rows={3}
          className="rounded-md border border-border bg-surface-1 p-2 text-primary-text text-sm"
        />
      </label>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !reason}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Send report
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>

      <p className="text-tertiary-text text-xs">
        Reports go to the marketplace, not the seller. You need an account so we
        can follow up.
      </p>
    </form>
  );
}
