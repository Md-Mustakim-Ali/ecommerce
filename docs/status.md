# Where this is

A companion to `docs/build-plan.md`, recording what is actually built rather
than what was planned. Written because the plan is a plan, and after a few
phases the two stop matching in ways nobody wrote down.

Last updated: 2026-09-04.

---

## Phases

| Phase | State |
|---|---|
| 0 — Foundation | done |
| 1 — Design system | done |
| 2 — Catalog | done |
| 3 — The feel | done |
| 4 — Checkout and money | done, except a real payment provider |
| 5 — Operations | done |
| 6 — Launch readiness | done, except the parts that need a person |

Every permission in `lib/auth/permissions.ts` has a call site, and no row in
`docs/backend-ui-gaps.md` is marked missing. That was the audit that drove most
of this work: seeded data makes a read path look finished, and the question
that catches it is not "does the page render" but **"could a user have produced
this state through the app?"**

## What is deliberately not built

**Real payments.** Deferred to a separate project. This repository has the full
money model — the ledger, the commission split, refunds, payouts, idempotency —
and a development-only settle path that runs all of it. What it does not have
is a provider that charges a card. `lib/payments` is a port with a manual
adapter; wiring a real one is a new file and a branch.

**Remote image hosting.** `lib/storage` is a port with a local-disk adapter.
Development only. An S3 or R2 adapter is a new file implementing
`StorageProvider` plus a branch in `lib/storage/index.ts`; nothing that reads
or writes images changes.

**Redis.** Phase 3 suggested it for cart and rate limiting. Both are Postgres.
The trade-off is written at `lib/db/schema/ratelimit.ts`: a second datastore is
a second thing to run, monitor and back up, and a limiter that fails open when
it is down. Worth revisiting under real load, not before.

## What needs a person

These are named rather than quietly skipped.

- **A screen reader has not been run.** Structure and names are checked
  automatically; whether the announcements are pleasant to listen to is not
  something a script can judge. See `docs/accessibility.md`.
- **Contrast ratios have not been computed.** The palette was designed for it
  and the tokens are pinned by a test, but nothing measures.
- **Lighthouse has not been run on a real device.** The performance work was
  done against the budget in AGENTS.md by construction, not by measurement on
  hardware.
- **Authenticated routes are not in the accessibility sweep**, because they
  need a session.
- **Seller payouts are sent by hand, and an open design question sits behind
  that.** A multi-seller cart is one bKash transfer to one number, so the
  platform collects centrally and an admin pays each seller manually — there is
  no disbursement code. Jomma is already multi-tenant and this platform does not
  use it that way, which is the cheaper half of the fix. Analysis, verified
  against a real order, in [`multi-seller-money-flow.md`](./multi-seller-money-flow.md).

## Runnable checks

Everything below is a script, not a document, because documents go stale
silently and scripts fail.

```bash
pnpm test                 # 273 unit tests, no database needed
pnpm verify:auth          # cross-tenant IDOR, over HTTP with real sessions
pnpm verify:a11y          # ten routes of server-rendered HTML
pnpm load:checkout        # concurrency invariants: stock, ledger, no 5xx
pnpm db:verify-backup     # dump, restore into a scratch DB, compare every table
```

The `scripts/verify-*.ts` family covers the rest and each one rolls back:
ledger, payouts, refunds, settings, discounts, images, pages, staff orders,
owner-only actions, order notes, deletions, rate limits.

Every one of these needs a dev server on :3000 except `pnpm test` and the
rollback scripts.
