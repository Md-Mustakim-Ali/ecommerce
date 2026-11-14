"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { phoneNumber, signIn } from "@/lib/auth/client";
import { classifyIdentifier } from "@/lib/validation/auth";

/**
 * One field, two kinds of account.
 *
 * Somebody who registered months ago should not have to remember whether they
 * used an address or a number, so this works it out instead of asking. The two
 * shapes cannot collide: no email address reduces to 01XXXXXXXXX.
 *
 * An address takes a password; a number takes a code. That split is not a
 * simplification — an account identified by a number is created by proving the
 * number, and never has a password to check.
 */
export function SignInForm({
  next,
  phoneAvailable,
}: {
  next: string;
  /** Whether a code can actually be delivered. Decided on the server. */
  phoneAvailable: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  /** Set once a code is on its way, which switches this to the code step. */
  const [awaitingCode, setAwaitingCode] = useState<string | null>(null);

  const looksLikePhone = classifyIdentifier(identifier).kind === "phone";

  function finish() {
    startTransition(() => {
      router.push(next);
      router.refresh();
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const typed = String(form.get("identifier") ?? "").trim();
    if (!typed) {
      setError("Enter your email or phone number.");
      return;
    }

    const who = classifyIdentifier(typed);

    if (who.kind === "phone") {
      if (!phoneAvailable) {
        setError("Signing in by phone is unavailable right now.");
        return;
      }

      const sent = await phoneNumber.sendOtp({ phoneNumber: who.phone });
      if (sent.error) {
        setError("Could not send your code. Try again in a moment.");
        return;
      }

      // Deliberately the same screen whether or not the number is registered.
      // Saying "no such account" here would turn this form into a way to test
      // which numbers shop with us.
      setAwaitingCode(who.phone);
      return;
    }

    const password = String(form.get("password") ?? "");
    if (!password) {
      setError("Enter your password.");
      return;
    }

    const { error: authError } = await signIn.email({
      email: who.email,
      password,
    });

    if (authError) {
      // Vague, and the same sentence either way: never reveal whether an
      // account exists, and never let the wording say which half was wrong.
      setError("Those details do not match an account.");
      return;
    }

    finish();
  }

  async function handleCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!awaitingCode) return;

    const { error: verifyError } = await phoneNumber.verify({
      phoneNumber: awaitingCode,
      code: code.trim(),
    });

    if (verifyError) {
      setError("That code is not right, or it has expired.");
      return;
    }

    finish();
  }

  if (awaitingCode) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-2xl tracking-tight">
            Enter your code
          </h1>
          <p className="text-secondary-text text-sm">
            If {awaitingCode} has an account, a 6-digit code is on its way.
          </p>
        </div>

        <form onSubmit={handleCode} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" block disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setAwaitingCode(null);
              setCode("");
              setError(null);
            }}
          >
            Use a different number
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="font-semibold text-2xl tracking-tight">Sign in</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="identifier">
            {phoneAvailable ? "Email or phone" : "Email"}
          </Label>
          <Input
            id="identifier"
            name="identifier"
            // Not type="email": the browser would reject a phone number as
            // malformed before this form ever ran.
            type="text"
            inputMode="email"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={
              phoneAvailable ? "you@example.com or 01712345678" : undefined
            }
            required
          />
        </div>

        {/*
          Hidden once what they typed is a number, because that account has no
          password to type. Asking for one and then ignoring it would teach
          buyers their password does not matter.
        */}
        {looksLikePhone && phoneAvailable ? (
          <p className="text-tertiary-text text-xs">
            We will text you a code to sign in.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
        )}

        {error ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending
            ? looksLikePhone
              ? "Sending code…"
              : "Signing in…"
            : looksLikePhone && phoneAvailable
              ? "Send code"
              : "Sign in"}
        </Button>
      </form>

      <p className="text-secondary-text text-sm">
        No account yet?{" "}
        <Link
          href="/sign-up"
          className="text-accent-text underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </main>
  );
}
