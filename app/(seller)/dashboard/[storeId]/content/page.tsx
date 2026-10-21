import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentManager } from "@/components/dashboard/content-manager";
import { requireStorePermission } from "@/lib/auth/access";
import { listPagesInScope, listPlacementsInScope } from "@/lib/content/queries";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Content" };

export default async function StoreContentPage({
  params,
}: PageProps<"/dashboard/[storeId]/content">) {
  const { storeId } = await params;
  await requireStorePermission(storeId, "page.view");

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { slug: true, name: true },
  });
  if (!store) notFound();

  const scope = { scope: "store" as const, storeId };
  const [pages, placements] = await Promise.all([
    listPagesInScope(scope),
    listPlacementsInScope(scope),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-xs underline underline-offset-4"
        >
          Back to store
        </Link>
        <h1 className="font-semibold text-xl tracking-tight">Content</h1>
        <p className="text-secondary-text text-sm">
          Pages and offers for {store.name}. These only ever appear on your own
          store's pages.
        </p>
      </div>

      <ContentManager
        scope={scope}
        pages={pages}
        placements={placements.map((placement) => ({
          id: placement.id,
          type: placement.type,
          slot: placement.slot,
          data: placement.data,
          status: placement.status,
          priority: placement.priority,
          targets: placement.targets,
        }))}
        publicPathPrefix={`/store/${store.slug}`}
      />
    </div>
  );
}
