import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`.
 *
 * This is an OPTIMISTIC check only. It reads the session cookie without hitting
 * the database, so it is fast enough to run on every request — but a cookie can
 * be forged, so it proves nothing. Real authorization lives in `requireUser()`
 * inside the page or server action. See lib/auth/guards.ts.
 */
/**
 * `/orders` is deliberately NOT here.
 *
 * It was, and it broke guest checkout: a buyer who was not signed in got
 * redirected to sign-in the moment their order was placed, and the link in
 * their receipt landed in the same place. A prefix guard cannot tell "not
 * yours" from "yours, but you have no account", and guest checkout is the
 * whole point of that page.
 *
 * Nothing is weakened by dropping it. This check was only ever optimistic —
 * see below — while the order page enforces ownership properly through
 * getOrderForBuyer: the account it belongs to, a contact it was placed with,
 * or a signed access token. That check is the one that matters, and it ran
 * anyway.
 */
const PROTECTED_PREFIXES = ["/account", "/dashboard", "/admin"];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/account/:path*", "/dashboard/:path*", "/admin/:path*"],
};
