import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badges carry status, not decoration: in stock, low stock, pending approval,
 * verified purchase. Each status variant pairs a muted tint with its full
 * strength colour as text, which is the pairing the contrast test verifies.
 *
 * Kept flat and unelevated on purpose. If a badge floated it would compete
 * with the product card it sits on.
 */
const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden",
    "rounded-full border border-transparent px-2.5 py-0.5",
    "font-medium text-xs whitespace-nowrap",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ],
  {
    variants: {
      variant: {
        default: "bg-accent text-on-accent",
        muted: "bg-accent-muted text-accent-text",
        neutral: "bg-surface-2 text-secondary-text",
        outline: "border-border-strong text-secondary-text",
        positive: "bg-positive-muted text-positive",
        critical: "bg-critical-muted text-critical",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

function Badge({
  className,
  variant = "neutral",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      { className: cn(badgeVariants({ variant }), className) },
      props,
    ),
    render,
    state: { slot: "badge", variant },
  });
}

export { Badge, badgeVariants };
