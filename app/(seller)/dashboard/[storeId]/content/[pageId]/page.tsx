import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageEditor } from "@/components/dashboard/page-editor";
import { requireStorePermission } from "@/lib/auth/access";
import { getPageForEditing } from "@/lib/content/queries";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Edit page" };

export default async function StorePageEditor({
  params,
}: PageProps<"/dashboard/[storeId]/content/[pageId]">) {
  const { storeId, pageId } = await params;
  await requireStorePermission(storeId, "page.view");

  const [store] = await db
    .select({ slug: stores.slug })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) notFound();

  // Scoped to this store, so a page id from another store's content does not
  // resolve however valid the uuid is.
  const page = await getPageForEditing(pageId, { scope: "store", storeId });
  if (!page) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/dashboard/${storeId}/content`}
        className="text-secondary-text text-xs underline underline-offset-4"
      >
        Back to content
      </Link>

      <PageEditor
        scope={{ scope: "store", storeId }}
        pageId={page.id}
        title={page.title}
        slug={page.slug}
        status={page.status}
        publicPath={`/store/${store.slug}`}
        blocks={page.blocks.map((block) => ({
          id: block.id,
          type: block.type,
          data: block.data ?? {},
        }))}
      />
    </div>
  );
}
