"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveReportsAction } from "@/lib/actions/reports";
import { formatDateTime } from "@/lib/datetime/format";

/**
 * Reports waiting for a decision.
 *
 * ── Grouped by what was reported, not listed one per row ─────────────────
 *
 * Six people reporting the same listing is one decision, not six, and a flat
 * list makes an admin read the same complaint six times and then make the same
 * call six times — with nothing stopping them deciding differently on the
 * fourth. Grouping also puts the number that matters in front of them: one
 * report is somebody's opinion, six is a pattern.
 *
 * ── Upholding removes nothing ────────────────────────────────────────────
 *
 * Saying "yes, this is a problem" and taking the listing down are two acts with
 * two permissions, and this does only the first. The link to the product is
 * right there for the second. Collapsing them would mean whoever can triage
 * complaints can also unpublish anything on the platform.
 */

export type QueuedReport = {
  id: string;
  targetType: string;
  targetId: string;
  storeId: string;
  storeName: string;
  productTitle: string | null;
  reason: string;
  detail: string | null;
  status: string;
  reporterEmail: string | null;
  createdAt: string;
};

const REASON_LABEL: Record<string, string> = {
  counterfeit: "Counterfeit",
  prohibited: "Prohibited",
  misleading: "Misleading",
  intellectual_property: "IP",
  offensive: "Offensive",
  spam: "Spam",
  other: "Other",
};

export function ReportQueue({
  reports,
  canResolve,
}: {
  reports: QueuedReport[];
  canResolve: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (reports.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed p-6 text-center text-secondary-text text-sm">
        Nothing reported. Quiet is good.
      </p>
    );
  }

  // One entry per thing reported, carrying every report against it.
  const groups = new Map<string, QueuedReport[]>();
  for (const report of reports) {
    const key = `${report.targetType}:${report.targetId}`;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }

  function decide(ids: string[], status: "upheld" | "dismissed" | "reviewing") {
    setError(null);
    startTransition(async () => {
      const result = await resolveReportsAction({ reportIds: ids, status });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      {[...groups.entries()].map(([key, group]) => {
        const first = group[0];
        const ids = group.map((report) => report.id);

        return (
          <article
            key={key}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate font-medium text-sm">
                  {first.productTitle ?? first.storeName}
                </p>
                <p className="text-secondary-text text-xs">
                  {first.targetType} · {first.storeName} · oldest{" "}
                  {formatDateTime(first.createdAt)}
                </p>
              </div>

              {/*
                The count is the headline. One report is an opinion; six about
                the same listing is the thing worth looking at first.
              */}
              <Badge variant={group.length > 2 ? "critical" : "neutral"}>
                {group.length} {group.length === 1 ? "report" : "reports"}
              </Badge>
            </div>

            <ul className="flex flex-col gap-1.5">
              {group.map((report) => (
                <li key={report.id} className="text-xs">
                  <span className="font-medium">
                    {REASON_LABEL[report.reason] ?? report.reason}
                  </span>
                  {report.detail ? (
                    <span className="text-secondary-text">
                      {" "}
                      — {report.detail}
                    </span>
                  ) : null}
                  <span className="text-tertiary-text">
                    {" "}
                    · {report.reporterEmail ?? "unknown"}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              {/*
                The way to act on it, kept separate from the decision. Taking
                the listing down is its own permission and its own audit entry.
              */}
              {first.targetType === "product" ? (
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href="/admin/moderation">Open moderation</Link>}
                />
              ) : null}

              {canResolve ? (
                <>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => decide(ids, "upheld")}
                  >
                    {pending ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : null}
                    Uphold
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => decide(ids, "dismissed")}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => decide(ids, "reviewing")}
                  >
                    I am looking at it
                  </Button>
                </>
              ) : (
                <span className="text-tertiary-text text-xs">
                  Your role can read reports but not decide them.
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
