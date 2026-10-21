/**
 * Fetches the seller pages as real signed-in users and checks what came back.
 *
 * Sessions come from Better Auth's own sign-in endpoint, so the cookie is
 * signed exactly as a browser's would be — the proxy's optimistic cookie check
 * rejects anything less. The credential is the local-only seed fixture these
 * `.test` accounts were created with, the same one scripts/seed.ts uses.
 *
 * Every session created here is revoked at the end.
 */

import { eq } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import { stores, user } from "../lib/db/schema/index.ts";
import { SEED_PASSWORD } from "./seed-data.ts";

const BASE = "http://localhost:3000";
let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

/** Signs in over HTTP and returns the Set-Cookie header verbatim. */
async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    // Better Auth refuses a state-changing call with no Origin, which is the
    // CSRF guard doing its job. A browser would always send one.
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(
      `sign-in failed for ${email}: ${response.status} ${await response.text()}`,
    );
  }
  const raw = response.headers.getSetCookie();
  const cookie = raw.map((entry) => entry.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`no session cookie returned for ${email}`);
  return cookie;
}

async function signOut(cookie: string) {
  await fetch(`${BASE}/api/auth/sign-out`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", origin: BASE },
    body: "{}",
  });
}

async function get(path: string, cookie: string) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  return { status: response.status, html: await response.text() };
}

async function main() {
  const [store] = await db
    .select({ id: stores.id, name: stores.name, ownerId: stores.ownerId })
    .from(stores)
    .orderBy(stores.createdAt)
    .limit(1);

  const [ownerUser] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, store.ownerId));

  const owner = await signIn(ownerUser.email);
  const staff = await signIn("sam@northmark.test");
  const outsider = await signIn("ada@buyer.test");
  const opened = [owner, staff, outsider];

  try {
    console.log(`store: ${store.name}\n--- as the owner ---`);

    const ownerOrders = await get(`/dashboard/${store.id}/orders`, owner);
    check(
      "orders page renders",
      ownerOrders.status === 200,
      `${ownerOrders.status}`,
    );
    check("shows the queue heading", ownerOrders.html.includes("Orders"));
    check(
      "offers ship and cancel",
      ownerOrders.html.includes("Ship") && ownerOrders.html.includes("Cancel"),
    );

    const ownerStaff = await get(`/dashboard/${store.id}/staff`, owner);
    check(
      "staff page renders",
      ownerStaff.status === 200,
      `${ownerStaff.status}`,
    );
    check("lists the owner", ownerStaff.html.includes("Owner"));
    check("lists seeded staff", ownerStaff.html.includes("Sam Okonkwo"));
    check("shows built-in roles", ownerStaff.html.includes("Built in"));
    check("offers role creation", ownerStaff.html.includes("New role"));
    check("offers invitations", ownerStaff.html.includes("Invite someone"));

    const ownerPayouts = await get(`/dashboard/${store.id}/payouts`, owner);
    check(
      "payouts page renders",
      ownerPayouts.status === 200,
      `${ownerPayouts.status}`,
    );
    check("shows a balance", ownerPayouts.html.includes("Current balance"));
    check("shows the ledger", ownerPayouts.html.includes("Ledger"));

    console.log("\n--- as fulfilment staff (7 permissions) ---");

    const staffOrders = await get(`/dashboard/${store.id}/orders`, staff);
    check(
      "can open orders",
      staffOrders.status === 200,
      `${staffOrders.status}`,
    );
    check("can ship", staffOrders.html.includes("Ship"));
    check(
      "is not offered cancel",
      !staffOrders.html.includes("Cancel and restock"),
    );

    const staffPayouts = await get(`/dashboard/${store.id}/payouts`, staff);
    check(
      "payouts is 404 without payout.view",
      staffPayouts.status === 404,
      `${staffPayouts.status}`,
    );

    const staffStaff = await get(`/dashboard/${store.id}/staff`, staff);
    check(
      "staff page is 404 without member.view",
      staffStaff.status === 404,
      `${staffStaff.status}`,
    );

    console.log("\n--- as a buyer with no access ---");

    for (const path of ["orders", "staff", "payouts"]) {
      const response = await get(`/dashboard/${store.id}/${path}`, outsider);
      check(
        `${path} is 404 for a stranger`,
        response.status === 404,
        `${response.status}`,
      );
    }

    const strangerHome = await get("/dashboard", outsider);
    check(
      "the buyer's own dashboard still loads",
      strangerHome.status === 200,
      `${strangerHome.status}`,
    );
    check(
      "and does not leak the store name",
      !strangerHome.html.includes(store.name),
    );
  } finally {
    for (const cookie of opened) await signOut(cookie);
    console.log("\nsessions revoked");
  }

  console.log(
    failures === 0 ? "all checks passed" : `${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
