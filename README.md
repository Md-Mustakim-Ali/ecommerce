# ecommerce

A multi-vendor marketplace. Sellers own stores, list products, and get paid out.
Buyers browse across stores, put items from several sellers in one cart, and
check out once.

- [AGENTS.md](AGENTS.md) — stack, hard rules, conventions. Read first.
- [docs/schema.md](docs/schema.md) — data model.
- [docs/build-plan.md](docs/build-plan.md) — phased milestones.
- [docs/ui-brief.md](docs/ui-brief.md) — UI requirements and navigation plan.

Current state: **Phase 0 complete.** Nothing is designed yet — the placeholder
screens exist only to prove the auth loop works end to end.

---

## Setup

Requires Node 22+, pnpm, and Docker.

```bash
pnpm install
cp .env.example .env.local
```

Fill in `BETTER_AUTH_SECRET` in `.env.local`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Start Postgres and apply migrations:

```bash
pnpm db:up && pnpm db:migrate
```

Run it:

```bash
pnpm dev
```

Then sign up at http://localhost:3000/sign-up and you should land on
`/account` with your email rendered server-side.

---

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm lint` / `pnpm lint:fix` | Biome check |
| `pnpm typecheck` | Route typegen, then `tsc --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm db:up` / `pnpm db:down` | Postgres 18 container |
| `pnpm db:generate` | Generate a migration from the Drizzle schema |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm auth:generate` | Regenerate `lib/db/schema/auth.ts` from the Better Auth config |

`lib/db/schema/auth.ts` is generated. Do not hand-edit it — change
`lib/auth/index.ts` and re-run `pnpm auth:generate`, then `pnpm db:generate`.
