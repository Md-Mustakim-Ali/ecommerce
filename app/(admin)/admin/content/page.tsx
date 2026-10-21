import type { Metadata } from "next";
import { ContentManager } from "@/components/dashboard/content-manager";
import { requirePlatformPermission } from "@/lib/auth/access";
import { listPagesInScope, listPlacementsInScope } from "@/lib/content/queries";

export const metadata: Metadata = { title: "Content" };

export default async function AdminContentPage() {
  await requirePlatformPermission("platform.page.manage");

  const scope = { scope: "platform" as const };
  const [pages, placements] = await Promise.all([
    listPagesInScope(scope),
    listPlacementsInScope(scope),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl">Content</h1>
        <p className="text-secondary-text text-sm">
          Site-wide pages, banners and offers. Store owners manage their own
          separately.
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
        publicPathPrefix="/pages"
      />
    </div>
  );
}
