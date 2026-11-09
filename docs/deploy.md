# Deploying, on free tiers

Everything here is free and permits commercial use.

| Piece | Where | Why |
|---|---|---|
| Storefront | Render (`render.yaml`) | Real Node container — `sharp`, `postgres-js` and `node:crypto` all work. |
| Jomma | Render (its own `render.yaml`) | A persistent server; cannot run serverless. |
| Both databases | Neon | The only free Postgres offering **PG 18**, which `uuidv7()` requires. |
| Product images | Cloudflare R2 | Zero egress, and Render's free tier has no persistent disk. |
| Jomma's sweep | cron-job.org | Render's cron is not free, and without it no webhook is ever delivered. |

**Vercel Hobby is not an option.** Its Fair Use Guidelines define commercial use
to include "any method of requesting or processing payment from visitors of the
site" — a bKash checkout violates it on day one.

## Why two Render services, not one

Both apps are Next.js servers, and each idles around 200–300 MB. Two of them in
a single 512 MB free instance is an out-of-memory restart loop — and the restart
takes payment verification down with the shop. Jomma also already ships its own
blueprint, so splitting them is less work, not more.

The cost is that Render's **750 free instance-hours are per workspace**, shared.
See "The dial" at the end.

---

## 1. Databases — two Neon projects

Create **two** projects. Neon's free plan gives each its own 0.5 GB and its own
100 compute-hours, so separating them doubles the allowance and stops one app's
load from starving the other.

For the storefront project, **explicitly select Postgres 18**. Neon defaults to
17, and on 17 every migration fails immediately — `uuidv7()` is the `DEFAULT` on
every primary key here and does not exist before 18.

Copy the **pooled** connection string for each — the one with `-pooler` in the
host. [lib/db/index.ts](../lib/db/index.ts) sets `prepare: false` on serverless
precisely because that endpoint runs in transaction mode.

Run the storefront's migrations once, from your machine:

```bash
pnpm db:migrate
```

Not from the build. Render redeploys can overlap, and two builders racing
`drizzle-kit migrate` against one database is how you get a half-applied schema.

## 2. Images — Cloudflare R2

Create a bucket, enable public access (this gives an `r2.dev` URL, or attach a
custom domain), and create an S3-compatible API token with **Object Read &
Write** scoped to that bucket. Cloudflare requires a card on file to activate
R2; it is not charged within the free 10 GB.

Then move the images already on disk:

```bash
pnpm tsx --env-file=.env.local scripts/migrate-images-to-r2.mts --dry-run
pnpm tsx --env-file=.env.local scripts/migrate-images-to-r2.mts
```

Every existing row points at `/uploads/…`, which 404s the moment there is no
local disk. The script is idempotent and updates each row only after its upload
lands.

## 3. Deploy Jomma first

The storefront needs three values that do not exist until Jomma is up.

In Render: **New → Blueprint**, point at the `jomma` repo. Then set the vars its
blueprint marks `sync: false`:

- `DATABASE_URL` — the second Neon project, pooled
- `APP_URL` — `https://jomma-web.onrender.com`, **with the scheme**. Its own
  comments explain why: Better Auth rejects a schemeless baseURL and the cron
  builds `${APP_URL}/api/internal/sweep`, which without a scheme is not
  fetchable — so no jobs run and no webhook is ever delivered.
- `ANDROID_CERT_SHA256` — after building the notifier APK

Render generates `AUTH_SECRET` — **copy it**, it is the bearer token the sweep
cron presents in step 6. `WEBHOOK_SIGNING_SECRET` is also generated but is not
needed by the storefront: it verifies webhooks arriving *into* Jomma from the
Android notifier, not the ones Jomma sends out.

Then mint an API key in the Jomma dashboard for the storefront.

## 4. Deploy the storefront

**New → Blueprint**, point at this repo. Set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | The PG 18 Neon project, pooled |
| `BETTER_AUTH_URL` | `https://ecommerce-web.onrender.com` |
| `JOMMA_URL` | Jomma's `APP_URL` |
| `JOMMA_API_KEY` | The key you just minted |
| `JOMMA_WEBHOOK_SECRET` | The `whsec_…` shown when you create the webhook endpoint (step 5) |
| `R2_*` | The five from step 2 |

`BETTER_AUTH_SECRET` is generated for you.

The one that silently breaks everything is `JOMMA_WEBHOOK_SECRET`, and there
are two different secrets it is easy to confuse:

- `WEBHOOK_SIGNING_SECRET` is a Jomma *environment variable*. It verifies
  webhooks arriving **into** Jomma from the Android notifier. It is **not** this.
- `webhook_endpoints.secret` — the `whsec_…` shown once when you create the
  endpoint — signs deliveries **out** of Jomma to this store. This is the one.

Get it wrong and every delivery fails verification, the route returns 400, and
orders stay unpaid with no obvious cause.

## 5. Register the storefront with Jomma

Two separate registrations, both in the Jomma dashboard.

**Hosted checkout hostnames** — on the app, add your storefront's hostname. The
schema comment is explicit about why this fails closed: an unchecked
`return_url` is an open redirect on a page the buyer was just told to trust with
a payment. An app with no registered hostnames gets *no* redirect at all, so
buyers never come back from the pay page.

**A webhook endpoint** — URL:

```
https://<your-host>/api/webhooks/jomma
```

Enable every `payment.*` event. Creating it produces a `whsec_…` secret shown
once — that value is `JOMMA_WEBHOOK_SECRET` on the store. It is per-endpoint,
not the `WEBHOOK_SIGNING_SECRET` environment variable.

## 6. The cron — do not skip this

Without it **no webhook is ever delivered** and no intent ever expires. On
[cron-job.org](https://cron-job.org):

```
POST https://jomma-web.onrender.com/api/internal/sweep?group=all
Authorization: Bearer <AUTH_SECRET>
```

## The dial

Three free limits are in tension, and the sweep interval is what moves between
them:

- **Render:** 750 instance-hours/month, shared by both services. A service stays
  awake 15 minutes after each request, so an hourly sweep keeps Jomma up roughly
  25% of the time (~180 h), leaving plenty for the shop. A sweep every 14
  minutes never lets it sleep (~730 h) and starves the storefront.
- **Neon:** 100 compute-hours/month *per project*. Each sweep wakes Jomma's
  database for about 5 minutes. Hourly is ~60 h/month and fits; every 30 minutes
  is ~120 h and does not.
- **Latency:** the sweep is what flushes webhooks, so its interval is roughly
  how long a buyer waits for their order to flip from "checking" to paid.

**Hourly is the free-tier sweet spot**, at the cost of up to an hour before a
payment confirms. Jomma's own `docs/deploy.md` covers this trade-off — check it,
since you wrote it.

Both services sleep after 15 minutes idle and take 30–60 seconds to wake.
Nothing is lost when Jomma is asleep: the phone retries captures from its own
queue, and the webhook handler here is idempotent and keyed on `event.id`, so a
redelivery is a no-op.

## Before going live

- [ ] Storefront's Neon project is **Postgres 18**, using the **pooled** string
- [ ] `pnpm db:migrate` run once against it
- [ ] Images migrated to R2 and a product page renders photos
- [ ] `BETTER_AUTH_URL` matches the deployed origin exactly
- [ ] `JOMMA_WEBHOOK_SECRET` === the webhook **endpoint's** `whsec_…`, not the
      `WEBHOOK_SIGNING_SECRET` environment variable
- [ ] Storefront hostname registered under Apps → Hosted checkout
- [ ] The sweep cron is running and authenticated
- [ ] A real bKash payment flips an order to paid
- [ ] Shipping settings revisited for BDT — the seeded values are dollar-era
      figures reinterpreted as taka (see [jomma.md](jomma.md))
