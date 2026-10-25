import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
// Relative, not "@/lib/...": the `auth` CLI loads this file through jiti, which
// does not resolve tsconfig path aliases. Keep these two imports relative or
// `pnpm auth:generate` breaks.
import { db } from "../db";
import { emailIsConfigured, sendEmail } from "../email";
import { resetPassword, verifyEmail } from "../email/templates";
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
    /**
     * Gated on there being a provider that can actually send.
     *
     * Turning this on without one locks every new account out permanently,
     * waiting for a message that will never arrive — so it follows the
     * configuration rather than being a flag somebody has to remember to flip
     * on the same deploy as the API key.
     */
    requireEmailVerification: emailIsConfigured(),
    minPasswordLength: 12,

    async sendResetPassword({ user: account, url }) {
      await sendEmail(resetPassword({ to: account.email, url }));
    },
  },

  emailVerification: {
    // Straight after sign-up, so nobody has to find a "resend" button.
    sendOnSignUp: true,
    // The link signs them in as well. Asking someone to verify and then type
    // the password they just chose is a step with no security value.
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user: account, url }) {
      await sendEmail(verifyEmail({ to: account.email, url }));
    },
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
