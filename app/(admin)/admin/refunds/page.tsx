import type { Metadata } from "next";
import { listRefundRequestsAction } from "@/lib/actions/refunds";
import { requirePlatformPermission } from "@/lib/auth/access";
import { RefundQueue } from "./refund-queue";

export const metadata: Metadata = { title: "Refunds" };

/**
 * The refund queue.
 *
 * Sellers ask; the platform decides. Approving is the only thing here that
 * writes to the ledger, and it does it through the same recordRefund the rest
 * of the money code uses.
 */
export default async function AdminRefundsPage() {
  await requirePlatformPermission("platform.refund.approve");
  const requests = await listRefundRequestsAction();

  const open = requests.filter((r) => r.status === "requested");
  const owed = open.reduce((sum, r) => sum + r.amountCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Refunds</h1>
        <p className="text-muted-foreground text-sm">
          {open.length} awaiting a decision
          {open.length > 0 ? ` · $${(owed / 100).toFixed(2)} requested` : ""}
        </p>
      </div>

      <RefundQueue
        requests={requests.map((r) => ({
          id: r.id,
          storeName: r.storeName,
          orderNumber: r.orderNumber,
          buyerContact: r.buyerEmail ?? r.buyerPhone ?? "",
          amountCents: r.amountCents,
          grossCents: r.subtotalCents + r.shippingCents,
          currency: r.currency,
          reason: r.reason,
          status: r.status,
          reviewNote: r.reviewNote,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
