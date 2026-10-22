import type { Metadata } from "next";
import {
  recentPayoutsAction,
  storesOwedAction,
} from "@/lib/actions/admin-stores";
import { requirePlatformPermission } from "@/lib/auth/access";
import { formatMoney } from "@/lib/money/format";
import { PayoutRun } from "./payout-run";

export const metadata: Metadata = { title: "Payouts" };

/**
 * The payout run.
 *
 * Every figure here is a SUM over the ledger computed at request time. There is
 * no stored balance to drift, and the amount shown is recomputed again inside
 * the transaction when the button is pressed — so a balance that moves between
 * render and submit stops the payout rather than paying a different number
 * than the one on screen.
 */
export default async function AdminPayoutsPage() {
  await requirePlatformPermission("platform.payout.initiate");

  const [owed, recent] = await Promise.all([
    storesOwedAction(),
    recentPayoutsAction(40),
  ]);

  const payable = owed.filter((s) => s.balanceCents > 0);
  const total = payable.reduce((sum, s) => sum + s.balanceCents, 0);
  const inFlight = recent
    .filter((p) => p.status === "processing" || p.status === "pending")
    .reduce((sum, p) => sum + Number(p.amountCents), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Payouts</h1>
        <p className="text-muted-foreground text-sm">
          {formatMoney(total, "USD")} owed across {payable.length}{" "}
          {payable.length === 1 ? "store" : "stores"} ·{" "}
          {formatMoney(inFlight, "USD")} in flight
        </p>
      </div>

      <PayoutRun
        stores={owed.map((store) => ({
          storeId: store.storeId,
          name: store.name,
          slug: store.slug,
          status: store.status,
          balanceCents: store.balanceCents,
          currency: store.currency,
          inFlightCents: store.inFlightCents,
        }))}
        recent={recent.map((payout) => ({
          id: payout.id,
          storeName: payout.storeName,
          amountCents: Number(payout.amountCents),
          currency: payout.currency,
          status: payout.status,
          providerTransferId: payout.providerTransferId,
          failureReason: payout.failureReason,
          initiatedAt: payout.initiatedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
