import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth, type Session } from "@/lib/auth";

/**
 * The only place session state is read on the server.
 *
 * `cache()` dedupes within a single request, so a layout and three nested
 * components asking for the session cost one lookup, not four.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Use in any Server Component, server action, or route handler that requires a
 * signed-in user. This is the real authorization check — `proxy.ts` only does
 * an optimistic cookie test to keep signed-out users off the page, and a cookie
 * is trivially forged. Never rely on the proxy for access control.
 */
export async function requireUser() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session.user;
}
