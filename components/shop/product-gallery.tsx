"use client";

import useEmblaCarousel from "embla-carousel-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type GalleryImage = {
  id: string;
  url: string;
  alt: string | null;
  blurDataUrl: string | null;
};

/**
 * Product gallery.
 *
 * Every slide carries the same aspect-ratio and a blur placeholder, so the
 * layout is settled before a single image arrives. Only the first slide is
 * priority-loaded — it is the LCP element on this page.
 */
export function ProductGallery({
  images,
  title,
  activeIndex,
  onActiveIndexChange,
}: {
  images: GalleryImage[];
  title: string;
  /** Controlled from outside so the option picker can steer the gallery. */
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
}) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: "start",
  });
  const [selected, setSelected] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    const index = emblaApi.selectedScrollSnap();
    setSelected(index);
    onActiveIndexChange?.(index);
  }, [emblaApi, onActiveIndexChange]);

  // Follows the controlled index when something outside changes it — picking a
  // colour, say. Guarded on the current snap so this cannot fight the user
  // mid-swipe.
  useEffect(() => {
    if (!emblaApi || activeIndex === undefined) return;
    if (emblaApi.selectedScrollSnap() === activeIndex) return;
    emblaApi.scrollTo(activeIndex);
  }, [emblaApi, activeIndex]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  if (images.length === 0) {
    return <div className="aspect-[4/5] w-full rounded-xl bg-surface-sunken" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {images.map((image, index) => (
            <div key={image.id} className="relative min-w-0 flex-[0_0_100%]">
              <div className="relative aspect-[4/5] bg-surface-sunken">
                <Image
                  src={image.url}
                  alt={image.alt ?? `${title} — image ${index + 1}`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  priority={index === 0}
                  placeholder={image.blurDataUrl ? "blur" : "empty"}
                  blurDataURL={image.blurDataUrl ?? undefined}
                  className="object-cover"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {images.length > 1 ? (
        <div className="flex gap-2" role="tablist" aria-label="Product images">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              role="tab"
              aria-selected={index === selected}
              aria-label={`Image ${index + 1}`}
              onClick={() => emblaApi?.scrollTo(index)}
              className={cn(
                "relative size-16 overflow-hidden rounded-md bg-surface-sunken transition-all",
                "touch-manipulation active:scale-[0.94]",
                index === selected
                  ? "ring-2 ring-ring ring-offset-2 ring-offset-surface-0"
                  : "opacity-60 hover:opacity-100",
              )}
            >
              <Image
                src={image.url}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
