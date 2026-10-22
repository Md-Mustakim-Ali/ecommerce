import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlacementSlot } from "@/components/content/placement-slot";
import { ProductGrid } from "@/components/shop/product-grid";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getSession } from "@/lib/auth/guards";
import { getSavedProductIds, listProducts } from "@/lib/catalog/queries";
import { db } from "@/lib/db";
import { pages, stores } from "@/lib/db/schema";
import { accentHex } from "@/lib/stores/appearance";

async function getStore(slug: string) {
  return db.query.stores.findFirst({
    where: and(eq(stores.slug, slug), eq(stores.status, "active")),
    columns: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      bannerUrl: true,
      supportEmail: true,
      accentColor: true,
      layoutPreset: true,
      createdAt: true,
    },
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/store/[storeSlug]">): Promise<Metadata> {
  const { storeSlug } = await params;
  const store = await getStore(storeSlug);
  if (!store) return { title: "Not found" };
  return {
    title: store.name,
    description: store.description ?? `Products from ${store.name}.`,
  };
}

/**
 * A store's shopfront.
 *
 * This is the page "Sold by X" should have always pointed at. A marketplace
 * where every seller is only ever a line of text under a product title is a
 * catalogue with a payment form attached; the whole premise of multi-vendor is
 * that the seller is somebody you can go and look at.
 *
 * What the owner controls: the banner, logo, description and support contact
 * on their store record, any custom pages they publish under /store/<slug>/…,
 * and any offers they place. Everything else — the grid, the layout, the
 * navigation — is the marketplace's, which is what keeps one seller's page
 * recognisably part of the same site as the next.
 */
export default async function StoreFrontPage({
  params,
  searchParams,
}: PageProps<"/store/[storeSlug]">) {
  const { storeSlug } = await params;
  const query = await searchParams;

  const store = await getStore(storeSlug);
  if (!store) notFound();

  const page = Math.max(
    1,
    Number(Array.isArray(query.page) ? query.page[0] : (query.page ?? 1)) || 1,
  );

  const [listing, customPages] = await Promise.all([
    listProducts({ storeSlugs: [store.slug], page, perPage: 24 }),
    db
      .select({ slug: pages.slug, title: pages.title })
      .from(pages)
      .where(
        and(
          eq(pages.storeId, store.id),
          eq(pages.scope, "store"),
          eq(pages.status, "published"),
        ),
      )
      .limit(8),
  ]);

  const session = await getSession();
  const savedIds = await getSavedProductIds(
    session?.user.id ?? null,
    listing.items.map((item) => item.id),
  );

  // listProducts returns a raw total; the page count is the caller's to derive.
  const totalPages = Math.max(1, Math.ceil(listing.total / listing.perPage));

  const route = { kind: "store" as const, storeSlug: store.slug };

  // The seller's accent, scoped to this page only. Set as a CSS variable
  // rather than passed to components, so it reaches everything inside without
  // any of them needing to know a store can be themed.
  const accent = accentHex(store.accentColor);

  // The preset changes the grid density and nothing else. Product pages, cart
  // and checkout stay identical across every store.
  const columns =
    store.layoutPreset === "editorial"
      ? "sm:grid-cols-2 lg:grid-cols-3"
      : store.layoutPreset === "gallery"
        ? "grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div
      className="flex flex-col"
      style={
        accent ? ({ "--accent": accent } as React.CSSProperties) : undefined
      }
    >
      {store.bannerUrl ? (
        <div className="relative h-40 w-full overflow-hidden sm:h-56 lg:h-64">
          <Image
            src={store.bannerUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          {/* The scrim is what keeps the name legible over an image the
              seller chose and the platform has never seen. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center text-secondary-text text-sm">
            <li>
              <Link href="/" className="hover:text-primary-text">
                Home
              </Link>
            </li>
            <li aria-hidden className="px-2 text-tertiary-text">
              /
            </li>
            <li>
              <span aria-current="page" className="text-primary-text">
                {store.name}
              </span>
            </li>
          </ol>
        </nav>

        <PlacementSlot route={route} slot="above_content" />

        <header
          className={`flex flex-wrap items-start gap-5 ${store.bannerUrl ? "-mt-16 relative" : ""}`}
        >
          {store.logoUrl ? (
            <Image
              src={store.logoUrl}
              alt=""
              width={88}
              height={88}
              className="size-22 shrink-0 rounded-xl border border-border bg-surface-1 object-cover shadow-e2"
            />
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
                {store.name}
              </h1>
              <Badge variant="muted">
                Seller since {store.createdAt.getFullYear()}
              </Badge>
            </div>

            {store.description ? (
              <p className="max-w-2xl text-secondary-text text-sm leading-relaxed">
                {store.description}
              </p>
            ) : null}

            <p className="text-tertiary-text text-sm">
              {listing.total} {listing.total === 1 ? "product" : "products"}
              {store.supportEmail ? (
                <>
                  {" · "}
                  <a
                    href={`mailto:${store.supportEmail}`}
                    className="underline underline-offset-4 hover:text-secondary-text"
                  >
                    Contact
                  </a>
                </>
              ) : null}
            </p>
          </div>
        </header>

        {/* The store's own pages, if it has published any. */}
        {customPages.length > 0 ? (
          <nav className="flex flex-wrap gap-2">
            {customPages.map((customPage) => (
              <Link
                key={customPage.slug}
                href={`/store/${store.slug}/${customPage.slug}`}
                className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
              >
                {customPage.title}
              </Link>
            ))}
          </nav>
        ) : null}

        <Separator />

        <ProductGrid
          products={listing.items}
          savedIds={savedIds}
          className={columns}
          emptyTitle="Nothing listed yet"
          emptyBody="This seller has not published any products."
        />

        {totalPages > 1 ? (
          <nav className="flex items-center justify-center gap-2 text-sm">
            {page > 1 ? (
              <Link
                href={`/store/${store.slug}?page=${page - 1}`}
                className="rounded-full border border-border px-4 py-2 hover:bg-surface-2"
              >
                Previous
              </Link>
            ) : null}
            <span className="text-secondary-text">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={`/store/${store.slug}?page=${page + 1}`}
                className="rounded-full border border-border px-4 py-2 hover:bg-surface-2"
              >
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}

        <PlacementSlot route={route} slot="below_content" />
      </div>
    </div>
  );
}
