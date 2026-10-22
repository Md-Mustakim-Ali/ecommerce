import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { platformAuditAction } from "@/lib/actions/moderation";
import { requirePlatformPermission } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Audit log" };

/** Names an action in a sentence a person can read. */
const LABEL: Record<string, string> = {
  "role.create": "created a role",
  "role.update": "edited a role",
  "role.delete": "deleted a role",
  "member.invite": "invited someone",
  "member.remove": "removed someone",
  "member.assign_role": "changed someone's roles",
  "order.cancel": "cancelled an order",
  "order.refund.request": "requested a refund on",
  "store.profile.update": "renamed a store",
  "discount.create": "created a discount",
  "platform.store.active": "approved a store",
  "platform.store.suspended": "suspended a store",
  "platform.payout.initiate": "sent a payout to",
  "platform.payout.paid": "confirmed a payout",
  "platform.payout.failed": "failed a payout",
  "platform.refund.approved": "approved a refund",
  "platform.refund.rejected": "rejected a refund",
  "platform.product.moderate": "took down",
  "platform.review.removed": "removed a review",
  "platform.attribute.merge": "merged an attribute value",
  "platform.user.suspend": "suspended",
  "platform.category.create": "added a category",
  "platform.category.delete": "removed a category",
  "brand.approve": "approved a brand",
  "brand.reject": "rejected a brand",
  "brand.merge": "merged a brand",
  "tag.approve": "approved a tag",
  "tag.reject": "rejected a tag",
  "tag.merge": "merged a tag",
  "platform.attribute.approved": "approved an attribute",
  "platform.attribute.rejected": "rejected an attribute",
  "platform.review.flagged": "flagged a review",
  "platform.review.published": "restored a review",
  "discount.published": "published a discount",
  "discount.archived": "archived a discount",
  "discount.draft": "paused a discount",
};

/**
 * Every privileged action, platform-wide.
 *
 * Append-only and never edited, which is the point: when somebody asks who
 * suspended a store or who approved a refund, this is the only thing that can
 * answer, and an audit log that could be edited would answer nothing.
 */
export default async function AdminAuditPage() {
  await requirePlatformPermission("platform.audit.view");
  const entries = await platformAuditAction({ limit: 150 });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          {entries.length} most recent. Kept permanently and never edited.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
          Nothing recorded yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 bg-background px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">
                  <span className="font-medium">
                    {entry.actorEmail ?? "System"}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {LABEL[entry.action] ?? entry.action}
                  </span>
                  {entry.targetLabel ? (
                    <span className="font-medium"> {entry.targetLabel}</span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                  {entry.storeName ? (
                    <Badge variant="outline">{entry.storeName}</Badge>
                  ) : (
                    <Badge variant="outline">platform</Badge>
                  )}
                  {entry.targetType ?? ""}
                </span>
              </div>
              <time
                dateTime={entry.createdAt.toISOString()}
                className="shrink-0 text-muted-foreground text-xs"
              >
                {entry.createdAt.toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
