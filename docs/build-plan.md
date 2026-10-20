# Build plan

Work in phase order. Each phase ends in something runnable. Do not start a phase
until the previous one works end to end.

Ask before starting Phase 4. It depends on decisions that are not made yet.

---

## Phase 0 — Foundation

- `pnpm create next-app` with TypeScript, Tailwind 4, App Router, Turbopack.
- `npx shadcn init --base base` (Base UI, not Radix).
- Drizzle plus `drizzle-kit`, connected to local Postgres 18.
- Better Auth installed, its schema generated, Next.js 16 proxy integration wired.
- Biome or ESLint plus Prettier. Vitest. A `docker-compose.yml` with Postgres.
- React Compiler enabled in `next.config.ts`.

**Done when:** `pnpm dev` boots, a migration runs, a user can sign up and see
their email on a protected page.

---

## Phase 1 — Design system

Do this before building screens. Retrofitting tokens is miserable.

- Choose typefaces and palette. **Ask first** — see open decision #4 in AGENTS.md.
- Write the `@theme` block in `app/globals.css`: color ramp, type scale, radius,
  spacing rhythm, shadows, motion durations, easing.
- Restyle the shadcn primitives you will actually use: button, input, select,
  dialog, sheet, dropdown, badge, toast.
- Build a `/dev/tokens` page showing every token and every component state.
  This is internal, but it is how you catch inconsistency early.
- Set up `prefers-reduced-motion` handling globally.

**Done when:** nothing in the app reads as default shadcn, and no component
contains a hardcoded color.

---

## Phase 2 — Catalog

- Full schema from `docs/schema.md`, migrated.
- A seed script with realistic data: 5 stores, 20 brands, 8 categories, 200
  products with variants and images. Realistic volume matters for catching
  performance problems now instead of at launch.
- Seller onboarding: create a store, upload logo and banner.
- Product CRUD in the seller dashboard: create, edit, variants, image upload to
  S3/R2, draft and publish.
- Brand search-then-propose flow, plus the admin approval queue.
- Storefront browse: category pages, product grid, product detail page.
- Postgres full-text search with filters (category, brand, price range).

**Done when:** a seller can list a product and a buyer can find it by searching.

---

## Phase 3 — The feel

This is the phase that decides whether the marketplace reads as premium or cheap.
Roughly 8 surfaces. Take the time.

- **Product card.** Press state on `pointerdown`, hover prefetch, correct
  `aspect-ratio` with blur placeholder, no layout shift.
- **Product page.** Embla gallery with pinch-zoom, variant selector that shows
  which combinations are out of stock rather than failing after selection.
- **Card to page morph.** View Transitions API, or Motion `layoutId` where the
  native API falls short.
- **Cart drawer.** Vaul. Drag-to-dismiss with a velocity threshold.
- **Optimistic add-to-cart.** `useOptimistic`. Badge updates instantly.
- **Filter and sort.** URL state, no full page reload, results update in place.
- **Virtualized category scroll.** `@tanstack/react-virtual` past ~100 items.
- **Empty, loading, and error states** for all of the above. An empty screen is
  an invitation to act, not a shrug.

Add Redis here for cart and rate limiting if Postgres write load justifies it.

**Done when:** the storefront holds 60fps on a throttled mid-range Android, and
nothing anywhere shifts on load.

---

## Phase 4 — Checkout and money

**Stop. Ask before starting.** This phase depends on target market and payment
provider, which are still open. Getting the schema wrong here is expensive.

- Checkout flow. Guest checkout allowed. Shipping cost shown before the final
  step, never revealed at the end.
- Order creation splitting into `sub_orders` per store, inside one transaction
  with stock decrement.
- Payment intent, webhook handler with signature verification, idempotency keys.
- Ledger entries written on payment success: sale credit, commission debit.
- Refund flow writing negative entries.
- Seller payout dashboard reading the ledger.
- Admin payout initiation.

Every function in `lib/money/` gets unit tests. This is the one place where a bug
costs real money.

**Done when:** a multi-store order can be placed, paid, split, fulfilled, and
paid out, and the ledger sums correctly at every step.

---

## Phase 5 — Operations

- Order management for sellers: accept, ship, add tracking.
- Buyer order history and tracking view.
- Reviews, tied to `order_item_id`.
- Transactional email: order confirmation, shipping, payout notice.
- Admin: store approval, brand queue, dispute handling.
- Rate limiting on auth, checkout, and email-sending endpoints.

---

## Phase 6 — Launch readiness

- Sentry or equivalent, with source maps.
- Structured logging. Never log payment data or tokens.
- Database backups, tested by actually restoring one.
- Load test checkout specifically.
- Accessibility audit: keyboard-only pass, screen reader pass on checkout.
- Lighthouse on real devices, not just CI.
- Security review: authorization on every mutation, no IDOR on seller routes.

---

## Ongoing

Next.js runs a monthly security release cycle and has shipped several critical
CVEs in 2026. Schedule a monthly patch window. This is a payments application;
falling behind is not an acceptable default.
