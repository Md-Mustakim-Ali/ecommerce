/**
 * The security review, as a runnable test.
 *
 * Checks the two things a marketplace cannot get wrong:
 *
 *   1. A seller cannot reach another seller's anything. Every dashboard route
 *      takes a storeId from the URL, which makes each one an IDOR unless it
 *      re-checks membership — and "unless" is not a security property.
 *
 *   2. A buyer cannot reach another buyer's order. Order ids are uuids, and a
 *      uuid is not authorisation.
 *
 * Done over HTTP with real sessions rather than by calling functions, because
 * the question is what an attacker can do with a browser, not what the code
 * looks like. A guard that exists but is never reached protects nothing.
 */

import { eq } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import { orders, stores, user } from "../lib/db/schema/index.ts";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "seed-password-1234";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

/** Signs in and returns the session cookie. */
async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Better Auth requires this for CSRF; it must match BETTER_AUTH_URL.
      Origin: BASE,
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });

  if (!response.ok) {
    throw new Error(
      `could not sign in as ${email}: ${response.status} ${await response.text()}`,
    );
  }

  const cookie = response.headers.getSetCookie?.() ?? [];
  const session = cookie
    .map((entry) => entry.split(";")[0])
    .filter((entry) => entry.startsWith("better-auth"))
    .join("; ");

  if (!session) throw new Error(`no session cookie for ${email}`);
  return session;
}

/** Follows nothing. A redirect to /sign-in is itself the answer. */
async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
  };
}

/** Anything that is not a 200 is a refusal: 403, 404 and a redirect all count. */
function refused(status: number) {
  return status !== 200;
}

async function main() {
  console.log(`base: ${BASE}\n`);

  const storeRows = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      ownerEmail: user.email,
    })
    .from(stores)
    .innerJoin(user, eq(user.id, stores.ownerId))
    .orderBy(stores.createdAt)
    .limit(2);

  const [mine, theirs] = storeRows;
  if (!theirs) throw new Error("need two stores in the database");

  console.log(`signed in as: ${mine.ownerEmail} (owns ${mine.name})`);
  console.log(`probing:      ${theirs.name}, owned by ${theirs.ownerEmail}\n`);

  const sellerCookie = await signIn(mine.ownerEmail);

  console.log("--- a seller reaching another seller's dashboard ---");

  const sellerRoutes = [
    "",
    "/orders",
    "/products",
    "/analytics",
    "/settings",
    "/staff",
    "/payouts",
    "/content",
    "/discounts",
  ];

  for (const route of sellerRoutes) {
    const own = await get(`/dashboard/${mine.id}${route}`, sellerCookie);
    const other = await get(`/dashboard/${theirs.id}${route}`, sellerCookie);

    check(
      `/dashboard/…${route || "  (overview)"} — own store opens`,
      own.status === 200,
      `${own.status}`,
    );
    check(
      `/dashboard/…${route || "  (overview)"} — the other store is refused`,
      refused(other.status),
      `${other.status}${other.location ? ` → ${other.location}` : ""}`,
    );
  }

  console.log("\n--- a seller reaching the admin area ---");

  for (const route of [
    "/admin",
    "/admin/orders",
    "/admin/payouts",
    "/admin/users",
  ]) {
    const response = await get(route, sellerCookie);
    check(
      `${route} is refused`,
      refused(response.status),
      `${response.status}${response.location ? ` → ${response.location}` : ""}`,
    );
  }

  console.log("\n--- a buyer reaching someone else's order ---");

  // Two orders belonging to two different accounts.
  const orderRows = await db
    .select({ id: orders.id, email: orders.email, buyerId: orders.buyerId })
    .from(orders)
    .where(eq(orders.status, "paid"))
    .limit(200);

  const byBuyer = new Map<string, string>();
  for (const row of orderRows) {
    if (row.buyerId && !byBuyer.has(row.buyerId)) {
      byBuyer.set(row.buyerId, row.id);
    }
  }

  const buyers = [...byBuyer.entries()].slice(0, 2);
  if (buyers.length === 2) {
    const [firstBuyerId, firstOrder] = buyers[0];
    const [, secondOrder] = buyers[1];

    const [firstBuyer] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, firstBuyerId));

    const buyerCookie = await signIn(firstBuyer.email);

    const own = await get(`/orders/${firstOrder}`, buyerCookie);
    const other = await get(`/orders/${secondOrder}`, buyerCookie);

    check("their own order opens", own.status === 200, `${own.status}`);
    check(
      "another buyer's order is refused",
      refused(other.status),
      `${other.status}`,
    );
    check(
      // Specifically 404, not 403. Confirming an order exists but is not yours
      // is a small leak with no upside — it turns id-walking into a way to
      // learn how many orders the marketplace has taken.
      "and refused as 404, not 403, so it cannot be used to enumerate",
      other.status === 404,
      `${other.status}`,
    );
  } else {
    check("found two buyers with orders to compare", false, "seed more orders");
  }

  console.log("\n--- signed out ---");

  for (const route of [
    `/dashboard/${mine.id}`,
    "/admin",
    "/account",
    `/orders/${orderRows[0]?.id ?? "00000000-0000-0000-0000-000000000000"}`,
  ]) {
    const response = await get(route);
    check(
      `${route.slice(0, 40)} redirects or refuses`,
      refused(response.status),
      `${response.status}${response.location ? ` → ${response.location.split("?")[0]}` : ""}`,
    );
  }

  console.log(
    failures === 0
      ? "\nno unauthorised access found"
      : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
