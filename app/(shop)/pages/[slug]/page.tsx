import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlockRenderer } from "@/components/content/block-renderer";
import { PlacementSlot } from "@/components/content/placement-slot";
import { getPublishedPage } from "@/lib/content/queries";

export async function generateMetadata({
  params,
}: PageProps<"/pages/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return { title: "Not found" };
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.excerpt ?? undefined,
  };
}

/**
 * A platform custom page.
 *
 * Only published pages resolve — a draft is a 404 to the public, not a
 * preview. Store-scoped pages live under /store/[storeSlug]/[slug].
 */
export default async function CustomPage({
  params,
}: PageProps<"/pages/[slug]">) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) notFound();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <PlacementSlot route={{ kind: "page", slug }} slot="above_content" />

      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">{page.title}</h1>
        {page.excerpt ? (
          <p className="text-lg text-secondary-text">{page.excerpt}</p>
        ) : null}
      </header>

      <div className="flex flex-col gap-8">
        <BlockRenderer blocks={page.blocks} />
      </div>

      <PlacementSlot route={{ kind: "page", slug }} slot="below_content" />
    </div>
  );
}
