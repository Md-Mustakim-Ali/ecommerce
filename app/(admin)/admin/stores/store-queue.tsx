"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setStoreStatusAction } from "@/lib/actions/admin-stores";

type Store = {
  id: string;
  name: string;
  slug: string;
  status: "pending" | "active" | "suspended" | "closed";
  description: string | null;
  createdAt: Date;
  ownerEmail: string;
  productCount: number;
};

const BADGE = {
  pending: "neutral",
  active: "positive",
  suspended: "critical",
  closed: "outline",
} as const;

/**
 * The store approval queue.
 *
 * Pending first, because the queue exists to be cleared. Suspension requires a
 * reason — a store taken offline with no recorded explanation is a support
 * conversation nobody can resolve, and the reason lands in the audit log next
 * to who did it.
 */
export function StoreQueue({
  stores,
  canApprove,
  canSuspend,
}: {
  stores: Store[];
  canApprove: boolean;
  canSuspend: boolean;
}) {
  if (stores.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
        No stores yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-px overflow-hidden rounded-lg bg-border">
      {stores.map((store) => (
        <li key={store.id} className="bg-background">
          <Row store={store} canApprove={canApprove} canSuspend={canSuspend} />
        </li>
      ))}
    </ul>
  );
}

function Row({
  store,
  canApprove,
  canSuspend,
}: {
  store: Store;
  canApprove: boolean;
  canSuspend: boolean;
}) {
  const [suspending, setSuspending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(status: Store["status"], reason?: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await setStoreStatusAction({
        storeId: store.id,
        status,
        reason,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
      setSuspending(false);
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium text-sm">
            {store.name}
            <Badge variant={BADGE[store.status]}>{store.status}</Badge>
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {store.ownerEmail} · {store.productCount}{" "}
            {store.productCount === 1 ? "product" : "products"} · joined{" "}
            {store.createdAt.toLocaleDateString()}
          </span>
          {store.description ? (
            <span className="line-clamp-1 text-muted-foreground text-xs">
              {store.description}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/store/${store.slug}`}
            className="text-muted-foreground text-xs underline underline-offset-4"
          >
            View
          </Link>

          {store.status !== "active" && canApprove ? (
            <Button size="sm" disabled={pending} onClick={() => move("active")}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              {store.status === "pending" ? "Approve" : "Reinstate"}
            </Button>
          ) : null}

          {store.status === "active" && canSuspend ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setSuspending((v) => !v)}
            >
              Suspend
            </Button>
          ) : null}
        </div>
      </div>

      {suspending ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(
              new FormData(event.currentTarget).get("reason") ?? "",
            );
            move("suspended", reason);
          }}
        >
          <div className="flex-1">
            <Input
              name="reason"
              placeholder="Why is this store being suspended?"
              required
              maxLength={300}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Suspend and hide
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSuspending(false)}
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
        <output className="block text-xs text-muted-foreground">
          {message}
        </output>
      ) : null}
    </div>
  );
}
