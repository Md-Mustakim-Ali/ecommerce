import { beforeAll, describe, expect, it } from "vitest";

/**
 * The redirect must be built from the public origin, never from `request.url`.
 *
 * Behind Render's proxy a request arrives at the container as
 * `http://localhost:10000/...`. Building the redirect against it sent every
 * buyer who confirmed an order to a dead address on their own machine — the
 * order was confirmed, and the page they landed on did not exist. It only
 * showed up on the live site, because locally the two are the same value.
 *
 * Imported dynamically: the route reaches lib/env, which parses the whole
 * environment at module load.
 */
type Route = typeof import("./route");
let route: Route;

const PUBLIC_ORIGIN = "https://shop.example.com";
/** What Render's proxy actually hands the container. */
const INTERNAL = "http://localhost:10000";

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-not-the-real-one-0123456789";
  process.env.BETTER_AUTH_URL = PUBLIC_ORIGIN;
  route = await import("./route");
});

/**
 * A bad token is refused before any database call, so this exercises the
 * redirect without needing one.
 */
async function locationFor(path: string): Promise<string> {
  const response = await route.GET(new Request(`${INTERNAL}${path}`));
  return response.headers.get("location") ?? "";
}

describe("confirm route redirects", () => {
  it("sends a rejected link to the public origin, not the container", async () => {
    const location = await locationFor(
      "/api/orders/confirm?id=01a089c9-fd3b-7fa6-9184-e7822a426594&t=wrong",
    );

    expect(location).not.toContain("localhost:10000");
    expect(new URL(location).origin).toBe(PUBLIC_ORIGIN);
  });

  it("explains why the link failed", async () => {
    const location = await locationFor(
      "/api/orders/confirm?id=01a089c9-fd3b-7fa6-9184-e7822a426594&t=wrong",
    );

    const url = new URL(location);
    expect(url.pathname).toBe("/orders/expired");
    expect(url.searchParams.get("reason")).toBe("bad-token");
  });

  it("refuses a request with no order id at all", async () => {
    const location = await locationFor("/api/orders/confirm");

    expect(new URL(location).origin).toBe(PUBLIC_ORIGIN);
    expect(new URL(location).searchParams.get("reason")).toBe("missing");
  });
});
