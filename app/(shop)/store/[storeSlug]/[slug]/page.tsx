import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlockRenderer } from "@/components/content/block-renderer";
import { PlacementSlot } from "@/components/content/placement-slot";
import { getPublishedPage } from "@/lib/content/queries";

export async function generateMetadata({
  params,
}: PageProps<"/store/[storeSlug]/[slug]">): Promise<Metadata> {
  const { storeSlug, slug } = await params;
  const page = await getPublishedPage(slug, storeSlug);
  if (!page) return { title: "Not found" };
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.excerpt ?? undefined,
  };
}

/**
 * A store's own custom page.
 *
 * Scoped by store slug, so two stores can each have a "shipping" page without
 * colliding — the partial unique index on (store_id, slug) is what allows it.
 */
export default async function StorePage({
  params,
}: PageProps<"/store/[storeSlug]/[slug]">) {
  const { storeSlug, slug } = await params;
  const page = await getPublishedPage(slug, storeSlug);
  if (!page) notFound();

  const route = { kind: "page" as const, slug, storeSlug };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <PlacementSlot route={route} slot="above_content" />

      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">{page.title}</h1>
        {page.excerpt ? (
          <p className="text-lg text-secondary-text">{page.excerpt}</p>
        ) : null}
      </header>

      <div className="flex flex-col gap-8">
        <BlockRenderer blocks={page.blocks} />
      </div>

      <PlacementSlot route={route} slot="below_content" />
    </div>
  );
}
