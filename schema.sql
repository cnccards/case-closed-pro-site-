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
  plan_tier       TEXT NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter','growth','enterprise')),
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  subscription_status     TEXT DEFAULT 'trialing', -- trialing | active | past_due | canceled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Users. Every user belongs to exactly one org.
-- Defense-firm users: model each firm as its own org with
-- persona='defense', then grant them access to specific carrier
-- matters via case_access (below) rather than merging orgs — this
-- keeps a firm's login working across multiple carrier clients
-- without ever mixing two carriers' data.
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_org ON users(org_id);

-- ---------------------------------------------------------------
-- Cases (matters). org_id = the CARRIER that owns the matter.
-- Core fields are real columns (filtering/sorting/billing-relevant).
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
  carrier         TEXT,
  claim_no        TEXT,
  reserve_amount  NUMERIC(14,2) DEFAULT 0,
  filed_date      DATE,
  deadline_date   DATE,
  value           NUMERIC(14,2) DEFAULT 0,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb, -- parties, exposure, closing, liens, authorityRequests, billing, evidence, experts, settlements, tasks, documents, updates, keyDates, court, opposing, insurance
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cases_org ON cases(org_id);
CREATE INDEX idx_cases_status ON cases(org_id, status);
CREATE INDEX idx_cases_firm ON cases(assigned_firm_org_id);
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
-- Audit log — every meaningful mutation, who did it, when.
-- Append-only; never update or delete rows here.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Row-Level Security — belt-and-suspenders on top of the app-layer
-- org_id filtering in every query. Even a bug in application code
-- can't leak cross-tenant data if RLS is enforced at the DB level.
-- The app connects as `app_user` (not a superuser) and sets
-- `app.current_org_id` per request via SET LOCAL.
-- ---------------------------------------------------------------
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY cases_tenant_isolation ON cases
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_reports_tenant_isolation ON saved_reports
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Note: RLS policies above only cover single-org access. The
-- case_access grant table means defense-firm reads need an explicit
-- application-layer query (see server.js) rather than relying on
-- RLS alone, since a firm's org_id legitimately differs from the
-- case's owning org_id.
