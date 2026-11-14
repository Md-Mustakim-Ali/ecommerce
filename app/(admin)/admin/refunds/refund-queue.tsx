"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reviewRefundAction } from "@/lib/actions/refunds";
import { formatMoney } from "@/lib/money/format";

type Request = {
  id: string;
  storeName: string;
  orderNumber: string;
  /** Email or phone, whichever the order was placed with. */
  buyerContact: string;
  amountCents: number;
  grossCents: number;
  currency: string;
  reason: string;
  status: "requested" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
};

const BADGE = {
  requested: "neutral",
  approved: "positive",
  rejected: "critical",
} as const;

export function RefundQueue({ requests }: { requests: Request[] }) {
  if (requests.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
        No refund requests.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
      {requests.map((request) => (
        <li key={request.id} className="bg-background">
          <Row request={request} />
        </li>
      ))}
    </ul>
  );
}

function Row({ request }: { request: Request }) {
  const [deciding, setDeciding] = useState<"approved" | "rejected" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const partial = request.amountCents < request.grossCents;

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
            {request.orderNumber}
            <Badge variant={BADGE[request.status]}>{request.status}</Badge>
            {partial ? <Badge variant="outline">partial</Badge> : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {request.storeName} · {request.buyerContact} ·{" "}
            {new Date(request.createdAt).toLocaleDateString()}
          </span>
          <span className="text-muted-foreground text-xs">
            {request.reason}
          </span>
          {request.reviewNote ? (
            <span className="text-muted-foreground text-xs">
              Decision: {request.reviewNote}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <span className="tabular-nums text-sm">
            {formatMoney(request.amountCents, request.currency)}
            {partial ? (
              <span className="text-muted-foreground">
                {" "}
                of {formatMoney(request.grossCents, request.currency)}
              </span>
            ) : null}
          </span>

          {request.status === "requested" && deciding === null ? (
            <span className="flex gap-1">
              <Button size="sm" onClick={() => setDeciding("approved")}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeciding("rejected")}
              >
                Reject
              </Button>
            </span>
          ) : null}
        </div>
      </div>

      {deciding ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const note = String(
              new FormData(event.currentTarget).get("note") ?? "",
            );
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await reviewRefundAction({
                requestId: request.id,
                decision: deciding,
                note,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setMessage(result.message);
              setDeciding(null);
            });
          }}
        >
          <div className="flex-1">
            <Input
              name="note"
              required={deciding === "rejected"}
              maxLength={300}
              placeholder={
                deciding === "approved"
                  ? "Note (optional)"
                  : "Why is this being rejected?"
              }
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant={deciding === "rejected" ? "destructive" : "default"}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {deciding === "approved"
              ? `Refund ${formatMoney(request.amountCents, request.currency)}`
              : "Reject"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDeciding(null)}
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
