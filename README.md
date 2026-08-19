# Case Closed Pro

Carrier-grade litigation intelligence — a shared platform for insurance
claims teams and their defense counsel to track litigated matters from
assignment through a closing package claims can actually act on. Priced by
open litigated matters, not per-seat licenses; defense firms get unlimited
free access.

This repo (or repos — see **Repo Structure** below) contains the product
itself, the marketing site, the backend API, and everything needed to take
it from prototype to a real deployment.

---

## What's in here

### Frontend — static HTML, no build step
| File | What it is |
|---|---|
| `case-closed-pro.html` | The product itself. Litigation dashboard, case workspace, closing & claims handoff, reporting, API/import tools, billing. Runs in **demo mode** (in-memory data, fake login) until you set `window.CCP_API_BASE` — see `SETUP.md`. |
| `landing.html` | Public marketing homepage. Rename to `index.html` when deploying. |
| `pricing.html` | Full pricing page with the live matter-volume calculator and FAQ. |
| `roi-calculator.html` | Sales tool — editable ROI calculator showing estimated savings vs. platform cost. |

### Backend — Node/Express + Postgres
| File | What it is |
|---|---|
| `server.js` | The API: auth (JWT + bcrypt), multi-tenant case CRUD, Stripe billing, report emailing. Requires a real Postgres database — see `db/schema.sql`. |
| `package.json` | Backend dependencies. |
| `db/schema.sql` | Postgres schema — organizations, users, cases, tenant isolation, audit log. Run this once against a fresh database before starting the server. |

### Legal (drafts — not ready to publish as-is)
| File | What it is |
|---|---|
| `legal/terms-of-service.md` | ToS draft. |
| `legal/privacy-policy.md` | Privacy policy draft. |
| `legal/data-processing-agreement.md` | DPA draft. |

**Every file in `legal/` has an attorney-review warning at the top and is
not ready to publish as-is.** Given this product handles claimant PII and
medical/injury information via liens, don't skip that step.

### Guides
| File | What it covers |
|---|---|
| `SETUP.md` | The full path from zero to a real deployment: provision Postgres, run the migration, configure Stripe, deploy the backend, connect the frontend. Start here. |
| `VERCEL_DEPLOY.md` | Deploying the static frontend to Vercel. |
| `GITHUB_PAGES_DEPLOY.md` | Deploying the static frontend to GitHub Pages (the free, no-commercial-use-restriction option). |
| `launch-readiness-checklist.md` | What's still missing before this is truly launch-ready, organized by how blocking each item is. |

---

## Quick start (local, demo mode — no backend required)

The product works standalone with seeded demo data and no setup:

```bash
open case-closed-pro.html    # or just double-click it
```

Log in with any email/password. This is the fastest way to explore or demo
the product before wiring up a real backend.

## Quick start (real backend)

1. Follow `SETUP.md` end to end: provision Postgres → run
   `db/schema.sql` → set environment variables → deploy `server.js`.
2. Add one line to `case-closed-pro.html`, right before its `<script>` tag:
   ```html
   <script>window.CCP_API_BASE = 'https://your-deployed-api.com';</script>
   ```
3. Deploy the frontend per `VERCEL_DEPLOY.md` or `GITHUB_PAGES_DEPLOY.md`.

---

## Repo structure

**Simplest (recommended): two repos.** One for the four static HTML files
(deployed to Vercel or GitHub Pages exactly as those guides describe, no
modification needed), one for `server.js` + `db/` (deployed to
Render/Railway per `SETUP.md`). This is what both deployment guides assume
by default.

```
case-closed-pro-site/          →  Vercel or GitHub Pages
  index.html                   (landing.html, renamed)
  case-closed-pro.html
  pricing.html
  roi-calculator.html
  legal/

case-closed-pro-api/           →  Render or Railway
  server.js
  package.json
  db/schema.sql
```

**Alternative: one repo, two subfolders.** If you'd rather manage
everything in a single repo:

```
case-closed-pro/
  docs/                        ← GitHub Pages: Settings → Pages → source = /docs
    index.html
    case-closed-pro.html
    pricing.html
    roi-calculator.html
    legal/
  server/                      ← Render/Railway: set "Root Directory" to server/
    server.js
    package.json
    db/schema.sql
  SETUP.md
  VERCEL_DEPLOY.md
  GITHUB_PAGES_DEPLOY.md
  launch-readiness-checklist.md
  README.md
```

Either structure works — the deployment guides were written against the
two-repo layout, so that's the path with zero adjustment needed. The
monorepo layout just needs the two settings noted above (Pages source
folder, Render/Railway root directory).

---

## Current status

This is a fully functional prototype with real backend code written and
unit-tested against mocked/simulated data, but **not yet verified against
a live Postgres instance or live Stripe account** (no network access in
the environment this was built in — see `SETUP.md` §8 for the smoke-test
checklist to run before calling this launched). `launch-readiness-checklist.md`
has the full picture of what's done vs. what's still needed.
