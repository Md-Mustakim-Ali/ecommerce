"use client";

import { AlertTriangle, CheckCircle2, Loader2, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  checkPaymentStatusAction,
  type PaymentStatusResult,
} from "@/lib/actions/payment-status";
import { formatMoney } from "@/lib/money/format";

/**
 * The waiting card, which now actually waits on something.
 *
 * ── What was here before ─────────────────────────────────────────────────
 *
 * A server-rendered banner with `animate-spin` on an icon. Nothing polled,
 * nothing revalidated, and no code path re-read the order after the first
 * render — so the spinner conveyed activity while the page was inert, and an
 * order that settled two seconds after the buyer landed went on looking pending
 * until they reloaded by hand. A spinner is a promise that something is
 * happening. It has to be kept.
 *
 * ── Why it stops ─────────────────────────────────────────────────────────
 *
 * The intent's TTL is fifteen minutes, after which there is nothing left to
 * wait for and polling would be a tab quietly making requests forever. When the
 * cap is reached the card says so and offers a button, rather than spinning on
 * in silence.
 */

/** The SDK's own advice for this endpoint is every 2–3 seconds. */
const POLL_MS = 3000;
/** Matches INTENT_TTL_SECONDS. Past it, the intent cannot settle. */
const GIVE_UP_MS = 15 * 60 * 1000;

export function PaymentStatus({
  orderId,
  currency,
  /** Rendered until the first poll answers, so the card is never empty. */
  initialTotalCents,
  /**
   * The `?t=` this page was opened with, handed straight back to the action.
   *
   * A guest has no session, so without this the poll answered "Please sign in"
   * on the buyer's own order — under a heading promising the page would update
   * by itself, to somebody who had already paid.
   */
  accessToken,
}: {
  orderId: string;
  currency: string;
  initialTotalCents: number;
  accessToken?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<PaymentStatusResult | null>(null);
  const [stopped, setStopped] = useState(false);

  const poll = useCallback(async () => {
    const result = await checkPaymentStatusAction({ orderId, accessToken });
    setState(result);

    if (!result.ok) return true;

    if (result.orderStatus !== "pending") {
      // The badge, the status line and the seller-facing copy all live in the
      // server component around this one. Without this they would keep showing
      // `pending` beside a card announcing the payment arrived.
      router.refresh();
      return true;
    }

    // Nothing further can arrive against a dead intent, so stop asking.
    // `expired` rather than the raw status: Jomma has been seen leaving intents
    // labelled `open` long past their deadline, and polling one of those is a
    // request that can never come back with different news.
    return result.expired;
  }, [orderId, accessToken, router]);

  useEffect(() => {
    if (stopped) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;

      // Skip the request while the tab is in the background, but keep the loop
      // alive. This is the buyer's other tab: they are on Jomma's pay page, and
      // the poll that matters is the one right after they come back.
      if (document.visibilityState === "visible") {
        let done = false;
        try {
          done = await poll();
        } catch {
          // A failed round trip is not a reason to stop watching. The next tick
          // tries again, and the card keeps showing the last known state.
        }
        if (cancelled) return;
        if (done) {
          setStopped(true);
          return;
        }
      }

      if (Date.now() - startedAt > GIVE_UP_MS) {
        setStopped(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };

    // Immediately, not after the first interval. The buyer has just been
    // redirected back from Jomma, and the answer is usually already true.
    void tick();

    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll, stopped]);

  // Restarts the effect, which polls immediately and resets the give-up clock.
  const checkNow = () => setStopped(false);

  // ── Rendering ──────────────────────────────────────────────────────────

  if (state && !state.ok) {
    return (
      <Card
        tone="warning"
        icon={<AlertTriangle className="size-5" aria-hidden />}
      >
        <p className="font-medium">We could not check this payment</p>
        <p className="text-secondary-text text-sm">{state.message}</p>
      </Card>
    );
  }

  const money = (cents: number) => formatMoney(cents, currency);

  if (state?.ok && state.orderStatus !== "pending") {
    return (
      <Card
        tone="positive"
        icon={<CheckCircle2 className="size-5" aria-hidden />}
      >
        <p className="font-medium">Payment confirmed</p>
        <p className="text-sm opacity-90">
          {money(state.receivedCents || state.totalCents)} received.
          {state.excessCents > 0
            ? ` You sent ${money(state.excessCents)} more than the total — we owe that back to you and will be in touch.`
            : " Your order is confirmed and the seller has been notified."}
        </p>
      </Card>
    );
  }

  /*
    A partial payment.

    This is the case the old banner got actively wrong. It told every waiting
    buyer "you do not need to send anything again", which for a buyer who
    underpaid is false in the one situation where being wrong costs them the
    order — Jomma holds the intent open for exactly this, so the balance is
    payable, and nothing was telling them the amount or where to send it.

    ── Why this card no longer has a button ────────────────────────────────

    It used to offer "Pay the balance", linking to `state.payUrl`. That is this
    intent's pay page, and for the buyer most likely to be reading this card it
    was already dead: somebody who part-paid and let the clock run out gets a
    live-looking link to an expired page, presses it, and it fails.

    Paying is owned by one control now — the panel on the order page below,
    which goes through /api/orders/pay and works the amount out server-side,
    reusing a live intent or raising a new one for the balance. Two buttons
    that claim to do the same job, one of them wrong, is worse than one that is
    right. This card keeps the job it is actually good at: watching.
  */
  if (state?.ok && state.intentStatus === "partial") {
    return (
      <Card
        tone="warning"
        icon={<AlertTriangle className="size-5" aria-hidden />}
      >
        <p className="font-medium">
          {money(state.shortfallCents)} still to pay
        </p>
        <p className="text-secondary-text text-sm">
          We received {money(state.receivedCents)} of {money(state.totalCents)}.
          Send the remaining {money(state.shortfallCents)} to the same number
          {state.refCode ? (
            <>
              {" "}
              using reference <span className="font-mono">{state.refCode}</span>
            </>
          ) : null}
          , and this page will update on its own — or use the payment button
          below to start again.
        </p>
      </Card>
    );
  }

  if (state?.ok && state.expired) {
    return (
      <Card
        tone="warning"
        icon={<AlertTriangle className="size-5" aria-hidden />}
      >
        <p className="font-medium">This payment request has expired</p>
        {/*
          Careful not to claim the stock was released. That happens on the
          `payment.expired` webhook, and this branch is reached precisely when
          Jomma has not sent one — so saying it here would be asserting the
          thing whose absence put the buyer on this screen.
        */}
        <p className="text-secondary-text text-sm">
          The time limit ran out before we could confirm a payment, so nothing
          was taken.{" "}
          {state.receivedCents > 0
            ? `We did receive ${money(state.receivedCents)} against it, which has not been applied — please contact support and quote this order number rather than sending anything else. `
            : "If you did send money, do not send it again — contact support with this order number and we will trace it. "}
          Otherwise you are free to place the order again.
        </p>
      </Card>
    );
  }

  if (state?.ok && !state.reachable) {
    return (
      <Card tone="warning" icon={<WifiOff className="size-5" aria-hidden />}>
        <p className="font-medium">We cannot reach the payment service</p>
        <p className="text-secondary-text text-sm">
          Your payment is not affected — if you have sent it, it will be applied
          as soon as the connection is back. Nothing needs sending again.
        </p>
        <div className="pt-1">
          <Button size="sm" variant="outline" onClick={checkNow}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  if (stopped) {
    return (
      <Card
        tone="neutral"
        icon={<AlertTriangle className="size-5" aria-hidden />}
      >
        <p className="font-medium">Still waiting for this payment</p>
        <p className="text-secondary-text text-sm">
          We have not had confirmation yet. If you have already sent the money
          it is safe — do not send it again. Check once more, or contact support
          with this order number.
        </p>
        <div className="pt-1">
          <Button size="sm" variant="outline" onClick={checkNow}>
            Check again
          </Button>
        </div>
      </Card>
    );
  }

  // The genuine waiting state. The spinner is now honest: a request really is
  // in flight every three seconds behind it.
  return (
    <Card
      tone="neutral"
      icon={
        <Loader2
          className="size-5 animate-spin text-secondary-text"
          aria-hidden
        />
      }
    >
      <p className="font-medium">Checking for your payment</p>
      <p className="text-secondary-text text-sm">
        {state?.ok && state.receivedCents > 0
          ? `${money(state.receivedCents)} of ${money(state.totalCents)} received so far. `
          : "We are confirming this with bKash or Nagad. It usually takes a few seconds. "}
        You do not need to send anything again, and this page updates by itself.
      </p>
      <p className="text-tertiary-text text-xs">
        {money(initialTotalCents)} total
      </p>
    </Card>
  );
}

/** One shell so every state has the same shape and only the tone changes. */
function Card({
  tone,
  icon,
  children,
}: {
  tone: "neutral" | "positive" | "warning";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-2",
    positive: "bg-positive-muted text-positive",
    warning: "border border-[#fab219]/40 bg-[#fab219]/10",
  } as const;

  return (
    /*
      `<output>` rather than a div with role="status" — it carries that role
      natively, which is what this is: the result of a check the page keeps
      running.

      polite, not assertive. The content changes underneath a buyer who is
      reading the rest of the order, and interrupting a screen reader
      mid-sentence to say we are still checking is worse than saying it a
      moment later.
    */
    <output
      aria-live="polite"
      className={`flex items-start gap-3 rounded-xl p-5 ${tones[tone]}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex flex-col gap-1">{children}</div>
    </output>
  );
}
