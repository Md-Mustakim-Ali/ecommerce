"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmOrderWithCodeAction } from "@/lib/actions/confirm-order";

/**
 * The typed half of confirming an order.
 *
 * Lives on the order page rather than on checkout, and that is a scar. The
 * first version of this flow kept its state in the checkout form, which looked
 * right and was not: placing an order empties the cart, the checkout page
 * re-renders on the server, finds nothing in it and swaps the whole form for
 * "Nothing to check out". The buyer finished checkout and was told their cart
 * was empty.
 *
 * Here it is driven by the order's own status, so it survives a refresh, it is
 * still here when they come back to the link tomorrow, and it works on a
 * different device from the one they checked out on — which is the common case,
 * since the email arrives on a phone.
 */
export function ConfirmCodeForm({
  orderId,
  digits,
}: {
  orderId: string;
  /** How many digits to expect, so the field can size and validate itself. */
  digits: number;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await confirmOrderWithCodeAction({ orderId, code });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      /*
        Straight to Jomma when there is something to pay.

        A full page navigation rather than router.push: the destination is
        another origin, and the client router cannot route to one.
      */
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }

      // Cash on delivery, or already covered. The page re-renders from the new
      // status and this form disappears on its own.
      router.replace(result.path);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <Input
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          // `inputMode` rather than `type="number"`: a numeric keypad on a
          // phone, without the spinner, the scroll-wheel accidents, or losing a
          // leading zero — and this code can begin with one.
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`[0-9]{${digits}}`}
          maxLength={digits}
          placeholder={"0".repeat(digits)}
          aria-label={`${digits}-digit confirmation code`}
          aria-invalid={error ? true : undefined}
          className="w-40 text-center font-mono text-lg tracking-[0.4em]"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || code.trim().length < digits}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Confirm
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
