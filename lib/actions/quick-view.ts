"use server";

import { z } from "zod";
import { getProductBySlug } from "@/lib/catalog/queries";

export type QuickViewData = {
  slug: string;
  title: string;
  description: string | null;
  storeName: string;
  brandName: string | null;
  images: {
    id: string;
    url: string;
    alt: string | null;
    blurDataUrl: string | null;
  }[];
  variants: {
    id: string;
    sku: string;
    optionValues: Record<string, string>;
    priceCents: number;
    compareAtPriceCents: number | null;
    stock: number;
  }[];
};

/**
 * Product detail for the quick-view dialog.
 *
 * Fetched on open rather than shipped with every card in the grid — a
 * 24-product page would otherwise carry 24 galleries and variant lists nobody
 * has asked to see.
 */
export async function quickViewAction(input: {
  slug: string;
}): Promise<QuickViewData | null> {
  const slug = z.string().min(1).max(200).parse(input.slug);
  const product = await getProductBySlug(slug);
  if (!product) return null;

  return {
    slug: product.slug,
    title: product.title,
    description: product.description,
    storeName: product.storeName,
    brandName: product.brandName,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      blurDataUrl: image.blurDataUrl,
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      optionValues: variant.optionValues ?? {},
      priceCents: variant.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents,
      stock: variant.stock,
    })),
  };
}
