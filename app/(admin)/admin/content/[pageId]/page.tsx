import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageEditor } from "@/components/dashboard/page-editor";
import { requirePlatformPermission } from "@/lib/auth/access";
import { getPageForEditing } from "@/lib/content/queries";

export const metadata: Metadata = { title: "Edit page" };

export default async function AdminPageEditor({
  params,
}: PageProps<"/admin/content/[pageId]">) {
  const { pageId } = await params;
  await requirePlatformPermission("platform.page.manage");

  const page = await getPageForEditing(pageId, { scope: "platform" });
  if (!page) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/content"
        className="text-secondary-text text-xs underline underline-offset-4"
      >
        Back to content
      </Link>

      <PageEditor
        scope={{ scope: "platform" }}
        pageId={page.id}
        title={page.title}
        slug={page.slug}
        status={page.status}
        publicPath="/pages"
        blocks={page.blocks.map((block) => ({
          id: block.id,
          type: block.type,
          data: block.data ?? {},
        }))}
      />
    </div>
  );
}
