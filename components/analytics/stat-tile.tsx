import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card } from "@/components/analytics/ui/card";
import { cn } from "@/lib/utils";

/**
 * A single headline number.
 *
 * The interval line is not decoration. Every number on this screen is an
 * estimate from a sample, and "AOV $345" from 12 orders and from 12,000 orders
 * are different claims — rendering them identically is lying by omission. Where
 * an interval exists it is shown; where the sample is too small to have one,
 * that is said instead of quietly showing a bare mean.
 */
export function StatTile({
  label,
  value,
  interval,
  delta,
  hint,
  className,
}: {
  label: string;
  value: string;
  /** Pre-formatted confidence interval, e.g. "$311–$381". */
  interval?: string | null;
  delta?: { value: number; label: string } | null;
  hint?: string;
  className?: string;
}) {
  const direction =
    delta == null
      ? null
      : delta.value > 0
        ? "up"
        : delta.value < 0
          ? "down"
          : "flat";

  const Icon =
    direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;

  return (
    <Card size="sm" className={cn("gap-2 px-5", className)}>
      <span className="text-muted-foreground text-xs">{label}</span>

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-semibold text-2xl tracking-tight">{value}</span>
        {direction ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              // The arrow carries the direction as well as the colour, so this
              // still reads with no colour vision at all.
              direction === "up"
                ? "text-[#0ca30c]"
                : direction === "down"
                  ? "text-[#d03b3b]"
                  : "text-muted-foreground",
            )}
          >
            <Icon aria-hidden className="size-3" />
            {Math.abs(delta?.value ?? 0).toFixed(1)}%
            <span className="text-muted-foreground">{delta?.label}</span>
          </span>
        ) : null}
      </div>

      {interval ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          95% CI {interval}
        </span>
      ) : null}
      {hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </Card>
  );
}
