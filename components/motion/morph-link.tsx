"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import {
  navigateWithTransition,
  settleNavTransition,
} from "@/lib/motion/nav-transition";

/**
 * A link whose image morphs into the same image on the page it opens.
 *
 * The View Transitions API pairs elements by `view-transition-name`, and a name
 * appearing twice in one document makes the browser skip the transition
 * entirely. A grid of twenty-four permanently-named cards is therefore one
 * duplicate away — a related-products rail showing something already on screen,
 * say — from silently switching the animation off everywhere.
 *
 * So the name is applied to exactly one element, at the moment of the click,
 * and removed when the transition ends. Nothing is named while nobody is
 * navigating, which also means the browser captures one extra snapshot rather
 * than twenty-four.
 */
export function MorphLink({
  href,
  name,
  children,
  className,
  prefetch,
  "aria-label": ariaLabel,
}: {
  href: string;
  /** Shared with the target page's hero. Must be a valid CSS custom-ident. */
  name: string;
  children: React.ReactNode;
  className?: string;
  prefetch?: boolean;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const router = useRouter();

  const open = useCallback(
    (event: React.MouseEvent | React.KeyboardEvent) => {
      // Modified clicks open a new tab. Intercepting one would break a habit
      // people rely on for something as small as an animation.
      if (
        "button" in event &&
        (event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey)
      ) {
        return;
      }

      event.preventDefault();

      // Looked up inside the link first, then within the nearest
      // [data-morph-scope] ancestor. A card gives its one accessible link to
      // the title and marks the image decorative, so the element that should
      // travel is a sibling rather than a child — searching only inside would
      // mean the morph worked with a mouse and not with a keyboard.
      const target =
        ref.current?.querySelector<HTMLElement>("[data-morph]") ??
        ref.current
          ?.closest("[data-morph-scope]")
          ?.querySelector<HTMLElement>("[data-morph]") ??
        null;

      navigateWithTransition(() => router.push(href), target, name);
    },
    [href, name, router],
  );

  return (
    <Link
      ref={ref}
      href={href}
      prefetch={prefetch}
      aria-label={ariaLabel}
      className={className}
      onClick={open}
    >
      {children}
    </Link>
  );
}

/**
 * Tells the running transition that the new page has rendered.
 *
 * Mounted once in the root layout rather than inside any page, because the
 * element that starts a navigation is the first thing that navigation unmounts
 * — it cannot be the one to report that the navigation finished.
 *
 * Renders nothing.
 */
export function NavTransitionSettler() {
  const pathname = usePathname();
  const settled = useRef(pathname);

  useEffect(() => {
    // Only an actual route change, not any re-render that happens to run this.
    // Settling early would snapshot the page mid-navigation.
    if (settled.current === pathname) return;
    settled.current = pathname;
    settleNavTransition();
  }, [pathname]);

  return null;
}
