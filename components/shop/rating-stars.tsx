import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Rating display.
 *
 * The half-star is a clipped overlay rather than a separate icon, so 4.3 reads
 * as 4.3 instead of being rounded to 4 — rounding a rating is a small lie
 * about a real number.
 */
export function RatingStars({
  average,
  count,
  size = "sm",
  className,
}: {
  average: number | null;
  count: number;
  size?: "sm" | "md";
  className?: string;
}) {
  if (average === null || count === 0) {
    return (
      <span className={cn("text-tertiary-text text-xs", className)}>
        No reviews yet
      </span>
    );
  }

  const value = Math.max(0, Math.min(5, Number(average)));
  const starSize = size === "md" ? "size-4" : "size-3";

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      aria-label={`Rated ${value.toFixed(1)} out of 5 from ${count} review${count === 1 ? "" : "s"}`}
    >
      <span className="relative inline-flex" aria-hidden>
        <span className="inline-flex">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length star row
              key={i}
              className={cn(starSize, "text-border-strong")}
            />
          ))}
        </span>
        <span
          className="absolute inset-0 inline-flex overflow-hidden"
          style={{ width: `${(value / 5) * 100}%` }}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length star row
              key={i}
              className={cn(starSize, "shrink-0 fill-warning text-warning")}
            />
          ))}
        </span>
      </span>
      <span className="tabular text-[0.6875rem] text-tertiary-text">
        {value.toFixed(1)} ({count})
      </span>
    </span>
  );
}
