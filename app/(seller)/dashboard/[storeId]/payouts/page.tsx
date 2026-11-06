import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { listStoreRefundsAction } from "@/lib/actions/refunds";
import { requireStorePermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { payouts, stores } from "@/lib/db/schema";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import { storeBalance, storeLedger } from "@/lib/money/ledger";

export const metadata: Metadata = { title: "Payouts" };

const ENTRY_LABEL: Record<string, string> = {
  sale: "Sale",
  commission: "Commission",
  refund: "Refund",
  adjustment: "Adjustment",
  payout: "Payout",
  fee: "Fee",
};

const REFUND_BADGE: Record<
  string,
  "default" | "muted" | "neutral" | "positive" | "critical"
> = {
  pending: "neutral",
  approved: "positive",
  rejected: "critical",
  processed: "positive",
};

const PAYOUT_BADGE: Record<
  string,
  "default" | "muted" | "neutral" | "positive" | "critical"
> = {
  pending: "neutral",
  processing: "muted",
  paid: "positive",
  failed: "critical",
};

/**
 * What the store has earned and what has been sent.
 *
 * The balance is a SUM over the ledger computed at request time, never a stored
 * column — same rule as everywhere else money is involved. If this number is
 * wrong, the ledger is wrong, and there is no third place for the two to
 * disagree.
 *
 * The ledger table is gated separately from the balance. `payout.view` answers
 * "how much am I owed"; `ledger.view` answers "which sales made it up", and a
 * bookkeeper may reasonably have one without the other.
 */
export default async function StorePayoutsPage({
  params,
}: PageProps<"/dashboard/[storeId]/payouts">) {
  const { storeId } = await params;
  const access = await requireStorePermission(storeId, "payout.view");

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true },
  });
  if (!store) notFound();

  const canReadLedger = access.permissions.has("ledger.view");

  const [balance, history, entries, refunds] = await Promise.all([
    storeBalance(db, storeId, PLATFORM_CURRENCY),
    db
      .select()
      .from(payouts)
      .where(eq(payouts.storeId, storeId))
      .orderBy(desc(payouts.createdAt))
      .limit(20),
    canReadLedger ? storeLedger(db, storeId, 50) : Promise.resolve([]),
    // A seller who files a refund request and never sees what happened to it
    // has filed it into a void — and the money leaves their balance either
    // way, so this is the only place the two can be reconciled.
    listStoreRefundsAction(storeId),
  ]);

  const inFlight = history
    .filter((p) => p.status === "pending" || p.status === "processing")
    .reduce((sum, p) => sum + p.amountCents, BigInt(0));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">Payouts</h1>
          <p className="text-secondary-text text-sm">{store.name}</p>
        </div>
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-sm hover:underline"
        >
          Back to store
        </Link>
      </div>

      <div className="grid gap-px overflow-hidden rounded-md bg-border sm:grid-cols-2">
        <div className="flex flex-col gap-1 bg-surface-1 px-4 py-3">
          <span className="text-secondary-text text-xs">Current balance</span>
          <span className="tabular font-semibold text-2xl">
            {formatMoney(balance, PLATFORM_CURRENCY)}
          </span>
          <span className="text-tertiary-text text-xs">
            Sales less commission and anything already paid out.
          </span>
        </div>
        <div className="flex flex-col gap-1 bg-surface-1 px-4 py-3">
          <span className="text-secondary-text text-xs">In flight</span>
          <span className="tabular font-semibold text-2xl">
            {formatMoney(inFlight, PLATFORM_CURRENCY)}
          </span>
          <span className="text-tertiary-text text-xs">
            Payouts initiated but not yet confirmed by the bank.
          </span>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm">Payout history</h2>
        {history.length === 0 ? (
          <p className="rounded-md border border-border border-dashed px-4 py-6 text-center text-secondary-text text-sm">
            No payouts yet. Your balance is sent on the platform's payout run.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
            {history.map((payout) => (
              <li
                key={payout.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-surface-1 px-4 py-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="tabular font-medium text-sm">
                    {formatMoney(payout.amountCents, payout.currency)}
                  </span>
                  <span className="text-tertiary-text text-xs">
                    {(
                      payout.completedAt ??
                      payout.initiatedAt ??
                      payout.createdAt
                    ).toLocaleDateString()}
                    {payout.providerTransferId
                      ? ` · ${payout.providerTransferId}`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {payout.failureReason ? (
                    <span className="text-critical text-xs">
                      {payout.failureReason}
                    </span>
                  ) : null}
                  <Badge variant={PAYOUT_BADGE[payout.status] ?? "neutral"}>
                    {payout.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-sm">Refund requests</h2>
          <p className="text-secondary-text text-xs">
            You ask; the platform decides. Nothing moves until it is approved,
            and an approval shows up in the ledger below as its own entry.
          </p>
        </div>

        {refunds.length === 0 ? (
          <p className="rounded-md border border-border border-dashed px-4 py-6 text-center text-secondary-text text-sm">
            No refunds requested.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
            {refunds.map((refund) => (
              <li
                key={refund.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-surface-1 px-4 py-3"
              >
                <span className="tabular shrink-0 font-medium text-sm">
                  {formatMoney(refund.amountCents, PLATFORM_CURRENCY)}
                </span>
                <span className="min-w-0 flex-1 truncate text-secondary-text text-sm">
                  {refund.reason}
                </span>
                {/*
                  The reviewer's note is the whole point of showing a rejection.
                  "Rejected" alone tells a seller nothing they can act on.
                */}
                {refund.reviewNote ? (
                  <span className="w-full text-tertiary-text text-xs">
                    {refund.reviewNote}
                  </span>
                ) : null}
                <Badge variant={REFUND_BADGE[refund.status] ?? "neutral"}>
                  {refund.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-sm">Ledger</h2>
          <p className="text-secondary-text text-xs">
            Every entry that makes up the balance. Append-only — a correction is
            a new entry, never an edit.
          </p>
        </div>

        {!canReadLedger ? (
          <p className="text-tertiary-text text-xs">
            <Badge variant="outline">Restricted</Badge> Your role can see the
            balance but not the individual entries.
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-md border border-border border-dashed px-4 py-6 text-center text-secondary-text text-sm">
            Nothing recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="border-border border-b bg-surface-2 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium text-xs">Date</th>
                  <th className="px-3 py-2 font-medium text-xs">Type</th>
                  <th className="px-3 py-2 font-medium text-xs">Description</th>
                  <th className="px-3 py-2 text-right font-medium text-xs">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-border border-b last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-secondary-text text-xs">
                      {entry.createdAt.toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {ENTRY_LABEL[entry.type] ?? entry.type}
                    </td>
                    <td className="px-3 py-2 text-secondary-text text-xs">
                      {entry.description}
                    </td>
                    <td
                      className={`tabular whitespace-nowrap px-3 py-2 text-right text-xs ${
                        entry.amountCents < BigInt(0)
                          ? "text-secondary-text"
                          : "text-positive"
                      }`}
                    >
                      {entry.amountCents > BigInt(0) ? "+" : ""}
                      {formatMoney(entry.amountCents, entry.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
