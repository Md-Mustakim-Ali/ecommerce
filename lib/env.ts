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
