"use client";

import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/actions/report-error";

/**
 * The error boundary for everything below the root layout.
 *
 * Without this a thrown error in any page renders Next's default screen, which
 * in production is a bare "Application error" with no way forward and no
 * record that it happened.
 *
 * `digest` is the only detail shown. Next replaces production error messages
 * with an opaque hash precisely so an exception cannot leak a query, a path or
 * a stack trace to whoever triggered it — printing the message here would undo
 * that. The digest is enough for support to find the matching server log.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reported from the client, because this boundary only runs there — the
    // server-side throw is already logged where it happened, but a hydration
    // or render error in the browser would otherwise be invisible.
    void reportClientError({
      message: error.message,
      digest: error.digest,
      path: window.location.pathname,
    });
  }, [error]);

  return (
    // <main> for the same reason as not-found: an error boundary can replace a
    // page that had the layout's landmark, and losing it strands anyone
    // navigating by landmark.
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-xl tracking-tight">
          Something went wrong
        </h1>
        <p className="text-secondary-text text-sm leading-relaxed">
          This one is on us, not you. Trying again often works — the page may
          have been in the middle of something.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCw aria-hidden />
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/" />}>
          Back to the marketplace
        </Button>
      </div>

      {error.digest ? (
        <p className="text-tertiary-text text-xs">
          Reference <span className="font-mono">{error.digest}</span> — quote
          this if you contact us.
        </p>
      ) : null}
    </main>
  );
}
