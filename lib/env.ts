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

  // -- Jomma (bKash / Nagad settlement verification) ------------------------
  //
  // Optional here, asserted hard in lib/payments/jomma/client.ts. The split is
  // deliberate: making them required would stop the app booting for anyone
  // running it without a Jomma instance — CI, a contributor, the seed script —
  // even though nothing outside the bKash path touches them. The client module
  // throws at import if they are missing, so the assertion still happens at
  // startup for every process that can actually take a payment.
  //
  // JOMMA_URL is url() rather than string(). The SDK's baseUrl is the single
  // most dangerous field in this integration to get wrong: the documented
  // failure is that it silently falls back to a default host and every call
  // fails looking like a network fault rather than a misconfiguration.
  JOMMA_URL: z.url().optional(),
  JOMMA_API_KEY: z.string().min(1).optional(),
  /** Signs inbound webhooks. Never the same value as JOMMA_API_KEY. */
  JOMMA_WEBHOOK_SECRET: z.string().min(1).optional(),

  // -- Cloudflare R2: product image storage ---------------------------------
  //
  // All five or none. lib/storage/index.ts falls back to local disk when any
  // is missing, which is right for development and wrong in production: a
  // serverless filesystem is per-instance and does not survive a redeploy, so
  // an image uploaded through one function invocation is a 404 on the next and
  // gone entirely on the next deploy.
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  /**
   * Public base URL images are served from — an r2.dev domain or a custom one.
   *
   * Its hostname must also appear in next.config.ts remotePatterns or <Image>
   * refuses to render anything from it, which presents as every product photo
   * silently missing rather than as an error.
   */
  R2_PUBLIC_URL: z.url().optional(),

  // -- Google media connections ---------------------------------------------
  //
  // Encrypts the OAuth client secrets and refresh tokens in store_google_*.
  // Base64 of 32 random bytes:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  //
  // Optional so the app boots without it — a store that has not connected
  // Google never touches this. lib/media/crypto.ts throws with instructions at
  // the point a connection is actually saved or read.
  //
  // Rotating it strands every existing connection: the ciphertext is
  // undecryptable and every seller has to reconnect. The stored values carry a
  // version prefix so a future rotation can decrypt old and write new, but
  // that path does not exist yet.
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),

  /**
   * Bearer token for POST /api/media/sweep.
   *
   * Absent closes the endpoint rather than opening it — a missing variable
   * must never be what makes a route public. That route makes Google API
   * calls for every store, so leaving it open is a free way for anyone to
   * burn a seller's whole daily quota.
   */
  MEDIA_SWEEP_SECRET: z.string().min(16).optional(),
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
