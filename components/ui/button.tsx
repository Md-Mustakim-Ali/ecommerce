import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Restyled, not vanilla. Three deliberate departures from stock shadcn:
 *
 * 1. Sizes are touch-first. Stock `default` is h-8 (32px), which is below the
 *    44px comfortable-touch target and painful on a phone. Default here is
 *    h-11; `sm` (36px) is the dense variant for the seller dashboard.
 * 2. Press feedback is a 0.97 scale on :active, which fires on pointerdown.
 *    Stock uses translate-y-px, one of the tells AGENTS.md calls out.
 * 3. The primary fill carries real elevation and lifts on hover, because the
 *    direction is tactile. Hover lift is scoped to `hover: hover` so it does
 *    not fire as a sticky state on touch.
 */
const buttonVariants = cva(
  [
    "group/button relative inline-flex shrink-0 select-none items-center justify-center gap-2",
    "whitespace-nowrap rounded-control border border-transparent bg-clip-padding",
    "font-medium text-sm outline-none",
    "transition-[transform,background-color,box-shadow,color] duration-[--duration-fast] ease-[--ease-out]",
    "active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-critical aria-invalid:ring-3 aria-invalid:ring-critical/20",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    // touch-action removes the 300ms tap delay and stops double-tap zoom on
    // controls, which otherwise makes rapid add-to-cart feel broken.
    "touch-manipulation",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-accent text-on-accent shadow-e1",
          "hover:not-disabled:bg-accent-hover",
          "[@media(hover:hover)]:hover:not-disabled:shadow-e2",
        ],
        outline: [
          // border-strong, not border: this is a control boundary and has to
          // clear 3:1 per WCAG 1.4.11. --border is decorative only.
          "border-border-strong bg-surface-1 text-primary-text",
          "hover:not-disabled:bg-surface-2 hover:not-disabled:shadow-e1",
        ],
        secondary: [
          "bg-surface-2 text-primary-text shadow-e1",
          "hover:not-disabled:bg-surface-3",
        ],
        ghost: "text-primary-text hover:not-disabled:bg-surface-2",
        destructive: [
          "bg-critical-muted text-critical",
          "hover:not-disabled:bg-critical hover:not-disabled:text-surface-1",
          "focus-visible:ring-critical/30",
        ],
        link: "text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        // 44px. The comfortable touch target, and the default everywhere on
        // the storefront.
        default: "h-11 px-5",
        // 36px. Dense rows in the seller dashboard, where a pointer is assumed.
        sm: "h-9 px-4 text-[0.8125rem]",
        // 52px. Primary commerce actions: add to cart, checkout.
        lg: "h-13 px-8 text-base",
        icon: "size-11",
        "icon-sm": "size-9",
        "icon-lg": "size-13",
      },
      /** Fills the container. Used for the mobile sticky add-to-cart bar. */
      block: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  block,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
