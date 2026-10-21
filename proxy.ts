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
const PROTECTED_PREFIXES = ["/account", "/dashboard", "/admin", "/orders"];

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
  matcher: [
    "/account/:path*",
    "/dashboard/:path*",
    "/admin/:path*",
    "/orders/:path*",
  ],
};
