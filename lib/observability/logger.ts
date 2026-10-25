// Relative, not "@/lib/env": this is reachable from lib/auth/index.ts, which
// the `auth` CLI loads through jiti without tsconfig path aliases.
import { env } from "../env";
import { type Fields, redact } from "./redact";

/**
 * Structured logging.
 *
 * One JSON object per line in production, so a log aggregator can index the
 * fields instead of regex-ing prose. Human-readable in development, because
 * nobody debugs by reading JSON in a terminal.
 *
 * Every field goes through `redact` before it is written. See ./redact.ts —
 * that is the part that matters here.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

function emit(level: LogLevel, message: string, fields?: Fields) {
  const payload = {
    level,
    time: new Date().toISOString(),
    env: env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    message,
    ...(fields ? (redact(fields) as Fields) : {}),
  };

  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(payload)
      : `${level.toUpperCase().padEnd(5)} ${message}${
          fields ? ` ${JSON.stringify(redact(fields))}` : ""
        }`;

  // console, not a transport. In every environment this runs in — Node, edge,
  // a container — stdout is already collected, and a custom transport would be
  // one more thing that can fail while trying to report that something failed.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug(message: string, fields?: Fields) {
    // Suppressed in production: debug lines are written for a person watching,
    // and in production nobody is.
    if (process.env.NODE_ENV === "production") return;
    emit("debug", message, fields);
  },
  info(message: string, fields?: Fields) {
    emit("info", message, fields);
  },
  warn(message: string, fields?: Fields) {
    emit("warn", message, fields);
  },
  error(message: string, fields?: Fields) {
    emit("error", message, fields);
  },
};
