"use client";

import { Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleSavedAction } from "@/lib/actions/saved";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/utils";

/**
 * Wishlist toggle.
 *
 * Optimistic, and rolled back if the server refuses. A signed-out visitor is
 * sent to sign-in with a return path rather than having the tap silently do
 * nothing — the second is the more common implementation and the more
 * annoying one.
 */
export function SaveButton({
  productId,
  initialSaved,
  className,
  label,
}: {
  productId: string;
  initialSaved: boolean;
  className?: string;
  label?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(event: React.MouseEvent) {
    // Cards wrap this in a link. Without both, tapping the heart navigates.
    event.preventDefault();
    event.stopPropagation();

    const next = !saved;
    setSaved(next);
    navigator.vibrate?.(10);

    startTransition(async () => {
      const result = await toggleSavedAction({ productId });
      if (result.ok) {
        setSaved(result.saved);
        // Both directions. A product people save and then unsave is a
        // different story from one nobody saves, and only one of those shows
        // up if removals go uncounted.
        track({
          type: result.saved ? "wishlist_add" : "wishlist_remove",
          productId,
        });
        return;
      }
      setSaved(!next);
      if (result.reason === "signed-out") {
        router.push(
          `/sign-in?next=${encodeURIComponent(window.location.pathname)}`,
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved" : "Save for later"}
      title={saved ? "Saved" : "Save for later"}
      className={cn(
        "grid size-9 place-items-center rounded-full backdrop-blur transition-[color,background-color,transform] duration-(--duration-fast) ease-(--ease-out)",
        "touch-manipulation active:scale-[0.88]",
        saved
          ? "bg-critical text-surface-1"
          : "bg-surface-1/85 text-secondary-text hover:text-primary-text",
        className,
      )}
    >
      <Heart className={cn("size-4", saved && "fill-current")} aria-hidden />
      {label ? <span className="sr-only">{label}</span> : null}
    </button>
  );
}
