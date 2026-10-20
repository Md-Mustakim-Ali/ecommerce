import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client. Same origin, so no baseURL is needed.
 * Server code must use `lib/auth/guards.ts` instead — never this.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
