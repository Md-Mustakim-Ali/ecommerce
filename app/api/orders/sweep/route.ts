import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/media/crypto";
import { expireUnconfirmedOrders } from "@/lib/orders/confirmation";

/**
 * Releases the stock held by orders nobody ever confirmed.
 *
 * There is no cron in this project — Render's free plan has none — so this is
 * an endpoint something external pokes, exactly like /api/media/sweep. Once an
 * hour is plenty: the TTL is 24 hours, so precision buys nothing.
 *
 * Without it an abandoned guest checkout sits on inventory forever, and
 * somebody bored with a script sits on all of it.
 *
 * Reuses MEDIA_SWEEP_SECRET rather than inventing a second one. Both are the
 * same kind of thing — a bearer token for a maintenance endpoint the public
 * has no business calling — and a second variable is a second thing to forget,
 * which for an endpoint that fails closed means a job that silently never runs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const expected = process.env.MEDIA_SWEEP_SECRET;
  // A missing secret closes the endpoint rather than opening it.
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;

  return secretsMatch(token, expected);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const result = await expireUnconfirmedOrders();
  return NextResponse.json({ ok: true, ...result });
}
