# Deploying, on free tiers

Three services, all free, all permitting commercial use:

| Layer | Service | Why this one |
|---|---|---|
| App | Netlify | The only free host that runs Next.js 16 App Router and Server Actions on a real Node runtime *and* allows commercial use. |
| Database | Neon | The only free Postgres offering **PG 18**, which `uuidv7()` defaults require. |
| Images | Cloudflare R2 | Zero egress, so photos never consume the Netlify bandwidth budget. |

**Vercel's Hobby plan is not an option.** Its Fair Use Guidelines define
commercial usage to include "any method of requesting or processing payment
from visitors of the site" — a bKash checkout violates it on day one. Pro is
$20/month.

## 1. Database — Neon

Create a project and **explicitly select Postgres 18**. Neon defaults to 17,
and on 17 the migrations fail immediately: `uuidv7()` is the `DEFAULT` on every
primary key in this schema and does not exist before 18.

Copy the **pooled** connection string — the one with `-pooler` in the host.
`lib/db/index.ts` sets `prepare: false` on serverless precisely because that
endpoint runs in transaction mode.

```bash
DATABASE_URL="postgresql://…-pooler.…neon.tech/…?sslmode=require"
```

Then run the migrations once, from your machine:

```bash
pnpm db:migrate
```

Not from CI. Netlify builds run concurrently, and a redeploy triggered mid-build
gives two builders racing `drizzle-kit migrate` against one database.

**Free tier limits that matter:** 0.5 GB storage, 100 compute-hours per project
per month, and compute scales to zero after 5 minutes idle. Hitting either
suspends the database until the next cycle.

## 2. Images — Cloudflare R2

Create a bucket, enable public access (this gives you an `r2.dev` URL, or attach
a custom domain), and create an S3-compatible API token with **Object Read &
Write** scoped to that bucket.

```bash
R2_ACCOUNT_ID="…"
R2_ACCESS_KEY_ID="…"
R2_SECRET_ACCESS_KEY="…"
R2_BUCKET="…"
R2_PUBLIC_URL="https://pub-xxxx.r2.dev"   # no trailing slash
```

All five or none — [lib/storage/index.ts](../lib/storage/index.ts) falls back to
local disk if any is missing, which silently breaks uploads in production.

`next.config.ts` reads the hostname out of `R2_PUBLIC_URL` and adds it to the
`<Image>` allowlist automatically, so there is nothing to keep in sync. It
throws on a malformed URL rather than letting every photo go silently missing.

Cloudflare requires a payment method on file to activate R2. It is not charged
within the free 10 GB.

### Move the images you already have

```bash
pnpm tsx --env-file=.env.local scripts/migrate-images-to-r2.ts --dry-run
pnpm tsx --env-file=.env.local scripts/migrate-images-to-r2.ts
```

Every existing row points at `/uploads/…`, which 404s the moment there is no
local disk. The script is idempotent and updates each row only after its upload
succeeds, so an interrupted run leaves rows pointing at files that still work.

## 3. App — Netlify

Connect the GitHub repo. `netlify.toml` sets the build command, Node 22 and the
build memory; the Next.js runtime is auto-detected.

Set every variable from `.env.example` in **Site configuration → Environment
variables**, and set `BETTER_AUTH_URL` to the deployed origin. Better Auth
compares the request `Origin` against it and returns `403 INVALID_ORIGIN` on a
mismatch, which presents as sign-in silently failing.

### The limit that will bite

The free plan is **300 credits/month**: a production deploy costs 15, bandwidth
20 per GB, compute 10 per GB-hour, requests 2 per 10k. When the budget runs out
**every project on the account pauses** until the next cycle, and you cannot pay
past it without upgrading.

Ten deploys leaves roughly 7 GB of traffic. Serving images from R2 is what makes
that workable — it is the difference between spending the budget on HTML and
spending it on photographs.

Watch the compute line: every Server Action and every server-rendered page is a
billed function invocation.

## 4. Jomma

Register the deployed hostname under **Apps → Hosted checkout**. An app with no
registered hostnames gets *no* redirect at all rather than any redirect it asks
for, so checkout will fail to return the buyer.

Point the webhook at:

```
POST https://<your-host>/api/webhooks/jomma
```

Set `JOMMA_URL`, `JOMMA_API_KEY` and `JOMMA_WEBHOOK_SECRET` in Netlify. Without
them the app still boots and simply does not offer bKash or Nagad — see
[docs/jomma.md](jomma.md).

**Jomma itself cannot run on Netlify.** It watches a phone for SMS, which is a
persistent process, not a serverless function. It needs somewhere that stays
running.

## Before going live

- [ ] Neon project is on **Postgres 18**, using the **pooled** string
- [ ] `pnpm db:migrate` run once against production
- [ ] Images migrated to R2 and a product page renders photos
- [ ] `BETTER_AUTH_URL` matches the deployed origin exactly
- [ ] Deployed hostname registered with Jomma
- [ ] A signed webhook reaches `/api/webhooks/jomma` and marks an order paid
- [ ] Shipping settings revisited for BDT — the seeded values are still
      dollar-era figures reinterpreted as taka (see the note in
      [docs/jomma.md](jomma.md))
