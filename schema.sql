-- ============================================================
-- Case Closed Pro — Production Schema (PostgreSQL 14+)
-- ============================================================
-- Design approach: relational core for anything you need to
-- filter/index/bill on (org, status, dates, money), JSONB for
-- the flexible nested structures that vary a lot per matter
-- (parties, liens, authority requests, updates, documents).
-- This avoids a 25-table schema while keeping real multi-tenancy
-- and real query performance where it matters.
--
-- Every tenant-owned table has org_id — there is no path to
-- reading another org's data without joining through it.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------
-- Organizations (carriers/TPAs). Everything else hangs off this.
-- ---------------------------------------------------------------
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  persona         TEXT NOT NULL DEFAULT 'carrier' CHECK (persona IN ('carrier','defense')),
  -- Reference only — what the pricing calculator would suggest for
  -- this org's matter volume. Never billed against automatically;
  -- your accounting team invoices and collects payment entirely
  -- outside this system. See GET /api/billing/status in server.js.
  plan_tier       TEXT NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter','growth','enterprise')),
  -- Platform-admin controlled on/off switch. Self-service registration
  -- still creates an org that's immediately 'active' (unchanged
  -- behavior) — this exists so matt@/mike@/sales@cclosed.com can
  -- suspend access on any org, or provision a brand-new customer
  -- directly from the admin panel, without touching the database.
  access_status   TEXT NOT NULL DEFAULT 'active' CHECK (access_status IN ('active','suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Users. Every user belongs to exactly one org.
-- Defense-firm users: model each firm as its own org with
-- persona='defense', then grant them access to specific carrier
-- matters via case_access (below) rather than merging orgs — this
-- keeps a firm's login working across multiple carrier clients
-- without ever mixing two carriers' data. This is also why
-- self-service defense-firm registration matters here: it's the
-- actual mechanism behind "free for defense counsel," not just a
-- nice-to-have signup flow.
-- ---------------------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  persona         TEXT NOT NULL DEFAULT 'carrier' CHECK (persona IN ('carrier','defense')),
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  -- Two-factor authentication (TOTP, RFC 6238 — authenticator apps like
  -- Google Authenticator, Authy, 1Password). totp_secret is only set once
  -- the user has actually confirmed setup with a valid code; totp_enabled
  -- gates whether login requires the second step.
  totp_secret         TEXT,
  totp_enabled        BOOLEAN NOT NULL DEFAULT false,
  totp_backup_codes   TEXT[],  -- bcrypt-hashed one-time recovery codes
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_org ON users(org_id);

-- ---------------------------------------------------------------
-- Password reset tokens. Short-lived, single-use, stored hashed
-- (never the raw token) so a database read alone can't be used to
-- reset someone's password.
-- ---------------------------------------------------------------
CREATE TABLE password_resets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
CREATE INDEX idx_password_resets_token ON password_resets(token_hash);

-- ---------------------------------------------------------------
-- Team invites — the missing piece that lets a customer's own
-- owner/admin add colleagues into THEIR org, instead of every new
-- user self-registering into a brand new separate organization.
-- Same shape as password_resets: token is only ever stored hashed,
-- single-use, short expiry.
-- ---------------------------------------------------------------
CREATE TABLE team_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')), -- owner is never invited, only transferred
  invited_by      UUID NOT NULL REFERENCES users(id),
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_team_invites_org ON team_invites(org_id);
CREATE INDEX idx_team_invites_token ON team_invites(token_hash);
CREATE INDEX idx_team_invites_email ON team_invites(email);

-- ---------------------------------------------------------------
-- Cases (matters). org_id = the CARRIER that owns the matter.
-- Core fields are real columns (filtering/sorting relevant).
-- Everything else lives in `data` as JSONB — same shape the
-- frontend already uses (insurance, exposure, closing, court, etc).
-- ---------------------------------------------------------------
CREATE TABLE cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  matter_no       TEXT NOT NULL,
  client          TEXT NOT NULL,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Active',
  litigation_stage TEXT,
  attorney        TEXT,
  assigned_firm_org_id UUID REFERENCES organizations(id), -- which defense-firm org this is assigned to
  assigned_attorney_user_id UUID REFERENCES users(id), -- which SPECIFIC person this case is assigned to.
  -- `attorney` (below) stays as a display name for reports/exports;
  -- this column is what access control actually checks. A 'member'
  -- role only sees cases assigned to them here; 'owner'/'admin' see
  -- every case in the org (supervisory access) regardless of this.
  carrier         TEXT,
  claim_no        TEXT,
  reserve_amount  NUMERIC(14,2) DEFAULT 0,
  filed_date      DATE,
  deadline_date   DATE,
  value           NUMERIC(14,2) DEFAULT 0,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb, -- parties, exposure, closing, liens, authorityRequests, billing, evidence, experts, settlements, tasks, documents, updates, keyDates, court, opposing, insurance
  -- NOTE on data.updates[]: each entry may carry visibility ('shared' | 'private')
  -- and authorOrgId. Entries marked 'private' are stripped server-side (see
  -- server.js filterCaseForViewer) before the case is ever sent to a user
  -- outside the authoring org — this is what backs the "private to my firm"
  -- notes feature, so defense counsel can keep genuinely privileged work
  -- product out of what the carrier sees.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cases_org ON cases(org_id);
CREATE INDEX idx_cases_status ON cases(org_id, status);
CREATE INDEX idx_cases_firm ON cases(assigned_firm_org_id);
CREATE INDEX idx_cases_attorney ON cases(assigned_attorney_user_id);
CREATE UNIQUE INDEX idx_cases_matter_no ON cases(org_id, matter_no);
-- Speeds up queries into the JSONB blob (liens, authority requests, etc.)
CREATE INDEX idx_cases_data_gin ON cases USING GIN (data jsonb_path_ops);

-- ---------------------------------------------------------------
-- Case access — grants a defense-firm ORG visibility into a
-- specific matter. This is the real access-control mechanism:
-- a defense firm sees ONLY matters explicitly granted here, never
-- the carrier's full portfolio.
-- ---------------------------------------------------------------
CREATE TABLE case_access (
  case_id         UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  firm_org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, firm_org_id)
);

-- ---------------------------------------------------------------
-- Saved report snapshots (mirrors the frontend's Saved Reports).
-- Now actually reachable — GET/POST /api/reports/saved and
-- DELETE /api/reports/saved/:id in server.js.
-- ---------------------------------------------------------------
CREATE TABLE saved_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id),
  report_id       TEXT NOT NULL, -- e.g. 'r10'
  name            TEXT NOT NULL,
  category        TEXT,
  row_count       INTEGER,
  cols            JSONB,
  rows            JSONB,
  ai_summary      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_reports_org ON saved_reports(org_id);

-- ---------------------------------------------------------------
-- Payees and Payables — accounts PAYABLE. The org paying its own
-- outside counsel, claims adjusters, expert witnesses, and other
-- vendors. Deliberately separate from `cases.data.billing` (which
-- is accounts RECEIVABLE — the org billing the carrier/client).
-- ---------------------------------------------------------------
CREATE TABLE payees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'Other' CHECK (type IN ('Outside Counsel','Claims Adjuster','Expert Witness','Court Reporter','Investigator','Vendor','Other')),
  email           TEXT,
  default_rate    NUMERIC(10,2) DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payees_org ON payees(org_id);

CREATE TABLE payables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payee_id        UUID NOT NULL REFERENCES payees(id),
  related_case_id UUID REFERENCES cases(id),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description     TEXT,
  due_date        DATE,
  submitted_date  DATE,
  status          TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Approved','Paid','Rejected')),
  approved_by     UUID REFERENCES users(id),
  paid_date       DATE,
  payment_method  TEXT DEFAULT 'ACH' CHECK (payment_method IN ('ACH','Check','Wire','Other')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payables_org ON payables(org_id);
CREATE INDEX idx_payables_status ON payables(org_id, status);

-- ---------------------------------------------------------------
-- Weekly digest config — one row per org, backs the "Weekly
-- Executive Email" card. Actual sending happens in server.js's
-- in-process scheduler (see the honesty note there about Render
-- free-tier sleep affecting reliability).
-- ---------------------------------------------------------------
CREATE TABLE weekly_digest_config (
  org_id          UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  recipients      TEXT[] NOT NULL DEFAULT '{}',
  day_of_week     TEXT NOT NULL DEFAULT 'Monday' CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  enabled         BOOLEAN NOT NULL DEFAULT false,
  last_sent_week  TEXT
);

-- ---------------------------------------------------------------
-- Backup run log — see backup.js. This is a JSON export snapshot,
-- NOT a real point-in-time database backup. Logged here so you can
-- see at a glance whether the last scheduled run actually succeeded.
-- ---------------------------------------------------------------
CREATE TABLE backup_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          TEXT NOT NULL CHECK (status IN ('success','failed')),
  table_counts    JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  org_id          UUID NOT NULL,
  user_id         UUID,
  action          TEXT NOT NULL,        -- e.g. 'case.update', 'auth.login', 'lien.resolve'
  entity_type     TEXT,                 -- 'case', 'user', 'report'
  entity_id       TEXT,
  detail          JSONB,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_time ON audit_log(org_id, created_at DESC);

-- ---------------------------------------------------------------
-- updated_at auto-touch trigger
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cases_updated BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_payables_updated BEFORE UPDATE ON payables
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------
-- Row-Level Security — belt-and-suspenders on top of the app-layer
-- org_id filtering in every query. Even a bug in application code
-- can't leak cross-tenant data if RLS is enforced at the DB level.
--
-- FIXED (previously present in comments but not actually true):
-- 1. FORCE ROW LEVEL SECURITY is now set on both tables. Without
--    it, Postgres exempts the table's OWNING role from its own
--    policies — and on a typical simple deploy, that owning role is
--    exactly the role this app connects as, which made the policies
--    below decorative for this app's own queries. FORCE closes that.
-- 2. server.js now actually sets `app.current_org_id` via
--    SET LOCAL on a per-request, transaction-scoped connection
--    (see withTenantScope in server.js) — previously nothing set
--    this value, so current_setting() always returned null and the
--    USING clause below never matched anything for a normal app
--    connection either.
-- 3. Added a second, platform-admin-only policy so the admin panel's
--    cross-org directory (GET /api/admin/organizations, which counts
--    cases across every org) can still work under FORCE RLS, via a
--    separate SET LOCAL app.is_platform_admin flag rather than
--    bypassing RLS for the connection entirely.
--
-- Run the actual app as a non-superuser role (e.g. `app_user`) —
-- RLS provides no protection at all against a superuser connection,
-- which always bypasses it regardless of FORCE.
-- ---------------------------------------------------------------
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases FORCE ROW LEVEL SECURITY;
CREATE POLICY cases_tenant_isolation ON cases
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
CREATE POLICY cases_platform_admin_bypass ON cases
  FOR SELECT
  USING (current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY saved_reports_tenant_isolation ON saved_reports
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE payees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payees FORCE ROW LEVEL SECURITY;
CREATE POLICY payees_tenant_isolation ON payees
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables FORCE ROW LEVEL SECURITY;
CREATE POLICY payables_tenant_isolation ON payables
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Note: RLS policies above only cover single-org access for normal
-- (non-platform-admin) connections. The case_access grant table
-- means defense-firm reads need an explicit application-layer query
-- (see server.js scopedCaseQuery) rather than relying on RLS alone,
-- since a firm's org_id legitimately differs from the case's owning
-- org_id — RLS only ever sees the tenant-scoped org_id, not the
-- separate grant relationship.

-- ---------------------------------------------------------------
-- Recommended: create the actual app role RLS assumes. Replace the
-- password below before running in production, and use this role's
-- credentials (not a superuser) in DATABASE_URL.
-- ---------------------------------------------------------------
-- CREATE ROLE app_user WITH LOGIN PASSWORD 'change-me-before-deploying';
-- GRANT CONNECT ON DATABASE your_database_name TO app_user;
-- GRANT USAGE ON SCHEMA public TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
