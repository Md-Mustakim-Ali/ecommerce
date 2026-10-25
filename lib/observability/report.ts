import { env } from "../env";
import { log } from "./logger";
import { redact } from "./redact";

/**
 * Error reporting.
 *
 * Sentry's envelope endpoint over fetch, with no SDK. The SDK brings
 * instrumentation, tracing and a bundle; what this needs is "when something
 * breaks, tell me what and where", and that is one POST. Adding the real SDK
 * later is a change to this file and nothing else, because every caller sees
 * only `reportError`.
 *
 * Absent DSN means disabled, which is the right default: nobody wants their
 * local test orders in a dashboard, and a required DSN would make the app
 * unrunnable without an account.
 *
 * Everything goes through the same `redact` the logger uses. An error report
 * carries request context, and request context is where the credentials are.
 */

type Context = Record<string, unknown>;

/** Parses the DSN into the pieces the envelope endpoint needs. */
function parseDsn(dsn: string) {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      key: url.username,
    };
  } catch {
    return null;
  }
}

const parsed = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null;

export function errorReportingEnabled(): boolean {
  return parsed !== null;
}

/**
 * Reports an error, and always logs it.
 *
 * Logging happens whether or not reporting is configured, so turning the DSN
 * off never turns off the record. A system where errors are only visible in a
 * third-party dashboard is a system that goes blind when the bill goes unpaid.
 *
 * Never throws. An error reporter that can fail the request it is reporting on
 * has made things strictly worse.
 */
export async function reportError(
  error: unknown,
  context?: Context,
): Promise<void> {
  const err =
    error instanceof Error ? error : new Error(String(error ?? "Unknown"));

  log.error(err.message, { ...context, error: err });

  if (!parsed) return;

  try {
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const header = JSON.stringify({
      event_id: eventId,
      sent_at: new Date().toISOString(),
      dsn: env.SENTRY_DSN,
    });
    const itemHeader = JSON.stringify({ type: "event" });
    const payload = JSON.stringify({
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      environment: env.APP_ENV ?? process.env.NODE_ENV ?? "development",
      exception: {
        values: [
          {
            type: err.name,
            value: String(redact(err.message)),
            stacktrace: err.stack ? { frames: [] } : undefined,
          },
        ],
      },
      extra: redact(context ?? {}),
    });

    await fetch(parsed.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=marketplace/1.0`,
      },
      // Newline-delimited: envelope header, item header, item payload.
      body: `${header}\n${itemHeader}\n${payload}`,
      // Without this a hung reporter holds the request open past the point the
      // user has given up.
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Silence is correct here. The error is already logged; a failure to
    // report it is not itself worth reporting, and trying would recurse.
  }
}
