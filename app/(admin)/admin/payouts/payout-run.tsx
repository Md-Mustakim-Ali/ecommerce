"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  initiatePayoutAction,
  settlePayoutAction,
} from "@/lib/actions/admin-stores";
import { formatMoney } from "@/lib/money/format";

type OwedStore = {
  storeId: string;
  name: string;
  slug: string;
  status: string;
  balanceCents: number;
  currency: string;
  inFlightCents: number;
};

type Payout = {
  id: string;
  storeName: string;
  amountCents: number;
  currency: string;
  status: string;
  providerTransferId: string | null;
  failureReason: string | null;
  initiatedAt: string | null;
};

const PAYOUT_BADGE: Record<
  string,
  "neutral" | "muted" | "positive" | "critical"
> = {
  pending: "neutral",
  processing: "muted",
  paid: "positive",
  failed: "critical",
};

export function PayoutRun({
  stores,
  recent,
}: {
  stores: OwedStore[];
  recent: Payout[];
}) {
  const payable = stores.filter((s) => s.balanceCents > 0);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm">Owed</h2>

        {payable.length === 0 ? (
          <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
            Nothing owed. Every store is settled.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
            {payable.map((store) => (
              <li key={store.storeId} className="bg-background">
                <OwedRow store={store} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm">Recent payouts</h2>

        {recent.length === 0 ? (
          <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
            No payouts yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
            {recent.map((payout) => (
              <li key={payout.id} className="bg-background">
                <PayoutRow payout={payout} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OwedRow({ store }: { store: OwedStore }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const blocked = store.status !== "active";
  const hasInFlight = store.inFlightCents > 0;

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium text-sm">
            {store.name}
            {blocked ? <Badge variant="critical">{store.status}</Badge> : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {hasInFlight
              ? `${formatMoney(store.inFlightCents, store.currency)} already in flight`
              : "Nothing in flight"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-semibold tabular-nums">
            {formatMoney(store.balanceCents, store.currency)}
          </span>

          {confirming ? (
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setMessage(null);
                  startTransition(async () => {
                    const result = await initiatePayoutAction({
                      storeId: store.storeId,
                      currency: store.currency,
                      // What is on screen. The server recomputes and refuses
                      // if the two disagree.
                      expectedCents: store.balanceCents,
                    });
                    if (!result.ok) {
                      setError(result.message);
                      setConfirming(false);
                      return;
                    }
                    setMessage(result.message);
                    setConfirming(false);
                  });
                }}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : null}
                Yes, send it
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={blocked || pending}
              onClick={() => setConfirming(true)}
            >
              {blocked ? "Blocked" : "Pay out"}
            </Button>
          )}
        </div>
      </div>

      {/*
        Money leaving is the one action here that cannot be undone by pressing
        the button again, so it gets a sentence naming the amount and the
        recipient rather than a bare confirm.
      */}
      {confirming ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Send {formatMoney(store.balanceCents, store.currency)} to{" "}
            {store.name}. This debits their balance immediately and cannot be
            reversed except by marking the payout failed.
          </span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-xs">
          {message}
        </output>
      ) : null}
    </div>
  );
}

function PayoutRow({ payout }: { payout: Payout }) {
  const [settling, setSettling] = useState<"paid" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = payout.status === "processing" || payout.status === "pending";

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-sm">{payout.storeName}</span>
          <span className="text-muted-foreground text-xs">
            {payout.initiatedAt
              ? new Date(payout.initiatedAt).toLocaleString()
              : "—"}
            {payout.providerTransferId ? ` · ${payout.providerTransferId}` : ""}
            {payout.failureReason ? ` · ${payout.failureReason}` : ""}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="tabular-nums text-sm">
            {formatMoney(payout.amountCents, payout.currency)}
          </span>
          <Badge variant={PAYOUT_BADGE[payout.status] ?? "neutral"}>
            {payout.status}
          </Badge>

          {open && settling === null ? (
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSettling("paid")}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSettling("failed")}
              >
                Failed
              </Button>
            </span>
          ) : null}
        </div>
      </div>

      {settling ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await settlePayoutAction({
                payoutId: payout.id,
                status: settling,
                providerTransferId:
                  settling === "paid"
                    ? String(data.get("reference") ?? "")
                    : undefined,
                failureReason:
                  settling === "failed"
                    ? String(data.get("reference") ?? "")
                    : undefined,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(result.message);
              setSettling(null);
            });
          }}
        >
          <div className="flex-1">
            <Input
              name="reference"
              required={settling === "failed"}
              placeholder={
                settling === "paid"
                  ? "Bank reference (optional)"
                  : "Why did it fail?"
              }
              maxLength={300}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant={settling === "failed" ? "destructive" : "default"}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {settling === "paid" ? "Mark paid" : "Mark failed and refund"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSettling(null)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {message ? (
        <output className="block text-muted-foreground text-xs">
          {message}
        </output>
      ) : null}
    </div>
  );
}
