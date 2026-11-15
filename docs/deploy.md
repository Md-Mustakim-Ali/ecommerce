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

Migrations run **from the build**. `render.yaml`'s build command ends with
`pnpm db:migrate`, after `pnpm build`, so a compile error stops the deploy
before the database is touched and a failed migration fails the deploy with the
old instance still serving.

This reverses the earlier instruction here, which said to run them by hand and
never from the build, on the grounds that overlapping redeploys could race
`drizzle-kit migrate` and half-apply a schema. Two things changed that call.

The race does not half-apply anything. Postgres DDL is transactional and
drizzle applies each migration file inside one transaction, so two builders
arriving together produce one winner and one deploy that fails loudly on
`already exists` — visible and retryable, not silent corruption.

The manual step, meanwhile, failed in practice. In September 2026 four
branches merged and shipped while the production database sat two migrations
behind, because "run it yourself" is a step with nothing to enforce it. A
deploy that migrates itself cannot drift; a human who has to remember can.

What this does demand is that migrations stay **backward compatible**. A deploy
can migrate and then fail its health check and roll back, leaving the new
schema under the old code. Add columns, backfill, and only drop or rename in a
later release once nothing reads them.

To run one by hand anyway — against a database that is not the one Render
deploys to, or to check a migration before shipping it:

```bash
DATABASE_URL="postgresql://…" pnpm db:migrate
```

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

`BETTER_AUTH_SECRET` and `MEDIA_SWEEP_SECRET` are generated for you.

These four are optional — the app boots without them and simply does less:

| Variable | Without it |
|---|---|
| `GMAIL_*` (or `RESEND_API_KEY`) + `EMAIL_FROM` | No receipts, no verification mail, and guest orders never attach to an account |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | No seller can connect Google Drive or YouTube |
| `SENTRY_DSN` | No error tracking |

`GOOGLE_TOKEN_ENCRYPTION_KEY` must be base64 that decodes to **exactly** 32
bytes, which is why the blueprint marks it `sync: false` rather than letting
Render generate it — a generated value passes the schema and then throws the
first time a seller connects:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Adding these to a service that already exists needs a blueprint sync.**
Editing `render.yaml` does not create env vars by itself: Render reads it at
**Blueprints → your blueprint → Manual Sync**. Values already set by hand are
not overwritten.

### Email — Gmail, because there is no domain yet

`EMAIL_FROM` is the `From:` address on every receipt, verification link and
shipment notice. `EMAIL_REPLY_TO` is where a buyer's reply lands; optional,
falls back to `EMAIL_FROM`. Point it at an inbox a person reads, because
`orders@` usually is not one.

There are two providers, and [lib/email/index.ts](../lib/email/index.ts)
prefers **Gmail** when it is configured. Set either the three `GMAIL_*` or the
Resend pair — never both is required, and `EMAIL_FROM` is needed either way.

Gmail leads for one reason, and it is situational rather than technical:
Resend only sends from a domain whose DNS you have verified, and `onrender.com`
belongs to Render. Gmail sends as the account that granted consent, so a plain
`@gmail.com` address works with no DNS at all.

Neither is SMTP, deliberately. **Render blocks outbound SMTP**, so any provider
reached on port 465 or 587 is unusable there — both adapters are HTTPS APIs.

#### Setting Gmail up

In [console.cloud.google.com](https://console.cloud.google.com), on any
project:

1. Enable the **Gmail API**.
2. **OAuth consent screen** → add yourself as a test user → then **publish it**.
   Do not skip publishing. While the screen is in "Testing", Google expires
   refresh tokens after **seven days**: mail works for a week, then stops, and
   nothing surfaces until something tries to send.
3. **Credentials → Create OAuth client ID → Desktop app.** Desktop clients may
   use the loopback redirect the script listens on; a Web client would need the
   URI registered.

Then, locally:

```bash
GMAIL_CLIENT_ID="…apps.googleusercontent.com" \
GMAIL_CLIENT_SECRET="…" \
pnpm tsx scripts/gmail-authorise.mts
```

It opens a consent URL, catches the redirect on localhost, and prints the three
values to put in Render. `EMAIL_FROM` is the address you approved — Gmail
rewrites `From:` to match the authorised account, so a different value is
ignored rather than honoured.

The limits are real but generous for a young shop: **500 recipients a day** on
a free Gmail account, 2,000 on Workspace. Deliverability to non-Gmail inboxes is
adequate, not excellent.

#### Or no email at all

Leaving every provider unset is a legitimate way to launch. The console adapter
takes over and refuses to send in production, which fails loudly rather than
dropping receipts silently. Sign-up and sign-in still work — with email
unconfigured `requireEmailVerification` stays off, so nobody is locked out.
What you lose is receipts, password reset, and the guest-order claim, which
needs a *verified* contact and so never fires.

#### When you do get a domain

Verify it with Resend (three DNS records), set `RESEND_API_KEY` and an
`EMAIL_FROM` on that domain, and clear the three `GMAIL_*`. Resend has bounce
handling, far higher limits, and does not tie the shop's mail to one person's
Google account.

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

## 7. The media sweep — a second cron

Sellers upload product media into their *own* Google Drive and YouTube, and
uploads finish asynchronously. `POST /api/media/sweep` is what reconciles them:
without it, media stays stuck in `processing` and never appears on a product.

Render's free plan has no cron, so this needs an external poker exactly like
Jomma's. On cron-job.org:

```
POST https://ecommerce-web.onrender.com/api/media/sweep
Authorization: Bearer <MEDIA_SWEEP_SECRET from Render>
```

The secret is generated by the blueprint; copy it out of the Render dashboard.
A missing `MEDIA_SWEEP_SECRET` **closes** the endpoint rather than opening it —
a forgotten variable must never be what makes a route public, and this one
makes Google API calls for every store, so an open one is a free way to burn a
seller's daily quota.

Skip this only if no seller has connected Google yet.

## 8. Google OAuth — the redirect URI

Each seller connects their own Google Cloud project, and every one of those
projects must list this app's callback as an authorised redirect URI. It is
built from `BETTER_AUTH_URL`:

```
https://ecommerce-web.onrender.com/api/google/callback
```

A localhost URI left over from development fails at the moment a seller clicks
connect, with Google's own error page rather than anything this app can catch.

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
- [ ] The build's `pnpm db:migrate` step succeeded — check the deploy log, not
      the absence of errors on the site; additive migrations are invisible until
      the code that needs them runs
- [ ] Blueprint synced, so the env vars added since the service was created
      actually exist on it
- [ ] Images migrated to R2 and a product page renders photos
- [ ] `BETTER_AUTH_URL` matches the deployed origin exactly
- [ ] `JOMMA_WEBHOOK_SECRET` === the webhook **endpoint's** `whsec_…`, not the
      `WEBHOOK_SIGNING_SECRET` environment variable
- [ ] Storefront hostname registered under Apps → Hosted checkout
- [ ] The sweep cron is running and authenticated
- [ ] The **media** sweep cron is running too, if any seller uses Google
- [ ] Google callback URI registered in each seller's Cloud project
- [ ] Email sends: the Gmail consent screen is **published** (not Testing, or
      it dies in seven days), or `EMAIL_FROM` is on a Resend-verified domain —
      or email is deliberately unconfigured and you know receipts do not send
- [ ] A real bKash payment flips an order to paid
- [ ] Shipping settings revisited for BDT — the seeded values are dollar-era
      figures reinterpreted as taka (see [jomma.md](jomma.md))
