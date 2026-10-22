import type { Metadata } from "next";
import { moderationQueueAction } from "@/lib/actions/moderation";
import { requirePlatformPermission } from "@/lib/auth/access";
import { ModerationPanels } from "./moderation-panels";

export const metadata: Metadata = { title: "Moderation" };

export default async function AdminModerationPage() {
  const access = await requirePlatformPermission("platform.product.moderate");
  const { products, reviews } = await moderationQueueAction();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Moderation</h1>
        <p className="text-muted-foreground text-sm">
          Listings and reviews. Every action here records who took it and why.
        </p>
      </div>

      <ModerationPanels
        products={products.map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          status: p.status,
          storeName: p.storeName,
          createdAt: p.createdAt.toISOString(),
        }))}
        reviews={reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          title: r.title,
          body: r.body,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          productTitle: r.productTitle,
          productSlug: r.productSlug,
          authorName: r.authorName,
        }))}
        canModerateReviews={access.permissions.has("platform.review.moderate")}
      />
    </div>
  );
}
