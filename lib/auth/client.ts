import { phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client. Same origin, so no baseURL is needed.
 * Server code must use `lib/auth/guards.ts` instead — never this.
 *
 * The plugin list mirrors lib/auth/index.ts. A plugin present on one side and
 * not the other produces a route the client cannot call, or a client method
 * that 404s — both at runtime, with nothing failing at build.
 */
export const authClient = createAuthClient({
  plugins: [phoneNumberClient()],
});

export const { signIn, signUp, signOut, useSession, phoneNumber } = authClient;
