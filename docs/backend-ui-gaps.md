# Backend capabilities with no interface

A running audit of things the schema and server support that no screen exposes.

This file exists because the gap is easy to miss from the outside: seeded data
makes a read path look finished, and every one of these has a working data
model behind it. The test that catches it is not "does the page render" but
**"could a user have produced this state through the app?"** — apply that to
anything below before ticking it off.

Method, in two passes. The first is necessary and **not sufficient**:
cross-reference `lib/auth/permissions.ts` against call sites. The second is the
one that finds real gaps — check every exported server action for a caller in
`app/` or `components/`. An action nothing calls is a capability with no
interface, even when its permission is checked somewhere.

A third pass helps too: every table, and whether anything writes to it. It is
noisier — Better Auth owns four tables, and a write behind a dynamic table
reference will not grep — but it is what caught the product's category, brand
and tags being immutable after creation.

The second pass is what caught the page builder: `page.update` had call sites
and looked fine, while `addBlockAction` had none, so a page created through the
interface came out empty and stayed empty. The seeded pages had blocks, so the
storefront looked finished.

```bash
# Pass 1 — permissions with no call site.
for p in $(grep -o '"[a-z_]*\.[a-z_.]*"' lib/auth/permissions.ts | tr -d '"' | sort -u); do
  n=$(grep -rl "\"$p\"" app components lib/actions 2>/dev/null | wc -l)
  [ "$n" -eq 0 ] && echo "UNUSED $p"
done

# Pass 2 — server actions no screen calls. This is the one that finds things.
for f in lib/actions/*.ts; do
  grep -oP '^export async function \K\w+' "$f" | while read fn; do
    n=$(grep -rl "$fn" app components 2>/dev/null | wc -l)
    [ "$n" -eq 0 ] && echo "UNCALLED $fn ($(basename $f))"
  done
done
```

Last run: 2026-09-04. Both passes clean — zero unused permissions, zero uncalled actions. Note the script cannot see an
OWNER_ONLY_ACTION unless something writes it as an audit-log `action`, so
treat a hit on one of those four as "not audited" rather than "not built".

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
| Internal order notes | `order.note` | **done** — `order_notes`, visibility `internal` |
| Message a buyer | `customer.contact` | **done** — same table, visibility `buyer`, buyer can reply |
| Delete a product | `product.delete` | **done** — refuses once ordered, name typed back |
| Edit / delete a page | `page.update`, `page.delete` | **done** — delete refuses while published |
| Discount code management | `discount_codes` | **done** — store and platform scopes; sellers see marketplace codes read-only |
| Where a store's offer sits in the product **list** (cards/grid) | `placements` | **done** — new `in_grid` slot, interleaved after the first row |
| Owner-only: transfer ownership, close store, billing, payout destination | 4 hardcoded owner actions | **done** — identity-checked, never permission-checked |
| Add content to a page (blocks) | `page_blocks` | **done** — the eight block types now have an editor; pages used to be created empty and stay empty |
| See your refund requests and their outcome | `refund_requests` | **done** — on the payouts page, with the reviewer's note |
| Change a product's category, brand or tags after creating it | `products.category_id`, `products.brand_id`, `product_tags` | **done** — all three were set once at creation and frozen |
| Edit a discount code after creating it | `discount_codes` | **done** — everything but the code itself, which redemptions point at |
| Edit a banner or offer after creating it | `placements` | **done** — previously delete-and-rebuild, losing the schedule and targeting |
| Author every field a placement block supports | `placements.data` | **done** — the form covered two of four types and silently dropped fields it did not render |

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
| Platform-scope roles | `platform.role.manage` | **done** — with a guard on the last route back in |
| Settings: commission rate | `platform.settings.manage` | **done** — new orders only; past ones keep their snapshotted rate |
| Platform audit log | `platform.audit.view` | **done** |

## Buyer

| Capability | Table | State |
|---|---|---|
| Delete your own review | `reviews` | **done** — only your own; moderation could already remove one, the author could not |
| Saved items / wishlist page | `saved_items` | **done** |
| Saved addresses | `addresses` | **done** — the default pre-fills checkout |

## Infrastructure

| Capability | State |
|---|---|
| Transactional email | **done** — `lib/email` port, console adapter in dev, Resend in production. `requireEmailVerification` now follows whether a provider is configured |
| Real payments | deliberate. Deferred to a separate project; the order page offers a development-only demo settlement that runs the real ledger split |
| Image hosting | local disk via `lib/storage`. Development only — swap the adapter in `lib/storage/index.ts` for S3 or R2 |
| Error tracking, structured logging | **done** — `lib/observability`. Logs redact credentials; reporting is off without a DSN |
| Backups | **done** — `pnpm db:verify-backup` dumps, restores into a scratch database and compares every table |
| Rate limiting | **done** — Postgres-backed fixed windows on sign-in, sign-up, mail-sending endpoints and checkout |

---

## Recurring bug to watch for

Drizzle renders an outer column reference inside a raw `sql` template
**unqualified**. In a correlated subquery Postgres then resolves it against the
subquery's own tables, and if one of them happens to have a column of that name
the query silently returns wrong rows rather than erroring.

Hit four times so far:

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
