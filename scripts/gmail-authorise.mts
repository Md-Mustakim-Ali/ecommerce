/**
 * One-time Gmail consent, to produce GMAIL_REFRESH_TOKEN.
 *
 * Google will only hand out a refresh token through an interactive consent, so
 * this cannot be done from the Render dashboard. Run it once on your machine
 * and paste the result into the environment.
 *
 *   pnpm tsx scripts/gmail-authorise.mts
 *
 * Before you run it, in console.cloud.google.com:
 *
 *   1. Enable the **Gmail API** for the project.
 *   2. OAuth consent screen → add yourself as a user, then **PUBLISH IT**.
 *      This is the step that matters. While the screen is in "Testing" Google
 *      expires refresh tokens after seven days, so email works for a week and
 *      then stops with nothing in the logs until something tries to send.
 *   3. Credentials → Create OAuth client ID → **Desktop app**. Desktop clients
 *      are allowed to use the loopback redirect this script listens on;
 *      a Web client would need the URI registered and is more setup.
 *
 * Then export the two values it gives you and run this.
 *
 * The refresh token is a long-lived credential for sending mail as you. Treat
 * it like a password: it goes in .env.local and Render, never in git.
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

/** Only the ability to send. Not read, not modify — this app never needs them. */
const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const PORT = 53_682;
const REDIRECT_URI = `http://localhost:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    [
      "Set the client credentials first:",
      "",
      '  GMAIL_CLIENT_ID="…apps.googleusercontent.com" \\',
      '  GMAIL_CLIENT_SECRET="…" \\',
      "  pnpm tsx scripts/gmail-authorise.mts",
      "",
      "Both come from Credentials → Create OAuth client ID → Desktop app.",
    ].join("\n"),
  );
  process.exit(1);
}

// Guards against a stray request to the loopback port completing the exchange.
const state = randomBytes(16).toString("hex");

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
  {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    // Both are required to get a refresh token at all: without access_type
    // Google issues only an access token, and without prompt=consent it
    // returns nothing on a re-authorisation you have already granted.
    access_type: "offline",
    prompt: "consent",
    state,
  },
).toString()}`;

console.log("\nOpen this in a browser, and approve:\n");
console.log(authUrl);
console.log("\nWaiting for the redirect…\n");

const code: string = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT_URI);
    const returned = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    const finish = (message: string) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(message);
      server.close();
    };

    if (error) {
      finish(`Authorisation failed: ${error}. You can close this tab.`);
      reject(new Error(error));
      return;
    }
    if (url.searchParams.get("state") !== state) {
      finish("State mismatch — ignored. You can close this tab.");
      return;
    }
    if (!returned) return;

    finish("Done. You can close this tab and return to the terminal.");
    resolve(returned);
  });

  server.listen(PORT);
  // Nobody should be left staring at a terminal forever if the tab is closed.
  setTimeout(
    () => {
      server.close();
      reject(new Error("Timed out after 5 minutes."));
    },
    5 * 60 * 1000,
  );
});

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  }),
});

const payload = (await response.json()) as {
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

if (!response.ok || !payload.refresh_token) {
  console.error(
    `\nToken exchange failed (${response.status}): ${payload.error_description ?? payload.error ?? "no refresh_token returned"}`,
  );
  if (response.ok && !payload.refresh_token) {
    console.error(
      "\nGoogle returns no refresh token when this account has already consented.\n" +
        "Remove the app at https://myaccount.google.com/permissions and run this again.",
    );
  }
  process.exit(1);
}

console.log("\nAdd these to .env.local and to Render:\n");
console.log(`GMAIL_CLIENT_ID="${CLIENT_ID}"`);
console.log(`GMAIL_CLIENT_SECRET="${CLIENT_SECRET}"`);
console.log(`GMAIL_REFRESH_TOKEN="${payload.refresh_token}"`);
console.log(`EMAIL_FROM="<the address you just approved>"\n`);
console.log(
  "If the consent screen was still in Testing, this token dies in seven days.\n",
);
