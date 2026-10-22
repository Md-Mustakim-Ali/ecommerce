import type { Metadata } from "next";
import { categoryTreeAction } from "@/lib/actions/moderation";
import { requirePlatformPermission } from "@/lib/auth/access";
import { CategoryTree } from "./category-tree";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  await requirePlatformPermission("platform.category.manage");
  const categories = await categoryTreeAction();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Categories</h1>
        <p className="text-muted-foreground text-sm">
          The global tree. Every store lists into the same one, which is what
          makes a category page worth having.
        </p>
      </div>

      <CategoryTree categories={categories} />
    </div>
  );
}
