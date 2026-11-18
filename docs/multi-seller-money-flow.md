# One payment, several sellers — how the money actually gets there

**Status: open design question for this platform. Raised 2026-09-10 after
`ORD-2026-000016`. Not a bug, and not a Jomma limitation.**

> A cart holding items from two stores becomes one payment to one bKash number.
> So how does each seller get their share?

Worth writing down because the answer is half-built: the accounting is finished
and correct, the part that moves money is a person with a phone, and the
capability that would remove most of that work is available and unused.

## What happens today

Verified against a real order, `ORD-2026-000016` — ৳184.00, two stores
(Northmark Supply ৳67, Circuit & Cabinet ৳117), paid in three transfers.

**1. Collection is central, and that is this platform's choice.**

Jomma allocated `01518920430` as the receiving number. The same number had
served `ORD-2026-000015`, a different seller entirely (Oakline). So every buyer
pays into one pool, whoever they are buying from.

That is not how Jomma is built — see below. It is how *we* use it.

**2. Attribution is automatic and already correct.**

`recordOrderPaid` ([lib/money/ledger.ts](../lib/money/ledger.ts)) writes, per
sub-order and inside the transaction that marks the order paid:

- a `sale` credit for the gross the seller earned, and
- a `commission` debit for the platform's cut.

`storeBalance()` derives what a store is owed by summing its ledger. The ৳184
was split across two stores the moment it landed. Nothing here is missing.

**3. Disbursement is manual.**

`initiatePayoutAction` ([lib/actions/admin-stores.ts](../lib/actions/admin-stores.ts))
recomputes the balance under a `select … for update` on the store row, writes a
`payouts` row as `processing`, and writes the matching `payout` ledger debit in
the same transaction. Careful work: it refuses if the balance moved while the
admin was reading it, and the debit cannot exist without the payout row.

**But no code sends money.** An admin reads the amount, opens bKash themselves,
sends it, comes back, marks the payout `paid`, and types the transfer id in by
hand.

## The thing we are not using

**Jomma is multi-tenant already. We run it as if it were not.**

From `apps/web/lib/db/schema/businesses.ts`, `businesses` is the tenant
boundary, and both `apps` and `receiving_accounts` carry `business_id`.
Crucially, `JOMMA_MODE` decides what the dashboard *shows* — no switcher, no
signup, no business column — but **never what the queries do**. Single-tenant is
"one business that every user belongs to", not a reduced data model.

So a seller store *could* be its own Jomma business with its own receiving
account, and an intent raised against that business would send the buyer's
money straight to that seller's own bKash number. For a single-seller cart —
which is most carts — there would be no platform float, no ledger redistribution
and no payout to send at all.

Two details that remove the obvious objections:

- **A phone can watch several businesses.** From the `devices` comment: "one
  phone can be paired to several businesses at once by scanning each one's
  code." Per-seller businesses do not require one handset per seller.
- **`businesses.status` starts `pending` and cannot receive money until a
  platform admin approves it**, which maps directly onto the store approval flow
  this shop already has.

**What Jomma will not do is pay anybody.** That is deliberate and stated twice
in its source: *"Jomma does not move money out — it has no payout path and
should not have"* (`schema/payments.ts`), and *"Jomma never moves money out"*
(`services/refunds.ts`). So automating disbursement is not a Jomma feature
request. Any design that ends with the platform owing sellers money needs an
answer that is not Jomma.

That is the real shape of the problem: **we can choose to route money so that
payouts are rarely needed, or we can solve disbursement. Jomma helps with the
first and is deliberately no help with the second.**

## What is genuinely unresolved

Roughly in the order it will start to hurt.

**a. Every order needs a payout, because every order collects centrally.**
Even a single-seller cart — where the money could have gone straight to that
seller — lands in the pool and has to be paid out by hand. This is the largest
avoidable cost and the one Jomma's multi-business support already addresses.

**b. There is no disbursement path for the orders that genuinely need one.**
A cart spanning two sellers is one bKash transfer to one number; physics does
not care how many businesses exist. Those orders will always need the platform
to redistribute, and there is no provider integration to do it.

**c. `stores.payoutAccountRef` does not match the market.**
Modelled as "an opaque reference from the payment provider", with a correct
decision not to store bank details — reasoning that holds for a card processor
already holding them. For bKash the account *is* a phone number and nobody is
holding it for us, so today the column is null or a reference to nothing. If
sellers become Jomma businesses, the destination stops being our problem for
those orders; if not, this has to store something we can actually pay.

**d. The platform holds float.**
Between a buyer paying and a seller being paid, the money sits in an account
the platform controls. In Bangladesh, holding funds on behalf of others may
require a licence. A question for a lawyer, not an architect, and better
answered before volume than after. Per-seller routing shrinks the exposure to
multi-seller carts only.

**e. Refund after payout has no recovery path.**
If a seller's part of an order is refunded after they have been paid,
`recordOrderReversed` reverses the ledger and the store shows a negative
balance — but nothing collects it, and a store that never trades again keeps it.

**f. Cash on delivery cannot be recorded as paid — deferred on purpose.**
Every route to `recordOrderPaid` is a webhook, the Jomma poll, or the dev-only
demo button, so on production a COD order can never reach `paid`. Cash handed
over at the door never enters the ledger, never credits the seller and never
reaches a payout.

**Decided 2026-09-10: do not build a manual "cash collected" button.** A parcel
company's API is coming, and delivery *is* the collection event for COD — that
integration is the natural place for it, and a hand-operated button built now
would be thrown away or, worse, left as a second way to settle an order.

Worth knowing when that work starts: it collides with everything above. Cash is
collected per parcel, per seller, on different days, while `recordOrderPaid`
settles a whole order at once. A two-seller COD order is two couriers and two
amounts, so the courier integration will need money to move at sub-order level
— which is the same shape change per-seller Jomma businesses would want.

**g. Overpayment has no operator record.**
`ORD-2026-000016` was overpaid by ৳11. The buyer's page says "We owe you back
৳11.00"; our only trace is a `console.warn` in
[app/api/webhooks/jomma/route.ts](../app/api/webhooks/jomma/route.ts). No
`refund_requests` row, nothing in any admin queue. The page promises something
no system is tracking.

## Options, when this gets planned

1. **Status quo.** Central collection, manual payout. The ledger already does
   the hard part. Cost is a person doing transfers; it stops scaling well before
   the rest of the system does.

2. **Per-seller Jomma businesses, everywhere.** Each store becomes a business
   with its own receiving account. Single-seller carts settle directly and need
   no payout. Multi-seller carts become several intents, so the buyer makes one
   transfer per seller — which gives up "one cart, one payment", the thing the
   `orders` / `sub_orders` split exists to deliver.

3. **Hybrid — probably the interesting one.** Per-seller businesses, and route
   by cart shape: a single-seller cart raises its intent against that seller's
   business and settles directly; a multi-seller cart collects centrally and is
   redistributed as today. Most carts are single-seller, so this removes most of
   the payout work and most of the float while keeping one payment where it
   actually matters. Cost is two code paths through checkout and an onboarding
   step where a seller pairs a phone.

4. **Central collection, automated payout.** Keep everything, automate only the
   last step. Needs a disbursement provider or a bKash merchant agreement —
   mostly commercial work rather than code, and explicitly not Jomma.

Option 3 is the one to cost out first: it is the only one that reduces the
problem instead of moving it, and the platform capability it depends on already
exists.
