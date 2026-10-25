"use server";

import { z } from "zod";
import { reportError } from "@/lib/observability/report";
import { callerKey, checkRateLimit } from "@/lib/ratelimit";

/**
 * Lets the client error boundary report what it caught.
 *
 * A public, unauthenticated endpoint that writes to the error log, which makes
 * it a way to flood that log. Hence the rate limit and the hard length caps —
 * neither is about the honest caller, which sends one short message.
 *
 * Nothing here is trusted. The message is a string from the browser and is
 * treated as one: capped, and passed through the same redaction as everything
 * else before it reaches a log or a reporting service.
 */

const schema = z.object({
  message: z.string().max(500),
  digest: z.string().max(120).optional(),
  path: z.string().max(300).optional(),
});

export async function reportClientError(
  input: z.input<typeof schema>,
): Promise<void> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return;

  // Borrows the sign-up bucket's shape rather than adding a fifth: a handful
  // an hour from one address is generous for genuine errors and useless as a
  // flood. Silently dropped when over — the user is already looking at an
  // error page, and a second failure helps nobody.
  const limit = await checkRateLimit(
    "sign-up",
    `client-error:${await callerKey()}`,
  );
  if (!limit.ok) return;

  await reportError(new Error(parsed.data.message), {
    source: "client",
    digest: parsed.data.digest,
    path: parsed.data.path,
  });
}
