# Backend capabilities with no interface

A running audit of things the schema and server support that no screen exposes.

This file exists because the gap is easy to miss from the outside: seeded data
makes a read path look finished, and every one of these has a working data
model behind it. The test that catches it is not "does the page render" but
**"could a user have produced this state through the app?"** — apply that to
anything below before ticking it off.

Method: cross-reference `lib/auth/permissions.ts` against every call site under
`app/`, `components/` and `lib/actions/`. A permission with no call site is a
capability with no interface.

```bash
for p in $(grep -o '"[a-z_]*\.[a-z_.]*"' lib/auth/permissions.ts | tr -d '"' | sort -u); do
  n=$(grep -rl "\"$p\"" app components lib/actions 2>/dev/null | wc -l)
  [ "$n" -eq 0 ] && echo "UNUSED $p"
done
```

Last run: 2026-09-03. 26 of 62 permissions unused at that point; several
have been closed since — re-run the command before trusting the count.

---

## Seller

| Capability | Permission / table | State |
|---|---|---|
| Product list, editor, variant matrix | `product.update`, `variant.manage` | **done** |
| Attribute & value authoring, dedup on add | `attribute.propose` | **done** |
| Stock display controls | `products.stock_display` | **done** |
| Image upload, and tagging images to attribute values | `product_images`, `product_image_attribute_values` | **done** |
| Store profile: name, logo, banner, description, support email | `store.profile.update` | **done** |
| Store appearance: accent colour, layout preset | `store.theme.update` | **done** — fixed palette, three layout presets |
| Refund request | `order.refund` | **done** — files a request; only the platform moves money |
| Internal order notes | `order.note` | missing — no column yet either |
| Message a buyer | `customer.contact` | missing — no messaging model |
| Delete a product | `product.delete` | missing |
| Edit / delete a page | `page.update`, `page.delete` | missing — create and publish exist |
| Discount code management | `discount_codes` | **done** — store and platform scopes; sellers see marketplace codes read-only |
| Where a store's offer sits in the product **list** (cards/grid) | `placements` | missing — product *pages* are done |
| Owner-only: transfer ownership, delete store, billing, payout destination | 4 hardcoded owner actions | missing |

## Platform / admin

| Capability | Permission | State |
|---|---|---|
| Approve / suspend stores | `platform.store.approve`, `platform.store.suspend` | **done** |
| Review proposed attributes | `platform.attribute.review` | **done** — merge-first, with trigram near-matches surfaced |
| Category tree management | `platform.category.manage` | **done** |
| View any order | `platform.order.view` | **done** |
| Approve refunds | `platform.refund.approve` | **done** |
| Initiate payouts | `platform.payout.initiate` | **done** — amount recomputed under a row lock; failure reverses by adding an entry |
| Moderate products | `platform.product.moderate` | **done** — archives rather than deletes |
| Moderate reviews | `platform.review.moderate` | **done** — removed reviews stop counting toward the rating |
| User lookup / suspend | `platform.user.view`, `platform.user.suspend` | **done** — suspension revokes every session |
| Platform-scope roles | `platform.role.manage` | missing — store-scope role editor exists and could be reused |
| Settings: commission rate | `platform.settings.manage` | **done** — new orders only; past ones keep their snapshotted rate |
| Platform audit log | `platform.audit.view` | **done** |

## Buyer

| Capability | Table | State |
|---|---|---|
| Saved items / wishlist page | `saved_items` | **done** |
| Saved addresses | `addresses` | **done** — the default pre-fills checkout |

## Infrastructure

| Capability | State |
|---|---|
| Transactional email | none. `requireEmailVerification` is off and seeded users are marked verified, because nothing can send |
| Real payments | deliberate. Deferred to a separate project; the order page offers a development-only demo settlement that runs the real ledger split |
| Image hosting | local disk via `lib/storage`. Development only — swap the adapter in `lib/storage/index.ts` for S3 or R2 |
| Rate limiting | none |

---

## Recurring bug to watch for

Drizzle renders an outer column reference inside a raw `sql` template
**unqualified**. In a correlated subquery Postgres then resolves it against the
subquery's own tables, and if one of them happens to have a column of that name
the query silently returns wrong rows rather than erroring.

Hit three times so far:

- `listRolesForStore` — `roles.id` became `"id"`, matched `store_members.id`,
  every role reported 0 members
- `storePerformance` / `productPerformance` — date window on a `LEFT JOIN`
  condition, which nulls the joined row instead of excluding it, so both
  reported all time
- `listProductsForStore` — same shape; worked only because an unrelated join
  forced qualification
- `searchUsersAction` — `user.id` became `"id"`, bound to `stores.id`, and
  compared `owner_id` (text) against a uuid; this one at least errored (500)
  rather than returning silently wrong rows

Prefer a separate grouped query or an aliased join over a correlated subquery.
