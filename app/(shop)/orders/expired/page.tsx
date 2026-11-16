import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Link expired" };

/**
 * Where a confirmation link lands when it no longer works.
 *
 * Somebody reaching this did nothing wrong — they clicked a link that sat in
 * an inbox too long, or a mail client mangled it. So it says what happened and
 * what to do, rather than a 404 that reads like an accusation.
 */
const REASONS: Record<string, string> = {
  expired:
    "That link has expired. We hold an unconfirmed order for 24 hours, and this one has passed that, so the items went back on sale.",
  "bad-token":
    "That link is not valid. Some mail apps shorten or rewrite links — try opening it from the original email instead.",
  "not-found": "We cannot find that order.",
  missing: "That link is incomplete.",
};

export default async function ConfirmationExpiredPage({
  searchParams,
}: PageProps<"/orders/expired">) {
  const { reason } = await searchParams;
  const message =
    (typeof reason === "string" ? REASONS[reason] : undefined) ??
    REASONS["bad-token"];

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">
        This link no longer works
      </h1>
      <p className="text-secondary-text text-sm">{message}</p>
      <p className="text-tertiary-text text-xs">
        Nothing was charged. You can put the order together again in a couple of
        minutes.
      </p>
      <Button render={<Link href="/search" />}>Browse products</Button>
    </div>
  );
}
