# AGENTS.md

Context for AI agents working in this repo. Read this before writing code.

---

## What this is

A multi-vendor ecommerce marketplace. Sellers create stores, list products, and
get paid out. Buyers browse across all stores, put items from multiple sellers in
one cart, and check out once.

Three surfaces, three different quality bars:

| Surface | Who | Bar |
|---|---|---|
| Storefront | Buyers | Obsessive. This is the product. |
| Seller dashboard | Sellers | Dense, fast, plain. Boring is correct. |
| Admin panel | Us | Functional. Never seen by customers. |

Do not spend design effort on the dashboard or admin. Spend it on the storefront.

---

## Stack

Pinned as of September 2026. Do not upgrade major versions without being asked.

### Core

```
next            16.3.3        Active LTS. App Router. Turbopack (default).
react           19.2.7        React Compiler enabled.
typescript      5.x           strict: true. No `any` without a comment explaining why.
node            22 LTS
pnpm                          Package manager. Not npm, not yarn.
```

### Data

```
postgresql      18.x          Use uuidv7() for all primary keys.
drizzle-orm     0.45.x        Schema in TypeScript. drizzle-kit for migrations.
redis                         Sessions, cart, rate limiting. Add in Phase 3, not before.
```

### UI

```
tailwindcss     4.3.x         CSS-first config via @theme. No tailwind.config.js.
shadcn/ui                     Base UI base (NOT Radix). `npx shadcn init --base base`
@base-ui/react  1.6.x         Headless primitives.
motion          13.1.x        import from "motion/react". NOT "framer-motion".
embla-carousel-react          Product image gallery only.
vaul                          Mobile sheets, cart drawer.
@tanstack/react-virtual       Long category/product lists.
```

### Auth & infra

```
better-auth                   Auth.js merged into this. Use the Next.js 16 proxy integration.
                              Email/password + OAuth + RBAC (buyer | seller | admin).
S3 or Cloudflare R2           All images. Never store binaries in Postgres.
```

### Deliberately not included

Do not add these without asking:

- A search engine (Meilisearch, Typesense, Algolia). Postgres full-text search
  is the starting point. Revisit only when search is measurably slow on real data.
- A separate backend service (NestJS, Express). One Next.js app until something hurts.
- A state management library (Redux, Zustand, Jotai). Server Components plus URL
  state plus `useOptimistic` covers this. Ask before adding one.
- GSAP, Lenis, or any smooth-scroll library. Scroll hijacking fights native
  mobile scroll and adds input lag.
- localStorage or sessionStorage for anything that matters.

---

## Hard rules

**Money.** The payout ledger is append-only. Every balance is a `SUM` over
immutable rows. There is no mutable `balance` column anywhere in the schema. If
you find yourself writing `UPDATE ... SET balance`, stop and reconsider.

**Never handle raw card data.** Payment provider tokens only. No PAN, no CVV,
never in the database, never in logs, never in an error message.

**`price_at_purchase` lives on the order item.** Order displays never join to the
live product price. Historical orders must render correctly after a price change.

**Every mutation is a transaction.** Stock decrement, order creation, and payment
record succeed or fail together. Use Drizzle's `db.transaction()`.

**Brands are platform-level.** A store does not own a brand. Deduplication is
enforced by a unique index on a normalized `slug`. New brands enter as `pending`
and require admin approval. See `docs/schema.md`.

**Orders split into sub-orders per store.** One payment, N fulfillments, N payouts.
This is in the schema from day one. Do not defer it.

**Server-side authorization on every mutation.** A seller can only touch their own
store's rows. Check ownership in the server action or route handler, not just in
the UI. Assume the client is hostile.

**Validate at the boundary.** Zod schema on every server action input and every
route handler body. Parse, don't cast.

---

## Directory layout

```
app/
  (shop)/                  Storefront. Public.
  (seller)/dashboard/      Seller-only. Layout-level auth guard.
  (admin)/admin/           Admin-only. Layout-level auth guard.
  api/                     Webhooks and anything that can't be a server action.
components/
  ui/                      shadcn primitives. Restyled, not vanilla.
  shop/                    Storefront components. Where design effort goes.
  dashboard/               Seller components. Plain.
lib/
  db/schema/               Drizzle schema, one file per domain.
  auth/                    Better Auth config and guards.
  money/                   Ledger, payout math. Pure functions, heavily tested.
  validation/              Zod schemas, shared between client and server.
docs/
  schema.md                Data model.
  build-plan.md            Phased milestones.
  ui-brief.md              UI requirements and navigation plan.
```

Colocate tests next to source as `*.test.ts`.

---

## UI conventions

### Tokens before components

Before building any screen, define the token layer in `app/globals.css` using
Tailwind 4's `@theme`. Colors, type scale, radius, spacing rhythm, shadows.
Every component reads from tokens. No hardcoded hex values in components, ever.

### Do not ship default shadcn styling

Default shadcn (slate neutrals, Inter, 0.5rem radius, the standard card shadow) is
instantly recognizable and reads as templated. Treat shadcn as behavior we inherit
and styling we replace. The token layer is a rewrite, not a tweak.

### Design tells to avoid

These are the current defaults that make a page look machine-generated. Avoid all
of them unless there is a specific reason in the brief:

- Warm cream background (~#F4F1EA) with a serif display and terracotta accent (~#D97757).
- Near-black background with one acid-green or vermilion accent.
- Everything chopped into identical rounded cards with the same radius and the
  same soft grey shadow.
- Tracked-out ALL-CAPS eyebrow labels above every heading.
- Meta strings joined with middle dots (`A · B · C`).
- A `→` appended to link and button text.
- Numbered markers (01 / 02 / 03) on content that is not actually a sequence.
- Accenting a single word in a headline with color, italic, or bold.
- Fade-and-slide-up entrance on every section, hover-lift on every card.

### Motion

Try CSS first. Scroll-driven animations (`animation-timeline: scroll()` / `view()`)
and View Transitions are cross-browser baseline now. Use them for reveals, parallax,
and route transitions. They cost zero JavaScript and run on the compositor.

Use Motion only for what CSS cannot do: drag gestures with velocity, interruptible
spring physics, and `layoutId` shared-element morphs.

Rules:
- Animate `transform` and `opacity` only. Never `width`, `height`, `top`, `left`.
- Functional transitions stay under 300ms. Drawers, dropdowns, page changes.
- Default UI spring: `{ type: "spring", stiffness: 400, damping: 30 }`.
- Press feedback fires on `pointerdown`, not `click`. Scale to 0.97.
- Wrap everything in `prefers-reduced-motion`. Use Motion's `useReducedMotion`.
- No non-user-triggered motion except one deliberate moment on the homepage.

### Perceived speed matters more than animation

- `useOptimistic` for add-to-cart. The badge updates instantly, reconciles after.
- Prefetch on hover (desktop) and `pointerdown` (touch).
- Every product image container has an explicit `aspect-ratio` and a blur
  placeholder. Layout shift is the most "dead" thing a page can do.
- `navigator.vibrate(10)` on cart add and variant select. Android only; iOS Safari
  does not support it, so nothing may depend on it.

### Accessibility floor

Visible keyboard focus on every interactive element. Reduced motion respected.
Contrast checked. Form errors announced. This is a floor, not a feature.

---

## Performance budget

Test on a throttled mid-range Android, not on a laptop. That device decides whether
the marketplace feels premium or cheap.

- Category page scrolls at 60fps with 200 products loaded.
- Add-to-cart feels instant regardless of network.
- No layout shift on image load, anywhere.
- Product page LCP under 2.5s on 4G.

---

## Security

Next.js has shipped several critical CVEs in 2026 and now runs a monthly security
release cycle. This is a payments application.

- Stay on Active LTS. Patch monthly.
- Never trust `searchParams` or route params without parsing.
- Rate limit auth endpoints, checkout, and anything that sends email.
- Webhook handlers verify signatures before doing anything else.

---

## Working style

- Read `docs/build-plan.md` and work in phase order. Do not skip ahead.
- Small commits, one concern each.
- When a decision is ambiguous and the answer would be expensive to reverse
  (schema shape, payment provider, money handling), stop and ask rather than guess.
- Do not add a dependency without saying why in the commit message.
- Prefer deleting code to adding a flag.

---

## Open decisions (blocking)

These are not yet decided. Ask before writing code that depends on them.

1. **Target market / country.** Determines the payment provider, and the provider
   determines the payout and KYC schema. This blocks Phase 4.
2. **Payment provider.** Stripe Connect if the market supports it. If not, the
   split-payment flow looks materially different and the schema must reflect it.
3. ~~**Seller storefront customization.**~~ **DECIDED 2026-09-03: constrained
   theming.** Sellers choose an accent color, banner, logo, and one of three
   layout presets. Product page, cart, and checkout stay identical across all
   stores, because consistency there protects conversion. `stores` carries
   `accent_color` and `layout_preset` and nothing more.
4. **Brand identity for the storefront.** Direction decided 2026-09-03:
   **tactile / material** — layered surfaces separated by elevation and subtle
   tint rather than borders, larger radii, generous padding, directional shadows
   that respond to pointer position, desaturated cool base with a warm accent.
   Still open: the specific typeface and the exact color ramp. Propose those at
   the start of Phase 1 and get sign-off before building screens on them.
   See `docs/ui-brief.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
