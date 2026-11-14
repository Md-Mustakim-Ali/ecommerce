import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { phoneNumber } from "better-auth/plugins";
// Relative, not "@/lib/...": the `auth` CLI loads this file through jiti, which
// does not resolve tsconfig path aliases. Keep these two imports relative or
// `pnpm auth:generate` breaks.
import { db } from "../db";
import { emailIsConfigured, sendEmail } from "../email";
import { resetPassword, verifyEmail } from "../email/templates";
import { env } from "../env";
import { claimOrdersForContact } from "../orders/claim";
import { sendSms } from "../sms";
import { normaliseBdMobile } from "../validation/phone";
import { isPlaceholderEmail, placeholderEmailFor } from "./placeholder-email";

export { isPlaceholderEmail, placeholderEmailFor };

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
      // A phone-only account has a placeholder here. There is nothing to
      // verify and nowhere to send it.
      if (isPlaceholderEmail(account.email)) return;
      await sendEmail(verifyEmail({ to: account.email, url }));
    },

    /**
     * Where a guest's past orders become their order history.
     *
     * On verification, not on sign-up, and that is the whole security model.
     * Signing up proves you can type an address; verifying proves you receive
     * mail at it. Attaching on sign-up would let anyone enter a stranger's
     * address and read their delivery addresses, phone number and purchase
     * history — which is most of what an account holds.
     *
     * The buyer is asked for nothing. They verify, as they already had to,
     * and the orders are there.
     */
    async afterEmailVerification(account) {
      if (isPlaceholderEmail(account.email)) return;
      await claimOrdersForContact({
        userId: account.id,
        email: account.email,
      });
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

  plugins: [
    /**
     * Phone as a first-class identifier, not a profile field.
     *
     * This marketplace settles in BDT through bKash and Nagad, and its buyers
     * are reachable by number far more reliably than by email. The plugin adds
     * `user.phoneNumber` and `user.phoneNumberVerified` and a sign-in route
     * that takes a number instead of an address.
     */
    phoneNumber({
      // The same rule checkout uses. Two validators disagreeing about what a
      // Bangladeshi mobile is would mean a number accepted on an order that
      // can never be registered, so there is only one.
      phoneNumberValidator: (input) => normaliseBdMobile(input) !== null,

      async sendOTP({ phoneNumber: to, code }) {
        await sendSms({
          to,
          body: `${code} is your verification code. It expires in 5 minutes. Do not share it with anyone.`,
        });
      },

      async sendPasswordResetOTP({ phoneNumber: to, code }) {
        await sendSms({
          to,
          body: `${code} is your password reset code. It expires in 5 minutes. If you did not ask for it, ignore this message.`,
        });
      },

      /**
       * Registration by number alone. The account is created at verification
       * rather than before it, so an unverified number never occupies one.
       */
      signUpOnVerification: {
        getTempEmail: placeholderEmailFor,
        // The number, until they choose a name. Better than "user_a1b2c3".
        getTempName: (phone) => phone,
      },

      /** The phone half of claiming. Same rule as email: verified, then attached. */
      async callbackOnVerification({ user: account }) {
        await claimOrdersForContact({
          userId: account.id,
          phone: account.phoneNumber,
        });
      },
    }),

    // nextCookies() must stay last — it reads cookies set by earlier plugins.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
