"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The one control that starts a payment.
 *
 * ── Why it is a client component for what is only a link ─────────────────
 *
 * Because of what happens behind it. /api/orders/pay asks Jomma whether the
 * existing intent is still alive and, if it is not, raises a new one — two
 * calls to a service on a free instance that sleeps after fifteen minutes
 * idle. Warm that round trip is about a fifth of a second; cold it is the
 * thirty to sixty seconds the instance takes to wake.
 *
 * A plain `<a>` gives nothing back during that. The page does not change, the
 * button does not change, and the only sign anything is happening is the
 * browser's own tab spinner — which on a phone is easy to miss entirely. The
 * honest reading of that screen is "it is broken", so people press it again,
 * which is both wasted and mildly risky.
 *
 * So the click is kept as a real navigation — no fetch, no routing, the
 * browser handles the redirect chain to Jomma — and the only thing added is
 * saying so. `disabled` after the first press stops the double-click too.
 *
 * The slowness itself is not fixable from this side: it is a cold start on the
 * payment service, and the fix for that is a paid instance or a keep-warm
 * ping, not a change here.
 */
export function PayButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const [going, setGoing] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={going}
        render={
          // Still an anchor: the destination is another origin, and letting the
          // browser own the navigation is what makes the back button behave.
          <a
            href={href}
            onClick={() => setGoing(true)}
            aria-disabled={going || undefined}
          >
            {going ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {children}
          </a>
        }
      />

      {/*
        Only after they press, and deliberately naming the wait rather than
        apologising for it. Somebody told "this can take up to a minute" waits;
        somebody told nothing assumes it failed.
      */}
      {going ? (
        <p aria-live="polite" className="text-secondary-text text-sm">
          Opening the payment page. This can take up to a minute the first time
          — please do not press it again.
        </p>
      ) : null}
    </div>
  );
}
