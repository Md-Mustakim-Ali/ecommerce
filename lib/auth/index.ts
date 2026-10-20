import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
// Relative, not "@/lib/...": the `auth` CLI loads this file through jiti, which
// does not resolve tsconfig path aliases. Keep these two imports relative or
// `pnpm auth:generate` breaks.
import { db } from "../db";
import { env } from "../env";

export const auth = betterAuth({
  appName: "ecommerce",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    // Wrap multi-statement auth writes in a transaction.
    transaction: true,
  }),

  emailAndPassword: {
    enabled: true,
    // Phase 5 wires transactional email; until then a verification gate would
    // make sign-up untestable. Flip this on with the email provider.
    requireEmailVerification: false,
    minPasswordLength: 12,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh at most once a day
    cookieCache: {
      // Avoids a DB read on every request. Short TTL so revocation still bites.
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  // nextCookies() must stay last — it reads cookies set by earlier plugins.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
