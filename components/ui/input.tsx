import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A sunken well rather than an outlined box — inputs read as recessed in the
 * tactile direction, which is the inverse of the elevated surfaces around them.
 *
 * The border is --border-strong because an input is a UI component whose
 * boundary must clear 3:1 (WCAG 1.4.11). A hairline that only reads as a
 * subtle divider is not enough to identify a control.
 *
 * text-base (16px) on small screens is not a style choice: iOS Safari zooms
 * the viewport when a focused input has a font-size below 16px.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-control border border-border-strong",
        "bg-surface-sunken px-5 py-2 text-base text-primary-text md:text-sm",
        "shadow-well",
        "transition-[border-color,box-shadow,background-color] duration-(--duration-fast) ease-(--ease-out)",
        "outline-none placeholder:text-tertiary-text",
        "hover:not-disabled:not-focus:border-border-strong/70",
        "focus-visible:border-ring focus-visible:bg-surface-1 focus-visible:ring-3 focus-visible:ring-ring/25",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "aria-invalid:border-critical aria-invalid:ring-3 aria-invalid:ring-critical/20",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-primary-text file:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
