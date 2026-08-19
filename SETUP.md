# Setup Guide — Items #1–6

This walks through deploying everything built to close out the six blocking
items from the launch readiness checklist. Follow it in order — each step
depends on the one before it.

---

## 0. What you're deploying

- `db/schema.sql` — Postgres schema (multi-tenant: organizations, users, cases, case_access, audit_log)
- `server.js` — the API, rewritten to use that schema, with real auth and Stripe billing
- `case-closed-pro.html` — the product, now wired to call a real backend when configured (falls back to demo mode if not)
- `pricing.html`, `landing.html` — marketing pages, unchanged except footer legal links
- `legal/` — Terms of Service, Privacy Policy, DPA drafts (**attorney review required — see the warning at the top of each file**)

---

## 1. Provision Postgres

Any managed Postgres works. Easiest options if you don't already have one:

- **Render** — Dashboard → New → PostgreSQL. Free tier available for testing.
- **Railway** — New Project → Provision PostgreSQL.
- **Supabase** — Note: if you're using Supabase, its own auth system may be a
  better fit than the custom JWT auth built here — see the note in the
  companion README about Lovable/Supabase as an alternative path.
- **AWS RDS** — more setup, standard choice once you're past early stage.

Whichever you choose, copy the connection string — you'll need it as
`DATABASE_URL` in step 3. It looks like:
`postgres://user:password@host:5432/dbname`

## 2. Run the schema migration

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

This creates all tables, indexes, triggers, and Row-Level Security
policies. Run it once against a fresh database. It is not written to be
safely re-run (no `IF NOT EXISTS` guards on the tables themselves) — if you
need to re-run it during development, drop the tables first or use a fresh
database.

**Verify it worked:**
```bash
psql "$DATABASE_URL" -c "\dt"
```
You should see: `organizations`, `users`, `cases`, `case_access`,
`saved_reports`, `audit_log`.

## 3. Set environment variables for the backend

```bash
# Required
DATABASE_URL=postgres://...          # from step 1
JWT_SECRET=<generate a long random string, e.g. `openssl rand -base64 48`>

# Recommended
ALLOWED_ORIGIN=https://yourapp.com   # lock CORS to your real frontend domain
PORT=3001

# Optional — server-to-server API access (bulk imports from external systems)
API_KEY=<another long random string>

# Optional — email sending (Reports → Email)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<your SendGrid/Postmark/etc API key>
FROM_EMAIL=reports@yourapp.com

# Optional — Stripe billing (see step 4 for how to get these)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=https://yourapp.com          # used to build Stripe checkout redirect URLs
```

Every optional block degrades gracefully if left unset — email sending
returns a clear 503, billing endpoints return a clear 503, the server-to-
server API key path is simply disabled. Nothing crashes.

## 4. Create Stripe products (for real billing)

1. Stripe Dashboard → Product Catalog → **+ Add Product**.
2. Create **"Case Closed Pro — Starter"**, recurring price, $2,500/month.
   Copy its Price ID (`price_...`) → `STRIPE_PRICE_STARTER`.
3. Create **"Case Closed Pro — Growth"**, recurring price, $6,500/month.
   Copy its Price ID → `STRIPE_PRICE_GROWTH`.
4. Enterprise has no self-serve price by design — it's a "contact sales"
   tier, matching the pricing calculator.
5. Dashboard → Developers → API Keys → copy your secret key →
   `STRIPE_SECRET_KEY`. Use a **test mode** key first and switch to live
   only once you've smoke-tested checkout end-to-end.
6. Dashboard → Developers → Webhooks → **+ Add endpoint** → URL:
   `https://your-deployed-api.com/api/billing/webhook` → select events:
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed` → copy the
   signing secret → `STRIPE_WEBHOOK_SECRET`.

## 5. Deploy the backend

Any Node host works (Render, Railway, Fly.io, a VPS with `pm2`). Example
for Render:

1. Push this code to a GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add all the environment variables from step 3.
5. Deploy. Confirm it's alive:
   ```bash
   curl https://your-deployed-api.com/api/health
   ```
   You should get `{"ok":true,"db":"connected"}`. If `db` shows
   `"unreachable"`, double check `DATABASE_URL`.

## 6. Point the frontend at the real backend

By default, `case-closed-pro.html` runs in pure demo mode (in-memory data,
no real auth). To connect it to what you just deployed, add one line
**before** the existing `<script>` tag that contains the app:

```html
<script>window.CCP_API_BASE = 'https://your-deployed-api.com';</script>
```

That's the entire integration switch. With it set: login calls the real
`/api/auth/login`, case edits sync to Postgres in the background, and the
Plan & Billing tab shows real subscription status with a working "Upgrade"
button. Without it: everything behaves exactly like the original prototype.

Deploy the HTML files (this one, `pricing.html`, `landing.html`) to
whatever static host you're using — Lovable, Netlify, GitHub Pages, or
alongside the API server itself.

## 7. Legal documents

The drafts in `legal/` are **not ready to publish as-is** — see the warning
at the top of each file. Before launch:

1. Send all three to counsel for review, tailored to your actual entity
   name, jurisdiction, and customer base.
2. Fill in every `[BRACKETED]` placeholder.
3. Replace the raw `.md` file links in `landing.html`'s footer with
   properly rendered HTML pages (or a docs tool) once finalized — linking
   directly to markdown source isn't a great look for a customer-facing
   legal page, even though it's fine as a working draft today.

## 8. End-to-end smoke test before calling this "launched"

- [ ] Register a new carrier account through the real login screen — confirm a row appears in `organizations` and `users`.
- [ ] Create a matter, refresh the page, confirm it persisted (proves the frontend↔backend wiring actually works, not just demo mode).
- [ ] Register a second account with persona "defense," confirm it sees zero matters until explicitly shared via `POST /api/cases/:id/share`.
- [ ] Run a Stripe test-mode checkout end to end, confirm the webhook updates `subscription_status` to `active`.
- [ ] Confirm `/api/health` and error responses don't leak stack traces or secrets.
- [ ] Confirm `ALLOWED_ORIGIN` is actually locked down (not still `*`) before flipping `STRIPE_SECRET_KEY` from test to live.
