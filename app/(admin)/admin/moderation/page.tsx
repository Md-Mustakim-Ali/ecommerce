import type { Metadata } from "next";
import { moderationQueueAction } from "@/lib/actions/moderation";
import { openReports } from "@/lib/analytics/reports-heat";
import { requirePlatformPermission } from "@/lib/auth/access";
import { ModerationPanels } from "./moderation-panels";
import { ReportQueue } from "./report-queue";

export const metadata: Metadata = { title: "Moderation" };

export default async function AdminModerationPage() {
  const access = await requirePlatformPermission("platform.product.moderate");
  const { products, reviews } = await moderationQueueAction();

  /*
    Reports sit above the queues rather than in a section of their own.

    They are the same job — deciding whether something should stay up — and the
    difference is only who noticed. Somebody triaging complaints and somebody
    working the pending list are the same person on the same visit, and a
    separate page would mean checking two places to answer one question.

    Read is gated separately from decide, so a role can triage without being
    able to settle anything.
  */
  const canReadReports = access.permissions.has("platform.report.view");
  const reports = canReadReports ? await openReports(50) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Moderation</h1>
        <p className="text-muted-foreground text-sm">
          Listings and reviews. Every action here records who took it and why.
        </p>
      </div>

      {canReadReports ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">
            Reported by buyers
            {reports.length > 0 ? ` · ${reports.length} open` : ""}
          </h2>
          <ReportQueue
            canResolve={access.permissions.has("platform.report.resolve")}
            reports={reports.map((report) => ({
              ...report,
              createdAt: report.createdAt.toISOString(),
            }))}
          />
        </section>
      ) : null}

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
