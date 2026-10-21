"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Eye, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ProductGallery } from "@/components/shop/product-gallery";
import { VariantSelector } from "@/components/shop/variant-selector";
import { type QuickViewData, quickViewAction } from "@/lib/actions/quick-view";
import { cn } from "@/lib/utils";

/**
 * Quick view.
 *
 * Opens the gallery and variant picker without leaving the grid, which is what
 * people actually want from a listing page — a look at the other photos and
 * the size options before committing to a navigation.
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
          "touch-manipulation transition-all hover:text-primary-text active:scale-[0.88]",
          className,
        )}
      >
        <Eye className="size-4" aria-hidden />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(56rem,94vw)] overflow-y-auto rounded-2xl bg-surface-1 p-5 shadow-e4 outline-none sm:p-6">
          {loading || !data ? (
            <div className="grid h-64 place-items-center">
              <Loader2
                className="size-6 animate-spin text-tertiary-text"
                aria-hidden
              />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <ProductGallery images={data.images} title={data.title} />

              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  {data.brandName ? (
                    <span className="text-accent-text text-sm">
                      {data.brandName}
                    </span>
                  ) : null}
                  <Dialog.Title className="font-semibold text-xl tracking-tight">
                    {data.title}
                  </Dialog.Title>
                  <p className="text-secondary-text text-sm">
                    Sold by {data.storeName}
                  </p>
                </div>

                <VariantSelector variants={data.variants} />

                {data.description ? (
                  <Dialog.Description className="line-clamp-4 text-secondary-text text-sm leading-relaxed">
                    {data.description}
                  </Dialog.Description>
                ) : null}

                <Link
                  href={`/p/${data.slug}`}
                  className="text-accent-text text-sm underline underline-offset-4"
                >
                  See full details
                </Link>
              </div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
