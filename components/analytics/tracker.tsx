"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { flush, track, trackClicks } from "@/lib/analytics/track";

/**
 * Mounted once, in the shop layout.
 *
 * Two jobs: record a page view whenever the route changes, and turn on the
 * delegated click listener. Both belong at the root because this is a
 * single-page app after the first load — a per-page `useEffect` would miss
 * every client-side navigation, which is most of them.
 */
export function Tracker() {
  const pathname = usePathname();

  useEffect(() => {
    track({ type: "page_view", path: pathname });
    // Deliberately keyed on pathname alone. A search or filter change rewrites
    // the query string constantly, and counting each as a fresh page view would
    // make a shopper adjusting a price slider look like forty visitors.
  }, [pathname]);

  useEffect(() => trackClicks(), []);

  // A last flush when React tears the tree down, for the case where the app
  // navigates away without the document ever becoming hidden.
  useEffect(() => flush, []);

  return null;
}

/**
 * A product page view, with the product and store attached.
 *
 * Separate from the page view above because the useful question is "how many
 * people looked at this product", and answering it from paths would mean
 * parsing slugs back into ids on every read — and would silently break the day
 * a slug changes.
 */
export function TrackProductView({
  productId,
  storeId,
}: {
  productId: string;
  storeId: string;
}) {
  useEffect(() => {
    track({ type: "product_view", productId, storeId });
  }, [productId, storeId]);

  return null;
}
