"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, phoneNumber, signUp } from "@/lib/auth/client";
import { MIN_PASSWORD_LENGTH, signUpSchema } from "@/lib/validation/auth";
import { normaliseBdMobile } from "@/lib/validation/phone";

/**
 * Registration with either contact, or both.
 *
 * Both is worth having and worth explaining: an account claims the guest
 * orders placed with each contact it verifies, so somebody who ordered once
 * with an address and once with a number gets one history rather than half of
 * it. Neither is worth forcing — a buyer with no email had been inventing one,
 * which produced a receipt sent nowhere.
 *
 * A number is proved by a code, always. Registering it without proof would let
 * anyone type a stranger's number and inherit the orders placed with it.
 */
type Step =
  | { name: "details" }
  /** A code was sent. `attaching` distinguishes the two reasons it was. */
  | { name: "code"; phone: string; attaching: boolean; fullName: string };

export function SignUpForm({
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
  const [step, setStep] = useState<Step>({ name: "details" });
  const [code, setCode] = useState("");

  // Drives whether a password is asked for. An account with no address signs
  // in by code, so a password would be a secret with nothing to unlock.
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const emailGiven = email.trim().length > 0;

  function finish() {
    startTransition(() => {
      router.push(next);
      router.refresh();
    });
  }

  async function handleDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("name") ?? "");
    const parsed = signUpSchema.safeParse({
      name: fullName,
      email: form.get("email") ?? "",
      phone: form.get("phone") ?? "",
      // Only meaningful on the email path; the schema still wants the field.
      password: emailGiven
        ? String(form.get("password") ?? "")
        : "x".repeat(MIN_PASSWORD_LENGTH),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    const normalisedPhone = parsed.data.phone
      ? normaliseBdMobile(parsed.data.phone)
      : null;

    if (normalisedPhone && !phoneAvailable) {
      setError(
        "Phone sign-up is unavailable right now. Please use an email address.",
      );
      return;
    }

    // ── Address given: the account is made now, the number attached after ──
    if (parsed.data.email) {
      const { error: authError } = await signUp.email({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (authError) {
        setError(authError.message ?? "Could not create your account.");
        return;
      }

      // No number to attach: done. The verification mail is already on its
      // way, and the orders placed with this address attach when it lands.
      if (!normalisedPhone) {
        finish();
        return;
      }

      const sent = await phoneNumber.sendOtp({ phoneNumber: normalisedPhone });
      if (sent.error) {
        // The account exists and is usable. Losing the number is a smaller
        // failure than throwing away a registration that succeeded.
        finish();
        return;
      }

      setStep({
        name: "code",
        phone: normalisedPhone,
        attaching: true,
        fullName: parsed.data.name,
      });
      return;
    }

    // ── Number only: nothing is created until the code comes back ─────────
    if (!normalisedPhone) {
      setError("Enter an email address or a phone number.");
      return;
    }

    const sent = await phoneNumber.sendOtp({ phoneNumber: normalisedPhone });
    if (sent.error) {
      setError("Could not send your code. Try again in a moment.");
      return;
    }

    setStep({
      name: "code",
      phone: normalisedPhone,
      attaching: false,
      fullName: parsed.data.name,
    });
  }

  async function handleCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (step.name !== "code") return;

    const { error: verifyError } = await phoneNumber.verify({
      phoneNumber: step.phone,
      code: code.trim(),
      // Attaching to the account just made, rather than looking for one to
      // create. Without this the call would find the signed-in user's number
      // slot untouched and try to register a second account.
      updatePhoneNumber: step.attaching,
    });

    if (verifyError) {
      setError("That code is not right, or it has expired.");
      return;
    }

    // A number-only registration is created with the number as its name,
    // because that is all the plugin has to go on at creation time.
    if (!step.attaching) {
      await authClient.updateUser({ name: step.fullName });
    }

    finish();
  }

  if (step.name === "code") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-2xl tracking-tight">
            Enter your code
          </h1>
          <p className="text-secondary-text text-sm">
            We sent a 6-digit code to {step.phone}.
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
            {pending ? "Verifying…" : "Verify"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStep({ name: "details" });
              setCode("");
              setError(null);
            }}
          >
            Use different details
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="font-semibold text-2xl tracking-tight">
        Create an account
      </h1>

      <form onSubmit={handleDetails} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        {phoneAvailable ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01712345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-describedby="contact-hint"
            />
          </div>
        ) : null}

        <p id="contact-hint" className="text-tertiary-text text-xs">
          {phoneAvailable
            ? "Give either one, or both. Orders you placed as a guest with a contact appear in your account once you confirm it."
            : "Orders you placed as a guest with this address appear in your account once you confirm it."}
        </p>

        {/*
          Only on the email path. An account identified by a number signs in
          with a code each time, so a password there would be a secret that
          unlocks nothing.
        */}
        {emailGiven || !phoneAvailable ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="text-tertiary-text text-xs">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-secondary-text text-sm">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-accent-text underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
