"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight, Eye, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ProductDetail } from "@/components/shop/product-detail";
import { type QuickViewData, quickViewAction } from "@/lib/actions/quick-view";
import { cn } from "@/lib/utils";

/**
 * Quick view.
 *
 * Opens the gallery and the variant picker without leaving the grid, which is
 * what people want from a listing page — a look at the other photos and the
 * size options before committing to a navigation.
 *
 * ── Why this is not the product page in a box ────────────────────────────
 *
 * It used to render ProductDetail, the same component the product page uses.
 * That component is built for a page: a 4:5 portrait gallery stacked above a
 * column of everything known about the product. Dropped into a dialog capped
 * at 90dvh it did the only thing it could — overflow — so the quick view
 * opened with a scrollbar and a photo taller than the screen.
 *
 * A quick view that has to be scrolled has stopped being quick. So this lays
 * out for the shape it actually has: two columns side by side, the gallery in
 * a 4:3 frame, and the whole thing sized to fit rather than sized to the
 * content. On a phone, where two columns will not fit, it stacks and the
 * dialog becomes a sheet from the bottom — scrolling there is expected and
 * reads as one continuous panel rather than two disconnected halves.
 *
 * Data is fetched on open, so the grid stays light.
 */
export function QuickView({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<QuickViewData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(next: boolean) {
    setOpen(next);
    if (!next || data) return;
    setLoading(true);
    try {
      setData(await quickViewAction({ slug }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={load}>
      <Dialog.Trigger
        // Cards wrap this in a link; without both the trigger navigates.
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        aria-label="Quick view"
        title="Quick view"
        className={cn(
          "grid size-9 place-items-center rounded-full bg-surface-1/85 text-secondary-text backdrop-blur",
          "touch-manipulation transition-[color,transform,background-color] duration-(--duration-fast) ease-(--ease-out) hover:text-primary-text active:scale-[0.88] active:duration-(--duration-instant)",
          className,
        )}
      >
        <Eye className="size-4" aria-hidden />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="motion-backdrop fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />

        <Dialog.Popup
          className={cn(
            // motion-popup fades and scales it from 0.96. The centring
            // translate is untouched by it: Tailwind 4 emits translate and
            // scale as separate CSS properties rather than as parts of one
            // transform string, so the two cannot overwrite each other the way
            // they would have had to before.
            "motion-popup",
            "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50",
            "w-[min(60rem,94vw)] rounded-2xl bg-surface-1 shadow-e4 outline-none",
            // Capped rather than fitted to the content, and the panel itself
            // never scrolls — the one column that can overflow does, so the
            // gallery stays put instead of sliding away under the header.
            "flex max-h-[88dvh] flex-col overflow-hidden",
          )}
        >
          {loading || !data ? (
            <div className="grid h-72 place-items-center">
              <Loader2
                className="size-6 animate-spin text-tertiary-text"
                aria-hidden
              />
            </div>
          ) : (
            <>
              <Dialog.Close
                aria-label="Close"
                className={cn(
                  "absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-full",
                  "bg-surface-1/85 text-secondary-text backdrop-blur transition-colors",
                  "hover:text-primary-text focus-visible:ring-3 focus-visible:ring-ring/40",
                )}
              >
                <X className="size-4" aria-hidden />
              </Dialog.Close>

              {/*
                The heading rides in the right column via beforePrice, so it
                scrolls with the options rather than sitting in a fixed band
                above both columns — which is what made the panel read as two
                unrelated halves.
              */}
              <ProductDetail
                title={data.title}
                images={data.images}
                attributes={data.attributes}
                variants={data.variants}
                layout="dialog"
                beforePrice={
                  <div className="flex flex-col gap-1 pr-10">
                    {data.brandName ? (
                      <span className="text-accent-text text-sm">
                        {data.brandName}
                      </span>
                    ) : null}
                    <Dialog.Title className="font-semibold text-lg leading-snug tracking-tight">
                      {data.title}
                    </Dialog.Title>
                    {data.description ? (
                      <Dialog.Description className="line-clamp-2 text-secondary-text text-sm leading-relaxed">
                        {data.description}
                      </Dialog.Description>
                    ) : null}
                  </div>
                }
              />

              <div className="flex shrink-0 items-center justify-between gap-3 border-border border-t px-5 py-3">
                <p className="truncate text-secondary-text text-sm">
                  Sold by {data.storeName}
                </p>
                <Link
                  href={`/p/${data.slug}`}
                  className="inline-flex shrink-0 items-center gap-1 text-accent-text text-sm underline-offset-4 hover:underline"
                >
                  Full details
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
