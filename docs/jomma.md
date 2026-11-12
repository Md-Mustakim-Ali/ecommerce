# bKash and Nagad, via Jomma

Jomma watches a bKash/Nagad number for incoming Send Money messages and tells
us when one matches an order. It does not move money and has no card rails. The
buyer sends from their own app; Jomma observes it arriving.

Everything that follows assumes that distinction, because most of the design
falls out of it.

## What you must set

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `JOMMA_URL` | yes | Your instance's base URL, e.g. `https://jomma.example.com`. Passed as the SDK's `baseUrl` and never omitted — the SDK falls back to a default host, and every call then fails looking like a network fault rather than a missing variable. |
| `JOMMA_API_KEY` | yes | `jm_live_…`. Server-side only. Authorises creating payment requests against a real receiving account. |
| `JOMMA_WEBHOOK_SECRET` | yes | `whsec_…`. Signs inbound webhooks. Must be a different value from the API key. |

All three or none. `lib/env.ts` marks them optional so the app still boots
without a Jomma instance — CI, a contributor, the seed script — and
`lib/payments/jomma/client.ts` throws on first use if any is missing. Checkout
calls `jommaConfigured()` and simply does not offer bKash or Nagad when they
are absent, rather than offering a method that cannot start.

`BETTER_AUTH_URL` is reused as the site origin for `returnUrl` and `cancelUrl`.
If you split those apart later, `absoluteUrl()` in `lib/actions/checkout.ts` is
the single place to change.

### Hostnames to register under Apps → Hosted checkout

Jomma checks `returnUrl` and `cancelUrl` against the hostnames registered for
your app, and **an app with none registered gets no redirect at all** rather
than any redirect it asks for. Register the host of every `BETTER_AUTH_URL` you
run:

- `localhost:3300` — local development
- your preview/staging host
- your production host

The two URLs this app sends are `/orders/{orderId}?awaiting=1` and `/cart`.

### Webhook endpoint

Point Jomma at:

```
POST https://<your-host>/api/webhooks/jomma
```

Signed with `x-jomma-signature`. The route is `runtime = "nodejs"` and
`dynamic = "force-dynamic"`.

## Currency

**The platform currency is now BDT** (`lib/money/currency.ts`). This was USD in
seventy-two hardcoded places before the integration.

bKash and Nagad settle taka and nothing else. BDT's minor unit is the poisha,
100 to the taka — the same shape as cents — so every existing `*_cents` column
already holds exactly what Jomma calls `amount`, and `order.totalCents` is
passed to `intents.create` with no conversion, no exchange rate, and no
floating point anywhere on the path. That is the entire reason the shop was
switched rather than converting per order: a rate would put a float in the
money path and make the webhook's amount check impossible, because the event
reports poisha while the order would have said USD cents.

Orders placed before the switch keep the currency stored on their row and still
render as dollars — `formatMoney` takes the currency as an argument.

`assertMinorUnits()` guards the boundary. It should be unreachable, which is
why it is there: it catches the day somebody adds a percentage or a rate and
produces `75603.99999999999`.

## The flow

1. Buyer picks bKash or Nagad at checkout and gives a phone number.
2. `placeOrderAction` writes the order and decrements stock in one transaction,
   then creates a Jomma intent against the persisted order.
3. Buyer is redirected to `jomma.payUrl(intent.id)` — built by the SDK, not
   hand-assembled, so it cannot be aimed at the wrong host.
4. Buyer sends money from their phone.
5. Jomma matches it and POSTs a signed webhook.
6. `/api/webhooks/jomma` verifies, dedupes, and fulfils.
7. **In parallel**, the order page polls `intents.get()` every three seconds
   while the order is pending, and settles it if the webhook never arrives.

### Why there is a pull half as well as a push half

Push has one failure mode that matters: it does not arrive. A rotated secret, an
unregistered hostname, an endpoint that was down for the whole retry window —
in each case Jomma knows the money arrived and this application never finds out.
The order then sits `pending` forever, holding stock, behind a page that claims
to be checking.

`lib/payments/jomma/sync.ts` closes that. It is allowed to mark an order paid,
and that does **not** weaken the rule below: what settles the order is an
authenticated server-to-server GET carrying `JOMMA_API_KEY`, not anything the
browser said. Jomma is the witness either way; only the direction differs. The
write goes through the same `recordOrderPaid`, which locks the order row, so a
poll racing a webhook credits the seller once and emails once.

### The phone number is not optional

The SDK is blunter than the integration brief: automatic matching **refuses** a
payment whose intent declares no sender. Without `payerMsisdn` an intent can
only ever be settled by the buyer typing a TrxID in by hand. Checkout therefore
makes the phone field required once bKash or Nagad is selected, and the hosted
pay page asks for it if we still do not have one.

## Rules this integration is built on

**Only Jomma can prove a payment — never the browser.** `returnUrl` is a plain
GET that anybody can type, so landing on it marks nothing. Two things may settle
an order, and both are Jomma speaking directly to this server: a signed webhook,
or an authenticated `intents.get()` reporting the intent matched. Neither
involves trusting the buyer's tab.

**The spinner must be attached to something.** The waiting card polls; it does
not merely animate. This was the original bug in this integration — a
server-rendered `animate-spin` over a page that had finished rendering, which
looked identical whether the payment had settled a minute ago or had never been
sent. If you ever render progress here, make sure something is progressing.

**Verify before parsing.** `constructEvent` runs on the raw request body before
anything is parsed, in every environment, with no development bypass. The 400
response carries no detail: distinguishing "bad signature" from "stale
timestamp" for an unauthenticated caller builds them an oracle.

**Idempotent on `event.id`.** `jomma_webhook_events` has the event id as its
primary key. The route claims the id before running any handler, and a conflict
short-circuits to `200 {duplicate: true}`. This is stronger than the previous
guards, which were keyed on order status and ledger entries — those deduplicate
the *effect* of a payment, not the *delivery* of an event, and said nothing
about a redelivered `payment.partial` or a late `payment.expired`.

A row with a null `handled_at` is an event that was accepted and then dropped
mid-handler. That is the query to run when something looks wrong:

```sql
select id, type, client_reference, created_at
from jomma_webhook_events
where handled_at is null
order by created_at desc;
```

## The six payment events

| Event | What happens |
|---|---|
| `payment.succeeded` | Amount is checked against the order, then `recordOrderPaid` credits the seller, debits commission, and emails the receipt. |
| `payment.partial` | **Not fulfilled.** The transfers so far are stored, and the order page shows the buyer the shortfall and a link to pay the balance. The intent stays open, so a top-up produces `payment.succeeded`. |
| `payment.overpaid` | Fulfilled — they paid at least what was asked — and the excess is logged loudly as a debt owed back to the buyer. |
| `payment.expired` | Releases the reserved stock, but only from `pending`. |
| `payment.cancelled` | Same as expired. |
| `payment.reversed` | Un-fulfils. See below. |

`account.degraded` and `account.recovered` are logged and touch no order. They
carry a different payload shape entirely — reading `intent_id` off one would
silently produce `undefined`, so they are branched out before anything looks at
payment fields.

## payment.reversed

Jomma said money arrived and now says it did not. The order model could not
express this before, so two things were added:

- **`payment_reversed`** on the `order_status` enum. Deliberately not
  `refunded`: a refund means the buyer had the goods and we gave the money
  back, a reversal means the money was never there. Collapsing them would tell
  a seller they refunded a customer who never paid them, and put a fictional
  refund in platform revenue.
- **`recordOrderReversed`** in `lib/money/ledger.ts`, which writes negative
  entries mirroring exactly what `recordOrderPaid` credited, so the two sum to
  zero. The ledger is append-only behind a database trigger, so nothing is
  deleted — the audit trail shows that we believed we were paid and then
  learned otherwise, which is what an investigation needs to see.

**What this cannot undo:** if the seller already shipped, the goods are gone.
The ledger and the order status are corrected automatically; recovering the
item is a human problem. That is the honest boundary of an automated reversal.

## Testing

```bash
pnpm vitest run lib/payments/jomma
```

`signature.test.ts` verifies against the real SDK — a test of our own copy of
the algorithm would agree with itself while disagreeing with Jomma. It covers a
tampered body, a wrong secret, a missing header, malformed headers, a stale
timestamp, a future timestamp, and the re-serialisation mistake.

`webhook-handler.test.ts` runs the real route with the database mocked, and
covers idempotency across three deliveries of one event, plus each event type.
The signature check is *not* mocked there, so those tests would also catch
verification being bypassed.

## Split payments

A buyer who sends ৳400 against a ৳900 order and tops up the balance later
produces **two** transfers, with two TrxIDs, possibly from two handsets. Jomma
applies both to the same intent and reports both in `Intent.payments[]`.

`jomma_applied_payments` stores them, one row per transfer, and the order page
lists them. Two things follow from the array being the source of truth:

- **Never read the breakdown off a webhook event.** `PaymentEventData` carries a
  single `trx_id`, which on a split is only the transfer that happened to
  complete the intent. The earlier ones are not in the payload at all. The route
  therefore calls `intents.get()` on every payment event.
- **The unique index is on `(intent_id, coalesce(trx_id,''), applied_at)`.** The
  `coalesce` is load-bearing: `trx_id` is nullable for admin-resolved payments,
  Postgres treats NULLs as distinct, and without it every poll would insert
  another copy.

## Why no webhook ever arrived

Diagnosed 2026-09-09 and fixed on the Jomma side. Recorded here because the
symptom — an order stuck `pending` behind a spinner — points at this application
first, and the next person to see it should not re-derive the whole chain.

**Three faults were stacked.** Every one of them had to be fixed before a single
webhook could land, which is why the failure was total and silent.

1. **`pg-boss` had never created its schema**, so no scheduled worker had ever
   run against that instance — not once. Expiry sweeps, webhook delivery and
   every health alert all live behind it. This was the root cause of both the
   stale `open` status and the missing deliveries.
2. **`JOMMA_MODE=service` refuses localhost delivery targets** as an SSRF guard,
   correctly for a multi-merchant instance. So even with the worker running, a
   shop on `localhost:3300` would have received nothing. Self-hosting wants
   `JOMMA_MODE=single`.
3. **The registered endpoint was wrong** — `localhost:4000/webhooks/jomma`,
   the wrong port *and* the wrong path. It must be
   `http://<host>/api/webhooks/jomma`; see the Webhook endpoint section above.

### What stayed, and why

`syncOrderPayment` still derives `expired` from `expires_at` rather than reading
`intent.status`, even though Jomma now sweeps on read and returns `expired`
correctly. That is deliberate belt-and-braces: the whole failure above was a
scheduler that was never running, and a deadline that has visibly passed is
something this application can evaluate without depending on anything remote.

The polling in `lib/actions/payment-status.ts` is load-bearing for the same
reason. It is what let two orders show correct state while zero webhooks were
being delivered.

### One claim that did not survive

An earlier version of this file said the hosted pay page had shown a success
state for an intent the API reported as `open`. **That mechanism was refuted**
by reading Jomma's source: the receipt renders only from a server-side `matched`
or `over`, and there is no optimistic path. The buyer's receipt was truthful;
the notification simply never left. The matched intent could not be produced to
prove it either way, so this is the best-supported reading rather than a
demonstrated one — noted rather than deleted, because a payment product showing
an unearned success would be serious enough to re-investigate if it recurs.

## Out of scope, for later

The SDK exposes a `submissions` resource — the manual path where a buyer types
a TrxID and Jomma returns one of nine resolutions. That is the fallback for a
payment automatic matching could not resolve, and nothing here uses it yet.
