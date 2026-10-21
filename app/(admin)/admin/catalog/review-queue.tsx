"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approveTermAction,
  mergeTermsAction,
  rejectTermAction,
} from "@/lib/actions/catalog-terms";
import type { TermKind } from "@/lib/catalog/terms";

type Candidate = { id: string; name: string; score: number };

export type PendingItem = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  candidates: Candidate[];
  usage: number;
};

/**
 * The approval queue.
 *
 * Merge candidates are computed per row and shown inline, because the whole
 * failure this workflow exists to prevent is a reviewer approving "Samsng"
 * without noticing "Samsung" is already there. Making them look for it would
 * reproduce the problem.
 */
export function ReviewQueue({
  kind,
  items,
}: {
  kind: TermKind;
  items: PendingItem[];
}) {
  const heading = kind === "brand" ? "Brands" : "Tags";

  if (items.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">{heading}</h2>
        <p className="rounded-md border border-border border-dashed bg-surface-1 px-4 py-6 text-center text-secondary-text text-sm">
          Nothing waiting. New submissions appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium text-sm">
        {heading}{" "}
        <span className="text-secondary-text">({items.length} waiting)</span>
      </h2>
      <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
        {items.map((item) => (
          <ReviewRow key={item.id} kind={kind} item={item} />
        ))}
      </ul>
    </section>
  );
}

function ReviewRow({ kind, item }: { kind: TermKind; item: PendingItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  function run(work: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await work();
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 bg-surface-1 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{item.name}</span>
          <span className="font-mono text-tertiary-text text-xs">
            {item.slug}
            {item.usage > 0
              ? ` · used by ${item.usage} product${item.usage === 1 ? "" : "s"}`
              : " · not used yet"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => approveTermAction({ kind, id: item.id }))}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setRejecting((v) => !v)}
          >
            Reject
          </Button>
        </div>
      </div>

      {item.candidates.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
          <p className="text-secondary-text text-xs">
            Looks similar to an approved {kind}. Merging moves its products
            across and keeps existing links resolving.
          </p>
          <ul className="flex flex-wrap gap-2">
            {item.candidates.map((candidate) => (
              <li key={candidate.id}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      mergeTermsAction({
                        kind,
                        loserId: item.id,
                        survivorId: candidate.id,
                      }),
                    )
                  }
                >
                  Merge into {candidate.name}
                  <Badge variant="outline" className="ml-1">
                    {Math.round(Number(candidate.score) * 100)}%
                  </Badge>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rejecting ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(
              new FormData(event.currentTarget).get("reason") ?? "",
            ).trim();
            if (reason.length === 0) return;
            run(() => rejectTermAction({ kind, id: item.id, reason }));
            setRejecting(false);
          }}
        >
          <Input
            name="reason"
            required
            maxLength={200}
            placeholder="Why is this being rejected?"
            className="max-w-sm flex-1"
          />
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            Confirm rejection
          </Button>
        </form>
      ) : null}

      {message ? (
        <output className="text-secondary-text text-xs">{message}</output>
      ) : null}
    </li>
  );
}
