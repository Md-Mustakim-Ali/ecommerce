# Prompt for the Jomma agent — RESOLVED 2026-09-09

> **Outcome.** Sent, investigated and fixed the same day; Jomma commit `f2d921b`.
> Kept as the diagnosis record. The conclusions are summarised in
> [`jomma.md`](./jomma.md#why-no-webhook-ever-arrived) — read that first.
>
> | Reported | Verdict |
> |---|---|
> | 1. Expiry never sweeps, `payment.expired` never fires | **Confirmed.** `GET /v1/intents/:id` now sweeps the intent it is asked about. Verified from this side: both stuck intents flipped `open` → `expired`. |
> | 2. Pay page showed success for an `open` intent | **Refuted as described.** No optimistic path exists in the receipt code. The receipt was truthful; the notification never left. Not provable either way — the matched intent no longer exists. |
> | 3. Webhook delivery may not be running | **Confirmed, and worse.** Three stacked faults, not one — see below. |
>
> **The root cause neither side guessed:** `pg-boss` had never created its
> schema, so no scheduled worker had ever run against that instance. Expiry,
> delivery and health alerts all sat behind it. On top of that,
> `JOMMA_MODE=service` refuses localhost targets as an SSRF guard, and the
> registered endpoint had the wrong port *and* path — so even a running worker
> would have delivered nothing.
>
> My guess in §3 below that "the outbound worker may not be running" was right
> in substance and wrong in scope: it was not the delivery worker specifically,
> it was every scheduled job.
>
> **Follow-up closed 2026-09-10.** Test cleanup does *not* delete real intents.
> Every cleanup in that repo keys on a fixture it created; the one unscoped
> delete is `db.delete(jobRuns)` in the scheduler-health test, which touches no
> payment data. The intents were lost to `pnpm db:reset` — the Docker volume is
> younger than the intents it was supposed to contain, so they were never
> carried across, not deleted by a predicate. See the note at the end.

Copy everything below the line into the agent working on the Jomma server
(`github.com/TahsinFaiyaz30/jomma`). It is written to stand alone — it does not
assume any knowledge of the shop that found these.

The findings come from a live local instance (`http://localhost:3100`, SDK
`@jomma/sdk@1.4.19`) on 2026-09-09. Intent ids and reference codes are real and
should still be inspectable.

---

I run a shop that integrates Jomma for bKash/Nagad. Three things on the Jomma
side are not behaving as the SDK's types and docs describe. Please investigate
each, confirm or refute it against the server code, and fix what is real.

## 1. Expired intents are never swept, and `payment.expired` is never delivered

**The strongest and most clearly reproducible of the three.**

Two intents created through `POST /v1/intents` with the default TTL:

| Intent | `expires_at` | `GET /v1/intents/{id}` reports today |
|---|---|---|
| `int_01M20NMHMMFYJRDVF0N6543FDY` | `2026-09-08T14:24:32.307Z` | `status: "open"`, `received_amount: 0` |
| `int_01M20NEE3CED18P56D18QAFHXR` | `2026-09-08T14:21:12.074Z` | `status: "open"`, `received_amount: 0` |

Both are more than a day past their own `expires_at` and both still report
`open`. No `payment.expired` webhook was ever delivered for either — my
`jomma_webhook_events` table, which records every event that passes signature
verification, contains exactly one row in its entire history, and that row is a
synthetic one from my own verification script.

Expected per `types.d.ts`: `IntentStatus` includes `'expired'`, and
`WebhookEventType` includes `'payment.expired'`.

Please check:

- Is there a sweeper that transitions `open` → `expired` at `expires_at`? If it
  exists, is it scheduled and running? If it does not exist, that is the bug.
- Does `GET /v1/intents/{id}` compute status lazily, or read a stored column? If
  stored, a read past the deadline should still not return `open`.
- Are the receiving-account lock and any amount lock released on expiry? A lock
  held by an intent that will never settle blocks later intents on that account.

**Impact on integrators.** An intent that never expires never releases the stock
the order reserved, because the integrator's release path is keyed on
`payment.expired`. Abandoned checkouts hold inventory forever. I have had to
check `expires_at` client-side and treat a passed deadline as expired regardless
of the status field, which is a workaround, not a fix.

## 2. The hosted pay page has shown "completed" for an intent the API says is `open`

**Investigate carefully; this is the one I am least able to prove, and the most
serious if true.**

A buyer completed a payment on the hosted pay page at `/pay/{intentId}` and was
shown a success state with a green tick, followed by a "Return to <shop name>"
button. When they returned to my shop, the order was still unpaid — and
`GET /v1/intents/{id}` for the intents from that session reports
`status: "open"`, `received_amount: 0`, `payments: []`.

Those two things cannot both be right. Either the pay page rendered success
before Jomma had actually matched anything, or a match was made and then lost.

Please check:

- Does the pay page ever render a success state from a client-side submission,
  an optimistic update, or a form POST result — as opposed to strictly from the
  intent's server-side `status` being `matched` or `over`?
- Is there any path where a buyer's manual TrxID submission shows success while
  the resolution was actually `not_found_recent`, `sender_mismatch`, or another
  non-settling outcome from `SubmissionResolution`?
- If the pay page polls `GET /v1/intents/{id}`, does it distinguish "still open"
  from "matched", or does it treat any successful HTTP 200 as success?

**Impact.** A buyer who is told they have paid, by the payment product itself,
will not send the money again and will escalate to the merchant. The merchant
has no record of a payment and no TrxID to trace. This is the single worst
failure mode in a Send Money flow, because the money may genuinely have left the
buyer's account.

If the success screen is legitimate and the match was made and then withdrawn,
that should surface as `payment.reversed` — which was also never delivered.

## 3. Webhook delivery may not be running at all

Across the entire lifetime of my database, exactly one webhook has ever been
received, and it was one I generated myself with `signPayload`. Zero webhooks
have arrived from Jomma's own delivery mechanism.

I have ruled out my side:

- `POST /api/webhooks/jomma` is reachable and returns `400 bad signature` to an
  unsigned probe, so the route is alive and verifying.
- The one genuinely-delivered signed event was accepted and fully handled in
  67 ms, so the handler works end to end.
- Both services are on localhost (shop `:3300`, Jomma `:3100`), so there is no
  network path, firewall, or tunnel between them to fail.

Please check:

- Is there an outbound webhook worker/queue, and is it running in the local
  development configuration? If it is a background job, does it start with the
  server or does it require something extra?
- Is the endpoint registered under Apps → Hosted checkout actually persisted and
  read by the delivery path?
- Are failed deliveries recorded anywhere an operator can see? Silent
  non-delivery is very hard to diagnose from the integrator's side — I had to
  query my own database to notice that *no* events had ever arrived.
- Are `account.degraded` / `account.recovered` on the same delivery path? If so
  they are silently absent too.

Note that issues 1 and 3 may share a root cause: if the outbound worker is not
running, and expiry is emitted by that same worker, both symptoms follow.

## What I already confirmed is working, so you can rule it out

- `POST /v1/intents` — creates correctly, honours `idempotency-key`, returns a
  sensible `ref_code` and `receiving_account`.
- `GET /v1/intents/{id}` — works, returns the documented shape, 404s cleanly on
  an unknown id with a proper `not_found` error body and a `request_id`.
- `GET /v1/accounts` — correctly returns 401 without a bearer token.
- Signature verification — `signPayload` / `constructEvent` agree with my
  server, tested against tampered bodies, wrong secrets, and stale timestamps.

## One API request, not a bug

`PaymentEventData` carries a single `trx_id` and `sender_msisdn`. On a split
payment that is only the transfer that completed the intent, so an integrator
reading the breakdown from the event silently loses the earlier transfers. I
have worked around it by calling `GET /v1/intents/{id}` on every payment event
and reading `payments[]`, which is correct and documented — but it is an extra
round trip on every webhook, and an integrator who does not realise this will
store incomplete payment records without any error to warn them.

Consider either adding the full `payments[]` array to the payment event payload,
or documenting the limitation prominently in the SDK's `PaymentEventData` type
comment.

---

## Follow-up: does test cleanup delete *real* intents? — ANSWERED, no

Raised after the fixes above landed. Investigated 2026-09-10; the hypothesis
below is **refuted**.

The database is younger than the intents. The `jomma_pgdata` volume was created
`2026-09-07T22:57:47Z`; `int_01M1YDP4X0ENS81N4A5TN2MDT8` carries a ULID
timestamp of `17:12:07` the same day — five and three-quarter hours earlier. So
`pnpm db:reset` destroyed the volume and the intents were never carried across,
rather than being deleted by a broad predicate. `payment_audit.intent_id` is
`ON DELETE SET NULL` and agrees: the 19 orphaned rows match tests deleting
their own fixtures, and nothing this shop created after the reset is missing.

Every cleanup was checked. Nine tests delete `payment_intents`, all keyed on an
`app_id`, `receiving_account_id` or `client_reference` they created themselves.
The single unscoped delete in the repository is `db.delete(jobRuns)` in the
scheduler-health test, which empties `job_runs` — not payment data, but it does
leave `getSchedulerHealth()` reporting `neverRun: true` on an instance where
the worker demonstrably ran, i.e. the suite can manufacture the exact false
alarm the check exists to raise.

**Separate and more urgent for local development:** the endpoint registered on
the local Jomma instance is `http://localhost:4000/webhooks/jomma`. This shop
listens on `http://localhost:3300/api/webhooks/jomma` — wrong port *and* wrong
path. Both deliveries sit `status: failed, attempts: 0`, refused by the SSRF
guard before any request was made, with `next_attempt_at` null so they will
never retry. Local webhook delivery has therefore never worked, and anything
that appeared to settle locally did so through the `syncOrderPayment` poll.

That failure is also reported to an operator as `failedDeliveries`, phrased as
"given up after every retry" — the wrong sentence for a delivery nothing ever
attempted, and it points the reader at their own endpoint instead of at the
registered URL.

---

The original hypothesis, kept for the record:

The reason finding #2 could not be proved was that the matched intent no longer
exists. That may not be incidental — it may have been deleted by a test run.

Two intents this shop created, and which Jomma once knew about, now return
`404 not_found` from `GET /v1/intents/:id`:

| Intent | Evidence it was real |
|---|---|
| `int_01M1YDP4X0ENS81N4A5TN2MDT8` | Settled `ORD-2026-000004`. Jomma delivered a signed `payment.succeeded` for it, which this shop verified and handled. The order is still `paid`. |
| `int_01M1YDVM87E1…` | Created for `ORD-2026-000024`, still `pending` here. |

Meanwhile the submission-scope test's `afterAll` is known to delete intents, and
its orphaned `webhook_deliveries` rows were the entire contents of the queue.

**The question:** does that cleanup delete by a predicate broad enough to catch
intents it did not create — everything on an account, or everything in the table
— rather than only its own ids? If so, running the suite against an instance
holding real data silently destroys payment records. That would explain both
404s and the missing matched intent, and it means the evidence for #2 was not
lost so much as deleted.

Worth checking even though the fix is cheap, because the failure is silent and
the data is unrecoverable.
