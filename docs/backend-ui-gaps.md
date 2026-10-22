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

Last run: 2026-09-03. 26 of 62 permissions unused.

---

## Seller

| Capability | Permission / table | State |
|---|---|---|
| Product list, editor, variant matrix | `product.update`, `variant.manage` | **done** |
| Attribute & value authoring, dedup on add | `attribute.propose` | **done** |
| Stock display controls | `products.stock_display` | **done** |
| Image upload, and tagging images to attribute values | `product_images`, `product_image_attribute_values` | missing — the storefront already switches the photo on option change, but only seeded rows carry tags |
| Store profile: name, logo, banner, description, support email | `store.profile.update` | missing |
| Store appearance: accent colour, layout preset | `store.theme.update` | missing — columns exist on `stores` |
| Refund request | `order.refund` | missing — `recordRefund()` exists and is tested |
| Internal order notes | `order.note` | missing — no column yet either |
| Message a buyer | `customer.contact` | missing — no messaging model |
| Delete a product | `product.delete` | missing |
| Edit / delete a page | `page.update`, `page.delete` | missing — create and publish exist |
| Discount code management | `discount_codes` | missing — codes work end to end, but only SQL can create them |
| Where a store's offer sits in the product **list** (cards/grid) | `placements` | missing — product *pages* are done |
| Owner-only: transfer ownership, delete store, billing, payout destination | 4 hardcoded owner actions | missing |

## Platform / admin

| Capability | Permission | State |
|---|---|---|
| Approve / suspend stores | `platform.store.approve`, `platform.store.suspend` | missing — `/admin` links to `/admin/stores`, which does not exist |
| Review proposed attributes | `platform.attribute.review` | missing — brands and tags have a queue; attributes do not |
| Category tree management | `platform.category.manage` | missing |
| View any order | `platform.order.view` | missing |
| Approve refunds | `platform.refund.approve` | missing |
| Initiate payouts | `platform.payout.initiate` | missing — `payouts` table and seller-side history exist; nothing writes a payout |
| Moderate products | `platform.product.moderate` | missing |
| Moderate reviews | `platform.review.moderate` | missing — `reviews.status` supports flagged/removed |
| User lookup / suspend | `platform.user.view`, `platform.user.suspend` | missing |
| Platform-scope roles | `platform.role.manage` | missing — store-scope role editor exists and could be reused |
| Settings: commission rate | `platform.settings.manage` | missing — commission is `DEFAULT_COMMISSION_BPS` in code |
| Platform audit log | `platform.audit.view` | missing — store-scoped audit UI exists |

## Buyer

| Capability | Table | State |
|---|---|---|
| Saved items / wishlist page | `saved_items` | missing — the save button writes rows nobody can list |
| Saved addresses | `addresses` | missing — checkout retypes the address every order |

## Infrastructure

| Capability | State |
|---|---|
| Transactional email | none. `requireEmailVerification` is off and seeded users are marked verified, because nothing can send |
| Image hosting | none. `product_images.url` holds picsum placeholders; there is no upload path |
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

Prefer a separate grouped query or an aliased join over a correlated subquery.
