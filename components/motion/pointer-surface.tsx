"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Tracks the pointer across a surface and publishes it as --px / --py, both
 * normalised to -1..1 from the centre.
 *
 * Written straight to the node with setProperty rather than through state:
 * a pointermove that triggered a React render would fire dozens of times a
 * second and drop frames on the mid-range Android in the performance budget.
 * Nothing here touches layout — the CSS in globals.css turns these into a
 * transform and an opacity, which stay on the compositor.
 *
 * Pointer effects are skipped entirely on touch. `hover: hover` gates the CSS,
 * and coarse pointers never fire the listener anyway, so a tap does not leave
 * a card stuck in a tilted state.
 */
export function PointerSurface({
  children,
  className,
  sheen = true,
  render: Render = "div",
}: {
  children: React.ReactNode;
  className?: string;
  sheen?: boolean;
  render?: React.ElementType;
}) {
  const ref = useRef<HTMLElement>(null);

  const handleMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    const node = ref.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;

    node.style.setProperty("--px", (px * 2).toFixed(3));
    node.style.setProperty("--py", (py * 2).toFixed(3));
  }, []);

  const handleLeave = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // Back to rest. The CSS transition carries it, so it eases rather than snaps.
    node.style.setProperty("--px", "0");
    node.style.setProperty("--py", "0");
  }, []);

  return (
    <Render
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={cn("pointer-surface relative", sheen && "sheen", className)}
    >
      {children}
    </Render>
  );
}
