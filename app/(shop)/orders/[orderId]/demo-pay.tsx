"use client";

import { FlaskConical, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmDemoPaymentAction } from "@/lib/actions/demo-payment";

/**
 * Settles an order without charging anything.
 *
 * Deliberately looks like what it is. A demo control styled as a real payment
 * button is how a screenshot ends up in a pitch deck implying the platform
 * takes card payments, so this one is labelled, tinted as a warning, and says
 * plainly that no money moves.
 *
 * The work behind it is not fake: it runs the same ledger write the payment
 * webhook runs, so sub-orders, commission splits and payouts downstream are all
 * exercising real code on real numbers.
 */
export function DemoPayButton({
  orderId,
  totalLabel,
  /** As for the waiting card: what authorises a guest testing this locally. */
  accessToken,
}: {
  orderId: string;
  totalLabel: string;
  accessToken?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#fab219]/40 bg-[#fab219]/10 p-5">
      <div className="flex items-start gap-3">
        <FlaskConical
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-[#fab219]"
        />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-sm">Awaiting payment</p>
          <p className="text-secondary-text text-sm">
            No payment provider is connected yet, so nothing can be charged.
            Confirming marks this order paid and runs the real ledger split, so
            the seller sees it and payouts add up — but no money moves.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await confirmDemoPaymentAction({
                orderId,
                accessToken,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.refresh();
            });
          }}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Mark {totalLabel} as paid (demo)
        </Button>
      </div>
    </div>
  );
}
