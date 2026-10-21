import { asc, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { requireStorePermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { NewProductForm } from "./new-product-form";

export const metadata: Metadata = { title: "Add a product" };

export default async function NewProductPage({
  params,
}: PageProps<"/dashboard/[storeId]/products/new">) {
  const { storeId } = await params;

  // The gate. Redirects or 403s before anything renders.
  const access = await requireStorePermission(storeId, "product.create");

  // Only leaf categories are selectable — a product belongs to "Headphones",
  // not to "Electronics".
  const leaves = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(isNotNull(categories.parentId))
    .orderBy(asc(categories.name));

  const leafIds = new Set(leaves.map((c) => c.id));
  const parents = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories);
  const hasChildren = new Set(
    parents.map((c) => c.parentId).filter((id): id is string => id !== null),
  );
  const selectable = leaves.filter(
    (c) => leafIds.has(c.id) && !hasChildren.has(c.id),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-xs underline underline-offset-4"
        >
          Back to store
        </Link>
        <h1 className="font-semibold text-xl tracking-tight">Add a product</h1>
      </div>

      <NewProductForm
        storeId={storeId}
        categories={selectable}
        canPublish={access.permissions.has("product.publish")}
        canProposeBrand={access.permissions.has("brand.propose")}
        canProposeTag={access.permissions.has("tag.propose")}
      />
    </div>
  );
}
