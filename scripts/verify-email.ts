/**
 * Sends one real email through whichever provider is configured.
 *
 *   pnpm verify:email you@gmail.com
 *
 * The point is to separate two failures that otherwise look identical from the
 * outside. "No receipt arrived" can mean the mail path is broken, or it can
 * mean the order never got far enough to send one — and checking by placing a
 * test order conflates them. This sends nothing but the email.
 *
 * It also prints which adapter was selected, which is the first thing to check
 * when mail is not arriving: `console` means the environment variables are not
 * set the way you think, and nothing was ever going to be sent.
 *
 * Against production, without touching .env.local:
 *
 *   GMAIL_CLIENT_ID="…" GMAIL_CLIENT_SECRET="…" GMAIL_REFRESH_TOKEN="…" \
 *   EMAIL_FROM="…" pnpm tsx scripts/verify-email.ts you@gmail.com
 */

import { emailProvider, sendEmail } from "@/lib/email";

// Wrapped rather than top-level await: tsx transforms these scripts as CJS,
// where a top-level await is a syntax error. The other scripts here do the same.
async function main() {
  const to = process.argv[2]?.trim();

  if (!to) {
    console.error(
      [
        "Usage: pnpm verify:email <address>",
        "",
        "Send to an inbox you can actually open — the point is to confirm the",
        "message arrives, not that the API returned 200.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const provider = emailProvider();
  console.log(`provider: ${provider.name}`);

  if (provider.name === "console") {
    console.log(
      [
        "",
        "Nothing will be sent. The console adapter is selected, which means no",
        "provider is configured — check GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET",
        "and GMAIL_REFRESH_TOKEN (or RESEND_API_KEY), and that EMAIL_FROM is set.",
        "",
      ].join("\n"),
    );
  }

  const result = await sendEmail({
    to,
    subject: "Test from your shop",
    html: "<p>If you are reading this, transactional email works.</p>",
    text: "If you are reading this, transactional email works.",
  });

  if (!result.ok) {
    console.error(`\nFailed: ${result.error}`);
    process.exit(1);
  }

  console.log(`\nAccepted by ${provider.name}. id: ${result.id}`);
  console.log(
    provider.name === "console"
      ? "That is the console adapter, not a delivery. See above."
      : "Now check the inbox. A 200 means accepted, not delivered — spam filters still apply.",
  );
}

main().then(() => process.exit(0));
