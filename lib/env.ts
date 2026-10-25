import { z } from "zod";

/**
 * Server-side environment. Parsed once at module load so a missing or malformed
 * variable fails at boot instead of at the first request.
 *
 * Server-only by convention: never import this from a Client Component. Next
 * only inlines NEXT_PUBLIC_* into the browser bundle, so these values cannot
 * leak, but a client import would fail the parse at build time.
 */
const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  // Optional, because the console adapter covers development and a required
  // key here would mean nobody can run the app without a Resend account.
  // lib/email/index.ts refuses to fall back to the console in production.
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Must be on a domain verified with the provider, or everything bounces. */
  EMAIL_FROM: z.string().min(3).optional(),
  /** Where a buyer's reply goes. Falls back to EMAIL_FROM. */
  EMAIL_REPLY_TO: z.string().min(3).optional(),

  // Error tracking. Absent means disabled, which is the right default for a
  // local checkout — nobody needs their test orders in a dashboard.
  SENTRY_DSN: z.string().optional(),

  /** Written into every structured log line, so environments are separable. */
  APP_ENV: z.enum(["development", "preview", "production"]).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment variables.\n${issues}\n\nCopy .env.example to .env.local and fill it in.`,
  );
}

export const env = parsed.data;
