import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { type Bucket, callerKey, checkRateLimit } from "@/lib/ratelimit";

const handlers = toNextJsHandler(auth.handler);

export const { GET } = handlers;

/**
 * Which auth endpoints are worth limiting, and as what.
 *
 * Applied here rather than in the sign-in form, because the form is one client
 * of this endpoint and an attacker will not be using it. Everything that can
 * create an account, guess a password, or cause mail to be sent goes through
 * this route.
 */
const LIMITED: { match: RegExp; bucket: Bucket }[] = [
  { match: /\/sign-in\//, bucket: "sign-in" },
  { match: /\/sign-up\//, bucket: "sign-up" },

  // Everything that causes mail to be sent. Unlimited, these are a way to
  // deliver hundreds of messages to an address that never asked for them,
  // using this domain's sending reputation to do it.
  //
  // Both names for the reset request: 1.7.2 serves `request-password-reset`
  // and `forget-password` is the older alias. Matching only the one that
  // happened to be checked would leave the live endpoint wide open on an
  // upgrade in either direction — which is exactly what the first version of
  // this list did.
  { match: /\/request-password-reset/, bucket: "email" },
  { match: /\/forget-password/, bucket: "email" },
  { match: /\/send-verification-email/, bucket: "email" },
  { match: /\/change-email/, bucket: "email" },

  // Guessing a reset token is guessing a credential.
  { match: /\/reset-password/, bucket: "sign-in" },
];

export async function POST(request: NextRequest) {
  const rule = LIMITED.find((entry) =>
    entry.match.test(request.nextUrl.pathname),
  );

  if (rule) {
    // Keyed on the caller, never on the email or password being tried.
    // Keying on the email would let an attacker lock a known victim out of
    // their own account by failing sign-in for them ten times.
    const result = await checkRateLimit(rule.bucket, await callerKey());

    if (!result.ok) {
      return Response.json(
        { message: result.message },
        {
          status: 429,
          headers: {
            "Retry-After": String(result.retryAfterSeconds),
            // No Cache-Control beyond this: a 429 that got cached by a shared
            // proxy would lock out everyone behind it.
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  return handlers.POST(request);
}
