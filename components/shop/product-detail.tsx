"use client";

import { useCallback, useMemo, useState } from "react";
import {
  OptionPicker,
  type PickerVariant,
  type ProductAttribute,
} from "@/components/shop/option-picker";
import { ProductGallery } from "@/components/shop/product-gallery";

export type DetailImage = {
  id: string;
  url: string;
  alt: string | null;
  blurDataUrl: string | null;
  /** attributeId -> valueId. Empty when the image is not option-specific. */
  tags: Record<string, string>;
};

/**
 * Joins the gallery to the option picker.
 *
 * Choosing a colour should show the photo of that colour. An image matches
 * when every tag it carries is satisfied by the current selection, and the
 * most specific match wins — so a general Navy photo still works when no
 * Navy/Large photo has been uploaded, and the Navy/Large one takes over as
 * soon as it has.
 *
 * The image is only nudged when a match exists. Selecting a size that has no
 * photo of its own must not throw the shopper back to the first image.
 */
export function ProductDetail({
  images,
  attributes,
  variants,
  title,
  stockDisplay,
  lowStockThreshold,
  beforePrice,
  afterOptions,
  sidebar,
}: {
  images: DetailImage[];
  attributes: ProductAttribute[];
  variants: PickerVariant[];
  title: string;
  stockDisplay?: "never" | "always" | "when_low";
  lowStockThreshold?: number;
  /**
   * Promotional slots, passed in as already-rendered server content.
   *
   * This component is a client component and the placements are a database
   * read, so they arrive as children rather than being fetched here. That also
   * keeps the seller's choice of position a property of the page rather than
   * something this component has to know about.
   */
  beforePrice?: React.ReactNode;
  afterOptions?: React.ReactNode;
  sidebar?: React.ReactNode;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  const matchIndex = useCallback(
    (selection: Record<string, string>) => {
      let best = -1;
      let bestScore = 0;

      for (const [index, image] of images.entries()) {
        const tags = Object.entries(image.tags);
        if (tags.length === 0) continue;

        const satisfied = tags.every(
          ([attributeId, valueId]) => selection[attributeId] === valueId,
        );
        // More tags matched means a more specific photo.
        if (satisfied && tags.length > bestScore) {
          best = index;
          bestScore = tags.length;
        }
      }
      return best;
    },
    [images],
  );

  const handleSelection = useCallback(
    (selection: Record<string, string>) => {
      const index = matchIndex(selection);
      if (index >= 0) setActiveIndex(index);
    },
    [matchIndex],
  );

  const galleryImages = useMemo(
    () =>
      images.map((image) => ({
        id: image.id,
        url: image.url,
        alt: image.alt,
        blurDataUrl: image.blurDataUrl,
      })),
    [images],
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
      <ProductGallery
        images={galleryImages}
        title={title}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
      />
      <div className="flex flex-col gap-5">
        {beforePrice}
        <OptionPicker
          attributes={attributes}
          variants={variants}
          stockDisplay={stockDisplay}
          lowStockThreshold={lowStockThreshold}
          onSelectionChange={handleSelection}
        />
        {afterOptions}
        {sidebar}
      </div>
    </div>
  );
}
