/**
 * Case Closed Pro — Production API Server
 * ---------------------------------------------------------------
 * Rewired from the lowdb prototype to real Postgres with real
 * multi-tenancy: every case belongs to an organization (org_id),
 * every query is scoped to the caller's org, and defense-firm
 * access to a carrier's matters is explicit (case_access table),
 * never implicit.
 *
 * Billing is NOT automated here on purpose — your accounting team
 * invoices and collects payment outside this system. See
 * GET /api/billing/status for a reference-only number.
 *
 * Run the schema first:
 *   psql "$DATABASE_URL" -f db/schema.sql
 *
 * Then:
 *   npm install
 *   DATABASE_URL=postgres://... JWT_SECRET=... npm start
 * ---------------------------------------------------------------
 */

import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const { Pool } = pkg;

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY || null; // optional: server-to-server access, see note below
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET not set — using an insecure dev-only secret. Do not deploy like this.');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-insecure-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------
// Sentinel AI Suite — real Claude API calls, server-side only. The
// API key never reaches the browser; every Sentinel endpoint below
// runs on this server and returns just the finished analysis.
// ---------------------------------------------------------------
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const AI_CONFIGURED = !!ANTHROPIC_API_KEY;

async function callClaude(systemPrompt, userPrompt, maxTokens = 1000) {
  if (!AI_CONFIGURED) {
    const err = new Error('AI is not configured on this server. Set ANTHROPIC_API_KEY.');
    err.statusCode = 503;
    throw err;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error('Claude API error: ' + body);
    err.statusCode = 502;
    throw err;
  }
  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

// Trims a case row down to the facts actually relevant to an AI
// prompt — full JSONB blobs (documents, full audit history, etc.)
// would burn tokens on noise without adding useful signal.
function caseSummaryForAI(c) {
  return {
    matterNo: c.matterNo, client: c.client, type: c.type, status: c.status,
    litigationStage: c.litigationStage, attorney: c.attorney, value: c.value,
    carrier: c.insurance?.carrier, reserveAmount: c.insurance?.reserveAmount,
    demandAmount: c.exposure?.demandAmount, offerAmount: c.exposure?.offerAmount,
    likelyExposure: c.exposure?.likelyExposure, bestCase: c.exposure?.bestCase, worstCase: c.exposure?.worstCase,
    filed: c.filed, deadline: c.deadline,
    opposingCounsel: c.opposing?.attorney || c.opposing?.firm,
    recentUpdates: (c.updates || []).slice(-5).map(u => ({ date: u.date, type: u.type, text: u.text })),
  };
}


// ---------------------------------------------------------------
// Platform admins — cross-organization access, distinct from the
// per-org 'owner'/'admin'/'member' roles. These accounts can see and
// manage EVERY customer's organization: provision new ones, suspend
// or reactivate access, adjust plan tiers. Deliberately configured
// via env var (not a database flag tied to one person) so the list
// can change without a migration. Checked by email at login/register
// time — being on this list is what grants access, not org
// membership or role.
// ---------------------------------------------------------------
const PLATFORM_ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS || 'matt@cclosed.com,mike@cclosed.com,sales@cclosed.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function isPlatformAdminEmail(email) {
  return PLATFORM_ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());
}

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Point it at your Postgres instance and re-run.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});
async function q(text, params) {
  return pool.query(text, params);
}

// ---------------------------------------------------------------
// TENANT-SCOPED DATABASE ACCESS (real Row-Level Security enforcement)
// ---------------------------------------------------------------
// Every request that touches `cases` or `saved_reports` — the two
// RLS-protected tables — runs its queries on a dedicated connection
// with `app.current_org_id` set via SET LOCAL, inside a transaction.
// This makes the database itself the enforcement point: even a bug
// in a route handler that forgets a `WHERE org_id = $1` clause still
// can't return another tenant's rows, because Postgres's RLS policy
// (see db/schema.sql) rejects them before this app ever sees them.
// Previously this was aspirational — the policies existed in the
// schema but nothing ever set app.current_org_id, and without FORCE
// ROW LEVEL SECURITY the app's own connection was exempt from its
// own policies anyway. Both are fixed: this middleware sets the
// setting, and the schema now has FORCE on both tables.
//
// req.db.query(...) is what every cases/saved_reports route below
// uses instead of the plain pool-wide q() — q() is still fine for
// routes that only touch organizations/users/etc, which aren't
// RLS-protected.
async function withTenantScope(req, res, next) {
  const client = await pool.connect();
  req.db = client;
  try {
    await client.query('BEGIN');
    if (req.user?.platformAdmin) {
      // Platform-admin routes read across every org on purpose (the
      // admin panel's org directory) — see the matching permissive
      // policy in schema.sql keyed off this same setting, rather
      // than skipping RLS for this connection entirely.
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
    } else {
      await client.query(`SET LOCAL app.current_org_id = $1`, [req.orgId]);
    }
  } catch (e) {
    client.release();
    return res.status(500).json({ error: 'Could not establish tenant scope: ' + e.message });
  }

  const finish = async (commit) => {
    try {
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    } catch (e) {
      console.error('Failed to close tenant-scoped transaction:', e.message);
    } finally {
      client.release();
    }
  };
  res.on('finish', () => finish(res.statusCode < 400));
  res.on('close', () => { if (!res.writableEnded) finish(false); });
  next();
}

// ---------------------------------------------------------------
// Email (optional) — same as before, only used by /api/reports/email.
// ---------------------------------------------------------------
const SMTP_CONFIGURED = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailer = SMTP_CONFIGURED ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

// ---------------------------------------------------------------
// Billing: deliberately NOT automated. Your accounting team invoices
// and collects payment entirely outside this system, through
// whatever process you already use — this app never charges anyone,
// never talks to a payment processor, and holds no card data.
// planTier and matterCount are kept as reference numbers only (what
// the pricing calculator would suggest), for accounting's benefit.
// ---------------------------------------------------------------
function tierForMatterCount(n) {
  if (n <= 250) return 'starter';
  if (n <= 750) return 'growth';
  return 'enterprise';
}

// ---------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function publicUser(u) {
  return { id: u.id, orgId: u.org_id, email: u.email, name: u.name, persona: u.persona, role: u.role, createdAt: u.created_at, totpEnabled: !!u.totp_enabled, platformAdmin: isPlatformAdminEmail(u.email) };
}
function signToken(user) {
  return jwt.sign(
    { sub: user.id, orgId: user.org_id, email: user.email, persona: user.persona, role: user.role, platformAdmin: isPlatformAdminEmail(user.email) },
    EFFECTIVE_JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}
// A short-lived, narrowly-scoped token issued after password is correct
// but before 2FA is verified. It can ONLY be exchanged at
// /api/auth/2fa/login-verify — it does not work as a normal session
// token anywhere else, since it carries no orgId/persona/role.
function signPending2FAToken(user) {
  return jwt.sign({ sub: user.id, pending2fa: true }, EFFECTIVE_JWT_SECRET, { expiresIn: '10m' });
}

// ---------------------------------------------------------------
// TOTP (RFC 6238) — the standard algorithm behind Google
// Authenticator / Authy / 1Password-style 2FA codes. Implemented
// directly on Node's built-in crypto module (HMAC-SHA1) rather than
// pulling in a dependency — this is a well-specified, small, and
// security-sensitive enough algorithm that it's worth being able to
// read and test every line of it directly. Verified against the
// official RFC 6238 Appendix B test vectors (see totp_test.mjs).
// ---------------------------------------------------------------
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '', output = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) output += BASE32_ALPHABET[parseInt(bits.substr(i, 5), 2)];
  if (bits.length % 5 !== 0) {
    const rem = bits.slice(bits.length - (bits.length % 5)).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(rem, 2)];
  }
  return output;
}
function base32Decode(str) {
  let bits = '', bytes = [];
  str = String(str).replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  for (const c of str) {
    const val = BASE32_ALPHABET.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return Buffer.from(bytes);
}
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit secret, standard for TOTP
}
function totpAt(secretBase32, forTimeMs, timeStep = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(forTimeMs / 1000 / timeStep);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
                  ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binCode % (10 ** digits)).toString().padStart(digits, '0');
}
// Allows the code from one step before/after the current one, since
// clocks between a phone and a server are never perfectly in sync.
function verifyTotp(secretBase32, token, windowSteps = 1) {
  token = String(token || '').trim();
  if (!/^\d{6}$/.test(token)) return false;
  const now = Date.now();
  for (let w = -windowSteps; w <= windowSteps; w++) {
    if (totpAt(secretBase32, now + w * 30000) === token) return true;
  }
  return false;
}
function otpauthUrl(secretBase32, email, issuer = 'Case Closed Pro') {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,4}/g).join('-') // e.g. "A1B2-C3D4-E5"
  );
}

// ---------------------------------------------------------------
// Password reset tokens — random, only ever stored hashed.
// ---------------------------------------------------------------
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------
// Audit log — fire-and-forget insert, never blocks the response
// and never throws into the caller if logging itself fails.
// ---------------------------------------------------------------
async function audit(orgId, userId, action, entityType, entityId, detail, ip) {
  try {
    await q(
      `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, detail, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, userId || null, action, entityType || null, entityId || null, detail ? JSON.stringify(detail) : null, ip || null]
    );
  } catch (e) {
    console.error('Audit log write failed (non-fatal):', e.message);
  }
}

// ---------------------------------------------------------------
// Case row <-> API shape helpers.
// DB stores core filterable columns + a `data` JSONB blob holding
// everything else (parties, exposure, closing, liens, etc.) in the
// exact same shape the frontend already uses.
// ---------------------------------------------------------------
function rowToCase(row) {
  return {
    id: row.id,
    matterNo: row.matter_no,
    client: row.client,
    type: row.type,
    status: row.status,
    litigationStage: row.litigation_stage,
    attorney: row.attorney,
    assignedAttorneyUserId: row.assigned_attorney_user_id,
    assignedFirmOrgId: row.assigned_firm_org_id,
    filed: row.filed_date,
    deadline: row.deadline_date,
    value: row.value != null ? Number(row.value) : 0,
    insurance: { carrier: row.carrier, claimNo: row.claim_no, reserveAmount: row.reserve_amount != null ? Number(row.reserve_amount) : 0, ...(row.data?.insurance || {}) },
    ...row.data, // parties, exposure, closing, liens, authorityRequests, billing, evidence, experts, settlements, tasks, documents, updates, keyDates, court, opposing
    _createdAt: row.created_at,
    _updatedAt: row.updated_at
  };
}

// ---------------------------------------------------------------
// Privileged / private notes. An update entry with
// visibility === 'private' is only ever visible to users in the
// SAME org as its author (authorOrgId). This is what lets defense
// counsel keep genuinely privileged work product out of what the
// carrier sees — filtered here, server-side, before the case object
// is ever serialized to JSON, so it's not something a browser
// dev-tools inspection or a raw API call can bypass. A UI-only
// "hide this" would not provide that guarantee; this does.
function filterCaseForViewer(caseObj, viewerOrgId) {
  if (!Array.isArray(caseObj.updates)) return caseObj;
  return {
    ...caseObj,
    updates: caseObj.updates.filter(u => u.visibility !== 'private' || u.authorOrgId === viewerOrgId)
  };
}
function defaultCaseData() {
  return {
    parties: { defendants: [], insureds: [], plaintiffs: [], thirdParties: [] },
    court: {}, opposing: {}, keyDates: {},
    exposure: { demandAmount: 0, offerAmount: 0, settlementAmount: 0, likelyExposure: 0 },
    closing: {
      dispositionType: '', dispositionDate: '', finalIndemnityPaid: 0,
      releaseStatus: 'Not Started', releaseDate: '', dismissalStatus: 'Not Filed', dismissalDate: '',
      satisfactionFiled: false, excessCarrierApplicable: 'No', excessCarrierNotified: 'N/A', excessCarrierNoticeDate: '',
      finalInvoiceSubmitted: false, finalInvoiceDate: '', payee: { name: '', taxId: '', address: '', w9OnFile: false }, closingNotes: ''
    },
    liens: [], authorityRequests: [], billing: { totalBilled: 0, totalPaid: 0, budget: 0, timeEntries: [], invoices: [] },
    evidence: [], experts: [], settlements: [], tasks: [], documents: [],
    updates: [{ date: new Date().toISOString().slice(0, 10), author: 'System', type: 'Case Opened', text: 'Matter created.' }]
  };
}
function closingBlockers(c) {
  const cl = c.closing || {};
  const blockers = [];
  const openLiens = (c.liens || []).filter(l => l.status !== 'Resolved' && l.status !== 'Waived');
  if (openLiens.length > 0) blockers.push(`${openLiens.length} unresolved lien${openLiens.length > 1 ? 's' : ''}`);
  if (!cl.dispositionType) blockers.push('No disposition recorded');
  if (cl.releaseStatus !== 'Executed' && ['Settlement', 'Voluntary Dismissal', 'Arbitration Award'].includes(cl.dispositionType)) blockers.push('Release not executed');
  if (cl.dismissalStatus === 'Not Filed' && cl.dispositionType) blockers.push('Dismissal not filed');
  if (cl.excessCarrierApplicable === 'Yes' && cl.excessCarrierNotified !== 'Notified') blockers.push('Excess carrier not notified');
  if (!cl.finalInvoiceSubmitted) blockers.push('Final invoice not submitted');
  if (cl.payee && cl.dispositionType === 'Settlement' && !cl.payee.w9OnFile) blockers.push('W9 not on file for payee');
  const pendingAuth = (c.authorityRequests || []).filter(a => a.status === 'Pending');
  if (pendingAuth.length > 0) blockers.push(`${pendingAuth.length} authority request pending`);
  return blockers;
}
function closingReadiness(c) {
  const blockers = closingBlockers(c);
  if (!c.closing || !c.closing.dispositionType) return { label: 'Not Started', blockers };
  if (blockers.length === 0) return { label: 'Ready to Close', blockers };
  return { label: `${blockers.length} Blocker${blockers.length > 1 ? 's' : ''}`, blockers };
}
function fmtMoney(v) { return '$' + Number(v || 0).toLocaleString(); }
function buildClosingSummaryText(c) {
  const cl = c.closing || {};
  const readiness = closingReadiness(c);
  const openLiens = (c.liens || []).filter(l => l.status !== 'Resolved' && l.status !== 'Waived');
  const lastAuth = (c.authorityRequests || []).slice(-1)[0];
  let s = 'CLAIMS CLOSING SUMMARY\n' + '='.repeat(50) + '\n';
  s += `Matter: ${c.matterNo || c.id}  |  Claim #: ${c.insurance?.claimNo || '—'}\n`;
  s += `Insured/Client: ${c.client}\nCarrier: ${c.insurance?.carrier || '—'}\nDefense Attorney: ${c.attorney}\n`;
  s += `Prepared: ${new Date().toISOString().slice(0, 10)}\n\nREADINESS: ${readiness.label}\n`;
  if (readiness.blockers.length) s += `Blockers: ${readiness.blockers.join('; ')}\n`;
  s += `\nDISPOSITION\n${'-'.repeat(30)}\nType: ${cl.dispositionType || 'Not yet determined'}\n`;
  s += `Final Indemnity Paid: ${fmtMoney(cl.finalIndemnityPaid)}\nReserve on File: ${fmtMoney(c.insurance?.reserveAmount)}\n\n`;
  s += `LIENS & SUBROGATION (${(c.liens || []).length})\n${'-'.repeat(30)}\n`;
  if (!c.liens?.length) s += 'None on file.\n';
  else { c.liens.forEach(l => { s += `- ${l.type} (${l.holder}): asserted ${fmtMoney(l.amountAsserted)}, resolved for ${fmtMoney(l.amountResolved)} — ${l.status}\n`; }); if (openLiens.length) s += `${openLiens.length} still OPEN.\n`; }
  s += `\nSETTLEMENT AUTHORITY\n${'-'.repeat(30)}\n`;
  s += lastAuth ? `Most recent: ${fmtMoney(lastAuth.amountRequested)} on ${lastAuth.date} — ${lastAuth.status}\n` : 'No requests on file.\n';
  return s;
}

// ---------------------------------------------------------------
// App
// ---------------------------------------------------------------
const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

app.get('/api/health', async (req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'unreachable', error: e.message });
  }
});

// ---------------------------------------------------------------
// Contact Sales — public, unauthenticated (marketing-site visitors
// aren't logged in). Deliberately separate, tighter rate limit from
// the main API limiter below, since this is intentionally reachable
// with zero credentials and is otherwise open to spam/abuse.
// ---------------------------------------------------------------
const SALES_EMAILS = (process.env.SALES_EMAILS || 'matt@cclosed.com,mike@cclosed.com,sales@cclosed.com')
  .split(',').map(s => s.trim()).filter(Boolean);
const contactRateLimits = new Map();

app.post('/api/contact-sales', async (req, res) => {
  const key = req.ip;
  const now = Date.now(), windowMs = 60 * 60 * 1000, limit = 5; // 5/hour/IP — generous for real use, tight against spam
  const record = contactRateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + windowMs; }
  record.count += 1;
  contactRateLimits.set(key, record);
  if (record.count > limit) return res.status(429).json({ error: 'Too many requests — please try again later or email sales@cclosed.com directly.' });

  const { name, email, company, message } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!SMTP_CONFIGURED) return res.status(503).json({ error: 'Email is not configured on this server yet. See SETUP.md — SMTP_HOST/PORT/USER/PASS and FROM_EMAIL.' });

  try {
    await mailer.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: SALES_EMAILS.join(','),
      replyTo: email,
      subject: `New sales inquiry: ${name.trim()}${company ? ' (' + String(company).trim() + ')' : ''}`,
      text: `Name: ${name.trim()}\nEmail: ${email}\nCompany: ${company ? String(company).trim() : '—'}\n\nMessage:\n${message ? String(message).trim() : '(no message provided)'}\n\n—\nSubmitted from the Case Closed Pro marketing site. Reply-to is set to the submitter's email.`
    });
    res.json({ success: true, message: `Thanks — we'll be in touch shortly.` });
  } catch (e) {
    console.error('Contact-sales email failed to send:', e.message);
    res.status(502).json({ error: 'Could not send your message right now — please email sales@cclosed.com directly.' });
  }
});

// ---------------------------------------------------------------
// Auth — registration creates a NEW organization with the
// registering user as its owner. Additional users join an existing
// org via an invite flow (not built here — see README for the
// recommended next step).
// ---------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, orgName, persona } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!orgName || !orgName.trim()) return res.status(400).json({ error: 'Organization name is required' });
  const normalizedEmail = email.trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    const personaVal = persona === 'defense' ? 'defense' : 'carrier';
    const orgResult = await client.query(
      `INSERT INTO organizations (name, persona) VALUES ($1,$2) RETURNING *`,
      [orgName.trim(), personaVal]
    );
    const org = orgResult.rows[0];
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userResult = await client.query(
      `INSERT INTO users (org_id, email, password_hash, name, persona, role)
       VALUES ($1,$2,$3,$4,$5,'owner') RETURNING *`,
      [org.id, normalizedEmail, passwordHash, (name || normalizedEmail.split('@')[0]).trim(), personaVal]
    );
    const user = userResult.rows[0];
    await client.query('COMMIT');
    await audit(org.id, user.id, 'auth.register', 'organization', org.id, { orgName: org.name }, req.ip);
    res.status(201).json({ token: signToken(user), user: publicUser(user), organization: { id: org.id, name: org.name, persona: org.persona, planTier: org.plan_tier } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !password) return res.status(400).json({ error: 'Email and password are required' });
  const normalizedEmail = email.trim().toLowerCase();
  const invalid = () => res.status(401).json({ error: 'Invalid email or password' });
  const result = await q('SELECT * FROM users WHERE email = $1 AND is_active = true', [normalizedEmail]);
  const user = result.rows[0];
  if (!user) return invalid();
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return invalid();

  if (user.totp_enabled) {
    // Password is correct, but the account requires a 2FA code next.
    // No session token yet — only a narrow pending token good for
    // exactly one thing: /api/auth/2fa/login-verify.
    return res.json({ twoFactorRequired: true, pendingToken: signPending2FAToken(user) });
  }

  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await audit(user.org_id, user.id, 'auth.login', 'user', user.id, null, req.ip);
  res.json({ token: signToken(user), user: publicUser(user) });
});

// Step 2 of login when 2FA is enabled — exchange the pending token +
// a 6-digit authenticator code (or an unused backup code) for a real
// session token.
app.post('/api/auth/2fa/login-verify', async (req, res) => {
  const { pendingToken, code } = req.body || {};
  if (!pendingToken || !code) return res.status(400).json({ error: 'pendingToken and code are required' });
  let payload;
  try {
    payload = jwt.verify(pendingToken, EFFECTIVE_JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Pending login expired — sign in again' });
  }
  if (!payload.pending2fa) return res.status(401).json({ error: 'Invalid pending token' });

  const result = await q('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.sub]);
  const user = result.rows[0];
  if (!user || !user.totp_enabled) return res.status(401).json({ error: 'Invalid pending login' });

  let usedBackupCode = null;
  const validTotp = verifyTotp(user.totp_secret, code);
  if (!validTotp) {
    // Not a valid TOTP code — check whether it matches an unused backup code.
    const codes = user.totp_backup_codes || [];
    for (let i = 0; i < codes.length; i++) {
      if (await bcrypt.compare(String(code).trim().toUpperCase(), codes[i])) { usedBackupCode = i; break; }
    }
    if (usedBackupCode === null) return res.status(401).json({ error: 'Invalid or expired code' });
  }
  if (usedBackupCode !== null) {
    const remaining = [...user.totp_backup_codes];
    remaining.splice(usedBackupCode, 1);
    await q('UPDATE users SET totp_backup_codes = $1 WHERE id = $2', [remaining, user.id]);
    await audit(user.org_id, user.id, 'auth.2fa_backup_code_used', 'user', user.id, { remaining: remaining.length }, req.ip);
  }

  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await audit(user.org_id, user.id, 'auth.login', 'user', user.id, { via2fa: true }, req.ip);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    const result = await q('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.sub]);
    if (!result.rows[0]) return res.status(401).json({ error: 'User no longer exists or is deactivated' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// ---------------------------------------------------------------
// Forgot / reset password. Deliberately public (no auth required —
// you're locked out, that's the whole point). Always returns the
// same generic success message whether or not the email exists, so
// this endpoint can't be used to check who has an account.
// ---------------------------------------------------------------
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const generic = { message: 'If an account exists for that email, a reset link has been sent.' };
  if (!isValidEmail(email)) return res.json(generic); // still generic — don't confirm/deny format issues either
  const normalizedEmail = email.trim().toLowerCase();
  const result = await q('SELECT * FROM users WHERE email = $1 AND is_active = true', [normalizedEmail]);
  const user = result.rows[0];
  if (!user) return res.json(generic);

  const rawToken = generateResetToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await q('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)', [user.id, tokenHash, expiresAt]);
  await audit(user.org_id, user.id, 'auth.password_reset_requested', 'user', user.id, null, req.ip);

  const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/case-closed-pro.html?resetToken=${rawToken}`;
  if (SMTP_CONFIGURED) {
    try {
      await mailer.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: user.email,
        subject: 'Reset your Case Closed Pro password',
        text: `Hi ${user.name},\n\nSomeone requested a password reset for your account. This link expires in 1 hour:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password will not change.`
      });
    } catch (e) {
      console.error('Password reset email failed to send:', e.message);
      // Deliberately still returns the generic success message — we don't
      // want to reveal delivery failures to the caller either.
    }
  } else {
    console.warn(`SMTP not configured — password reset link for ${user.email}: ${resetUrl}`);
  }
  res.json(generic);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const tokenHash = hashToken(token);
  const result = await q(
    `SELECT pr.*, u.org_id, u.email FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
    [tokenHash]
  );
  const resetRow = result.rows[0];
  if (!resetRow) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetRow.user_id]);
  await q('UPDATE password_resets SET used_at = now() WHERE id = $1', [resetRow.id]);
  await audit(resetRow.org_id, resetRow.user_id, 'auth.password_reset_completed', 'user', resetRow.user_id, null, req.ip);
  res.json({ success: true, message: 'Password updated. You can now sign in with your new password.' });
});

// Public — accepting a team invite is how you get an account, so
// this can't require being logged in already. Creates the user
// under the INVITING org's org_id, never a new one — this is the
// piece that actually closes the "no way to add teammates" gap.
app.post('/api/team/accept-invite', async (req, res) => {
  const { token, name, password } = req.body || {};
  if (!token || !name || !password) return res.status(400).json({ error: 'token, name, and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const tokenHash = hashToken(token);
  const result = await q(
    `SELECT * FROM team_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  const invite = result.rows[0];
  if (!invite) return res.status(400).json({ error: 'This invite link is invalid or has expired.' });

  const existing = await q('SELECT id FROM users WHERE email = $1', [invite.email]);
  if (existing.rows[0]) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash2 = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO users (org_id, email, password_hash, name, persona, role)
       SELECT $1, $2, $3, $4, o.persona, $5 FROM organizations o WHERE o.id = $1 RETURNING *`,
      [invite.org_id, invite.email, passwordHash2, name.trim(), invite.role]
    );
    const user = userResult.rows[0];
    await client.query('UPDATE team_invites SET used_at = now() WHERE id = $1', [invite.id]);
    await client.query('COMMIT');
    await audit(invite.org_id, user.id, 'team.invite_accepted', 'user', user.id, null, req.ip);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Could not accept invite: ' + e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// Auth gate for everything else. Two ways in:
//  1. User JWT (normal path) — req.user + req.orgId set from token.
//  2. Static API_KEY for server-to-server integrations — caller
//     MUST also send X-Org-Id, since the key itself isn't tied to
//     one org. Only enable this path if API_KEY is actually set.
// ---------------------------------------------------------------
app.use('/api', async (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized — missing bearer token' });

  if (API_KEY && token === API_KEY) {
    const orgId = req.headers['x-org-id'];
    if (!orgId) return res.status(400).json({ error: 'X-Org-Id header is required when authenticating with the static API key' });
    const orgCheck = await q('SELECT id FROM organizations WHERE id = $1', [orgId]);
    if (!orgCheck.rows[0]) return res.status(404).json({ error: 'No such organization' });
    req.orgId = orgId; req.authType = 'apikey';
    return next();
  }
  try {
    const payload = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    req.user = payload; req.orgId = payload.orgId; req.authType = 'user';

    // Platform admins bypass their own org's access_status entirely —
    // an admin account's "own" org is never what's actually in use,
    // and they need to be able to reach /api/admin/* regardless of it.
    if (!payload.platformAdmin) {
      const orgCheck = await q('SELECT access_status FROM organizations WHERE id = $1', [payload.orgId]);
      if (orgCheck.rows[0]?.access_status === 'suspended') {
        return res.status(403).json({ error: 'Access to this organization has been suspended. Contact your account administrator or sales@cclosed.com.' });
      }
    }
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized — invalid API key or token' });
  }
});

// basic rate limiting (per-process; swap for Redis if you scale to multiple instances)
const hits = new Map();
app.use('/api', (req, res, next) => {
  const key = req.orgId || req.ip;
  const now = Date.now(), windowMs = 60_000, limit = 240;
  const record = hits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + windowMs; }
  record.count += 1; hits.set(key, record);
  if (record.count > limit) return res.status(429).json({ error: 'Rate limit exceeded — try again shortly' });
  next();
});

// Every route below this line that touches `cases` or `saved_reports`
// runs inside a per-request, RLS-scoped transaction (see
// withTenantScope above) — req.db.query(...), not the plain q(...).
app.use('/api', withTenantScope);

// ---------------------------------------------------------------
// Platform admin panel — matt@/mike@/sales@cclosed.com (or whoever
// PLATFORM_ADMIN_EMAILS lists). Every route here requires
// req.user.platformAdmin === true, checked fresh on every request —
// having an old token doesn't help if you're removed from the
// allowlist, since the flag is recomputed at login/register time
// from the current env var, not cached anywhere long-lived.
// ---------------------------------------------------------------
function requirePlatformAdmin(req, res, next) {
  if (!req.user?.platformAdmin) return res.status(403).json({ error: 'Platform admin access required' });
  next();
}

// List every customer organization — this is the whole "cabinet"
// directory. Includes a live matter count and user count per org so
// you can see program size at a glance without opening each one.
// The case-count subquery reads across every org on purpose — that's
// exactly what the app.is_platform_admin bypass policy in
// schema.sql is for.
app.get('/api/admin/organizations', requirePlatformAdmin, async (req, res) => {
  const result = await req.db.query(`
    SELECT o.*,
      (SELECT COUNT(*) FROM cases c WHERE c.org_id = o.id) AS case_count,
      (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS user_count
    FROM organizations o
    ORDER BY o.created_at DESC
  `);
  res.json({
    count: result.rows.length,
    organizations: result.rows.map(o => ({
      id: o.id, name: o.name, persona: o.persona, planTier: o.plan_tier,
      accessStatus: o.access_status,
      caseCount: Number(o.case_count), userCount: Number(o.user_count),
      createdAt: o.created_at
    }))
  });
});

// Provision a brand-new customer directly — this is "give them
// access to their own cabinet." Creates the organization AND its
// first (owner) user in one step, active immediately, and returns a
// one-time temporary password since there's no invite-email flow
// built yet — hand it to the customer through whatever channel
// you're already using (the sales conversation, a follow-up email).
// They should change it after first login.
app.post('/api/admin/organizations', requirePlatformAdmin, async (req, res) => {
  const { orgName, persona, ownerName, ownerEmail, planTier } = req.body || {};
  if (!orgName || !orgName.trim()) return res.status(400).json({ error: 'orgName is required' });
  if (!isValidEmail(ownerEmail)) return res.status(400).json({ error: 'A valid ownerEmail is required' });
  const normalizedEmail = ownerEmail.trim().toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    const personaVal = persona === 'defense' ? 'defense' : 'carrier';
    const tierVal = ['starter', 'growth', 'enterprise'].includes(planTier) ? planTier : 'starter';
    const orgResult = await client.query(
      `INSERT INTO organizations (name, persona, plan_tier, access_status) VALUES ($1,$2,$3,'active') RETURNING *`,
      [orgName.trim(), personaVal, tierVal]
    );
    const org = orgResult.rows[0];

    // Temporary password — random, shown once in this response only.
    // Never logged, never stored anywhere but its bcrypt hash.
    const tempPassword = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const userResult = await client.query(
      `INSERT INTO users (org_id, email, password_hash, name, persona, role)
       VALUES ($1,$2,$3,$4,$5,'owner') RETURNING *`,
      [org.id, normalizedEmail, passwordHash, (ownerName || normalizedEmail.split('@')[0]).trim(), personaVal]
    );
    const user = userResult.rows[0];
    await client.query('COMMIT');
    await audit(org.id, req.user.sub, 'admin.organization_created', 'organization', org.id, { orgName: org.name, createdByAdmin: req.user.email }, req.ip);
    res.status(201).json({
      organization: { id: org.id, name: org.name, persona: org.persona, planTier: org.plan_tier, accessStatus: org.access_status },
      owner: publicUser(user),
      temporaryPassword: tempPassword
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Could not create organization: ' + e.message });
  } finally {
    client.release();
  }
});

app.post('/api/admin/organizations/:id/suspend', requirePlatformAdmin, async (req, res) => {
  const result = await q(`UPDATE organizations SET access_status = 'suspended' WHERE id = $1 RETURNING id, name`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Organization not found' });
  await audit(req.params.id, req.user.sub, 'admin.organization_suspended', 'organization', req.params.id, { by: req.user.email }, req.ip);
  res.json({ suspended: true, organization: result.rows[0] });
});

app.post('/api/admin/organizations/:id/activate', requirePlatformAdmin, async (req, res) => {
  const result = await q(`UPDATE organizations SET access_status = 'active' WHERE id = $1 RETURNING id, name`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Organization not found' });
  await audit(req.params.id, req.user.sub, 'admin.organization_activated', 'organization', req.params.id, { by: req.user.email }, req.ip);
  res.json({ activated: true, organization: result.rows[0] });
});

// ---------------------------------------------------------------
// Team management — lets a customer's own owner/admin add
// colleagues into THEIR org, instead of every new user
// self-registering into a brand new separate organization (the
// gap this closes: previously the only ways to get an account were
// self-register-a-new-org or be provisioned by a platform admin —
// neither of those let an existing customer grow their own team).
// ---------------------------------------------------------------
const ROLE_RANK = { member: 1, admin: 2, owner: 3 };
function requireOrgRole(minRole) {
  return (req, res, next) => {
    if (req.user?.platformAdmin) return next(); // platform admins aren't blocked by org-role checks
    const rank = ROLE_RANK[req.user?.role] || 0;
    if (rank < ROLE_RANK[minRole]) return res.status(403).json({ error: 'This action requires ' + minRole + ' access or higher within your organization.' });
    next();
  };
}

// List current members + any pending (unused, unexpired) invites —
// any signed-in member can see their own team.
app.get('/api/team/members', async (req, res) => {
  const users = await q('SELECT id, email, name, role, is_active, last_login_at, created_at FROM users WHERE org_id = $1 ORDER BY created_at ASC', [req.orgId]);
  const invites = await q(`SELECT id, email, role, created_at, expires_at FROM team_invites WHERE org_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [req.orgId]);
  res.json({
    members: users.rows.map(u => ({ id:u.id, email:u.email, name:u.name, role:u.role, isActive:u.is_active, lastLoginAt:u.last_login_at, createdAt:u.created_at })),
    pendingInvites: invites.rows.map(i => ({ id:i.id, email:i.email, role:i.role, createdAt:i.created_at, expiresAt:i.expires_at }))
  });
});

// Invite a colleague into the CURRENT org — admin or owner only.
// Role is capped at 'admin' here; ownership only changes hands via
// a deliberate transfer, never through the invite flow.
app.post('/api/team/invite', requireOrgRole('admin'), async (req, res) => {
  const { email, role } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
  const roleVal = role === 'admin' ? 'admin' : 'member';
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await q('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existingUser.rows[0]) return res.status(409).json({ error: 'A user with that email already exists' });
  const existingInvite = await q(`SELECT id FROM team_invites WHERE org_id = $1 AND email = $2 AND used_at IS NULL AND expires_at > now()`, [req.orgId, normalizedEmail]);
  if (existingInvite.rows[0]) return res.status(409).json({ error: 'There is already a pending invite for that email' });

  const rawToken = generateResetToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await q('INSERT INTO team_invites (org_id, email, role, invited_by, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.orgId, normalizedEmail, roleVal, req.user.sub, tokenHash, expiresAt]);
  await audit(req.orgId, req.user.sub, 'team.invite_sent', 'user', null, { email: normalizedEmail, role: roleVal }, req.ip);

  const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/case-closed-pro.html?inviteToken=${rawToken}`;
  if (SMTP_CONFIGURED) {
    try {
      await mailer.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: normalizedEmail,
        subject: `You're invited to join ${req.user.email.split('@')[1]} on Case Closed Pro`,
        text: `${req.user.email} has invited you to join their organization on Case Closed Pro.\n\nAccept your invite (expires in 7 days):\n${inviteUrl}\n\nIf you weren't expecting this, you can ignore this email.`
      });
    } catch (e) {
      console.error('Invite email failed to send:', e.message);
    }
  } else {
    console.warn(`SMTP not configured — invite link for ${normalizedEmail}: ${inviteUrl}`);
  }
  // Returned directly (not just emailed) since this is a deliberate
  // authenticated admin action, not a self-service flow — same
  // pattern as the platform-admin "create customer" temp password.
  res.status(201).json({ invited: true, email: normalizedEmail, role: roleVal, inviteUrl });
});

// Deactivate a teammate — admin or owner only, same org, can't
// remove the owner through this endpoint (protects against a org
// accidentally locking itself out).
app.post('/api/team/members/:id/remove', requireOrgRole('admin'), async (req, res) => {
  const target = await q('SELECT * FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!target.rows[0]) return res.status(404).json({ error: 'User not found in your organization' });
  if (target.rows[0].role === 'owner') return res.status(400).json({ error: 'The organization owner cannot be removed this way.' });
  await q('UPDATE users SET is_active = false WHERE id = $1', [req.params.id]);
  await audit(req.orgId, req.user.sub, 'team.member_removed', 'user', req.params.id, { by: req.user.email }, req.ip);
  res.json({ removed: true });
});

// Change a teammate's role — owner only, can't touch the owner's own row.
app.post('/api/team/members/:id/role', requireOrgRole('owner'), async (req, res) => {
  const { role } = req.body || {};
  if (!['admin','member'].includes(role)) return res.status(400).json({ error: "role must be 'admin' or 'member'" });
  const target = await q('SELECT * FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!target.rows[0]) return res.status(404).json({ error: 'User not found in your organization' });
  if (target.rows[0].role === 'owner') return res.status(400).json({ error: "The owner's role can't be changed here." });
  await q('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  await audit(req.orgId, req.user.sub, 'team.role_changed', 'user', req.params.id, { newRole: role, by: req.user.email }, req.ip);
  res.json({ updated: true });
});

// ---------------------------------------------------------------
// 2FA management — all three require a full session (already past
// the rate limiter and auth gate above), unlike the login-time
// endpoints further up which are deliberately public.
// ---------------------------------------------------------------

// Step 1: generate a secret + manual-entry key for an authenticator
// app. Not enabled yet — enabling happens only once the user proves
// they actually scanned/entered it correctly, in verify-setup below.
app.post('/api/auth/2fa/setup', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for API-key access' });
  const secret = generateTotpSecret();
  await q('UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [secret, req.user.sub]);
  res.json({
    secret,
    manualEntryKey: secret.match(/.{1,4}/g).join(' '),
    otpauthUrl: otpauthUrl(secret, req.user.email)
  });
});

// Step 2: confirm the code from the app actually works before
// flipping totp_enabled on. Also issues backup codes exactly once,
// shown to the user a single time — we only ever store their hashes.
app.post('/api/auth/2fa/verify-setup', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for API-key access' });
  const { code } = req.body || {};
  const result = await q('SELECT totp_secret FROM users WHERE id = $1', [req.user.sub]);
  const secret = result.rows[0]?.totp_secret;
  if (!secret) return res.status(400).json({ error: 'Call /api/auth/2fa/setup first' });
  if (!verifyTotp(secret, code)) return res.status(400).json({ error: 'That code didn\'t match — check the time on your phone and try again' });

  const backupCodes = generateBackupCodes();
  const hashedCodes = await Promise.all(backupCodes.map(c => bcrypt.hash(c, BCRYPT_ROUNDS)));
  await q('UPDATE users SET totp_enabled = true, totp_backup_codes = $1 WHERE id = $2', [hashedCodes, req.user.sub]);
  await audit(req.orgId, req.user.sub, 'auth.2fa_enabled', 'user', req.user.sub, null, req.ip);
  res.json({ enabled: true, backupCodes }); // last time these plaintext codes are ever available — show once, then gone
});

app.post('/api/auth/2fa/disable', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for API-key access' });
  const { password } = req.body || {};
  const result = await q('SELECT * FROM users WHERE id = $1', [req.user.sub]);
  const user = result.rows[0];
  if (!password || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  await q('UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1', [req.user.sub]);
  await audit(req.orgId, req.user.sub, 'auth.2fa_disabled', 'user', req.user.sub, null, req.ip);
  res.json({ disabled: true });
});

// ---------------------------------------------------------------
// Cases — every query scoped by org. Carrier users see cases their
// org owns; defense-persona users see only cases explicitly shared
// with their firm via case_access. req.db is the per-request,
// RLS-scoped connection from withTenantScope above — the database
// itself rejects any row outside app.current_org_id, on top of the
// WHERE org_id = $1 already in these queries.
// ---------------------------------------------------------------
// A 'member' (individual attorney/adjuster, not owner/admin) only
// sees cases specifically assigned to them — everyone else in a
// carrier org could otherwise see the whole portfolio, which is
// exactly the gap this closes. Owners and admins keep full
// visibility on purpose (supervisory access). Platform admins are
// a separate thing entirely and never hit this function.
//
// The member-only filter's placeholder number is computed from
// however many params the caller already passed in extraParams
// (e.g. a status filter), so it never collides with a $2 the
// caller already hardcoded into extraWhere — it's always appended
// last, at whatever index comes next.
async function scopedCaseQuery(req, extraWhere = '', extraParams = []) {
  const isMember = req.user?.role === 'member';
  const baseParams = [req.orgId, ...extraParams];
  let memberClause = '';
  let params = baseParams;
  if (isMember) {
    const idx = baseParams.length + 1;
    const col = req.user?.persona === 'defense' ? 'c.assigned_attorney_user_id' : 'assigned_attorney_user_id';
    memberClause = ` AND ${col} = $${idx}`;
    params = [...baseParams, req.user.sub];
  }

  if (req.user?.persona === 'defense') {
    return req.db.query(
      `SELECT c.* FROM cases c
       JOIN case_access ca ON ca.case_id = c.id
       WHERE ca.firm_org_id = $1 ${extraWhere}${memberClause}
       ORDER BY c.created_at DESC`,
      params
    );
  }
  return req.db.query(`SELECT * FROM cases WHERE org_id = $1 ${extraWhere}${memberClause} ORDER BY created_at DESC`, params);
}

// ---------------------------------------------------------------
// Billing reference — NOT automated. This just reports what the
// pricing calculator would suggest for this org's current matter
// count, for accounting's benefit. Nothing here creates a charge,
// a subscription, or talks to any payment processor.
// ---------------------------------------------------------------
app.get('/api/billing/status', async (req, res) => {
  const orgResult = await q('SELECT * FROM organizations WHERE id = $1', [req.orgId]);
  const org = orgResult.rows[0];
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const countResult = await req.db.query(`SELECT COUNT(*)::int AS n FROM cases WHERE org_id = $1 AND status != 'Closed'`, [req.orgId]);
  const matterCount = countResult.rows[0].n;
  res.json({
    planTier: org.plan_tier,
    suggestedTier: tierForMatterCount(matterCount),
    matterCount,
    note: 'Billed externally by your accounting team — this figure is a reference only, not an invoice.'
  });
});

app.get('/api/cases', async (req, res) => {
  const { status } = req.query;
  const extra = status ? ' AND c.status = $2' : '';
  const extraNoAlias = status ? ' AND status = $2' : '';
  const result = req.user?.persona === 'defense'
    ? await scopedCaseQuery(req, extra, status ? [status] : [])
    : await scopedCaseQuery(req, extraNoAlias, status ? [status] : []);
  const cases = result.rows.map(r => filterCaseForViewer(rowToCase(r), req.orgId));
  res.json({ count: cases.length, cases });
});

app.get('/api/cases/:id', async (req, res) => {
  const result = await scopedCaseQuery(req, req.user?.persona === 'defense' ? ' AND c.id = $2' : ' AND id = $2', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Case not found' });
  res.json(filterCaseForViewer(rowToCase(result.rows[0]), req.orgId));
});

app.get('/api/cases/:id/closing-summary', async (req, res) => {
  const result = await scopedCaseQuery(req, req.user?.persona === 'defense' ? ' AND c.id = $2' : ' AND id = $2', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Case not found' });
  const c = filterCaseForViewer(rowToCase(result.rows[0]), req.orgId);
  if (req.query.format === 'json') return res.json({ readiness: closingReadiness(c), summary: buildClosingSummaryText(c) });
  res.type('text/plain').send(buildClosingSummaryText(c));
});

app.post('/api/cases', async (req, res) => {
  const b = req.body || {};
  if (!b.client) return res.status(400).json({ error: 'client is required' });
  const data = { ...defaultCaseData(), ...(b.data || {}) };
  const result = await req.db.query(
    `INSERT INTO cases (org_id, matter_no, client, type, status, litigation_stage, attorney, assigned_attorney_user_id, carrier, claim_no, reserve_amount, filed_date, deadline_date, value, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [req.orgId, b.matterNo || null, b.client, b.type || 'Other', b.status || 'Active', b.litigationStage || 'Pre-Suit',
     b.attorney || null, b.assignedAttorneyUserId || null, b.carrier || null, b.claimNo || null, b.reserveAmount || 0, b.filed || null, b.deadline || null, b.value || 0, JSON.stringify(data)]
  );
  await audit(req.orgId, req.user?.sub, 'case.create', 'case', result.rows[0].id, { client: b.client }, req.ip);
  res.status(201).json(rowToCase(result.rows[0]));
});

// Bulk import closed case history — every record forced to status Closed.
app.post('/api/cases/import', async (req, res) => {
  const records = req.body;
  if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ error: 'Body must be a non-empty JSON array' });
  if (records.length > 5000) return res.status(413).json({ error: 'Batch too large — split into batches of 5000 or fewer' });

  const created = [];
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const b = records[i];
    try {
      if (!b.client) throw new Error('client is required');
      const data = { ...defaultCaseData(), ...(b.data || {}) };
      if (b.settlementAmount != null) data.exposure.settlementAmount = b.settlementAmount;
      const result = await req.db.query(
        `INSERT INTO cases (org_id, matter_no, client, type, status, litigation_stage, attorney, carrier, claim_no, reserve_amount, filed_date, deadline_date, value, data)
         VALUES ($1,$2,$3,$4,'Closed','Closed',$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.orgId, b.matterNo || null, b.client, b.type || 'Other', b.attorney || null, b.carrier || null,
         b.claimNo || null, b.reserveAmount || 0, b.filed || null, b.deadline || null, b.value || 0, JSON.stringify(data)]
      );
      created.push(rowToCase(result.rows[0]));
    } catch (e) {
      errors.push({ index: i, error: e.message });
    }
  }
  await audit(req.orgId, req.user?.sub, 'case.import', 'case', null, { imported: created.length, failed: errors.length }, req.ip);
  res.status(201).json({ imported: created.length, failed: errors.length, errors, cases: created });
});

app.patch('/api/cases/:id', async (req, res) => {
  const existing = await req.db.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'Case not found' });
  const current = existing.rows[0];
  const b = req.body || {};
  const mergedData = { ...current.data, ...(b.data || {}) };

  // Reassigning WHO can see this case is an access-control action,
  // not a normal field edit — restricted to admin/owner so a
  // 'member' can't grant themselves (or anyone) visibility into a
  // case they weren't given. A plain field update from a member
  // (status, notes, etc.) still goes through normally below.
  let assignedAttorneyUserId = current.assigned_attorney_user_id;
  if ('assignedAttorneyUserId' in b) {
    if (req.user?.role === 'member' && !req.user?.platformAdmin) {
      return res.status(403).json({ error: 'Only an admin or owner can reassign a case.' });
    }
    assignedAttorneyUserId = b.assignedAttorneyUserId || null;
  }

  const result = await req.db.query(
    `UPDATE cases SET
       matter_no = COALESCE($1, matter_no), client = COALESCE($2, client), type = COALESCE($3, type),
       status = COALESCE($4, status), litigation_stage = COALESCE($5, litigation_stage), attorney = COALESCE($6, attorney),
       carrier = COALESCE($7, carrier), claim_no = COALESCE($8, claim_no), reserve_amount = COALESCE($9, reserve_amount),
       value = COALESCE($10, value), data = $11, assigned_attorney_user_id = $12
     WHERE id = $13 AND org_id = $14 RETURNING *`,
    [b.matterNo, b.client, b.type, b.status, b.litigationStage, b.attorney, b.carrier, b.claimNo, b.reserveAmount, b.value,
     JSON.stringify(mergedData), assignedAttorneyUserId, req.params.id, req.orgId]
  );
  await audit(req.orgId, req.user?.sub, 'case.update', 'case', req.params.id, { fields: Object.keys(b) }, req.ip);
  res.json(rowToCase(result.rows[0]));
});

app.delete('/api/cases/:id', async (req, res) => {
  const result = await req.db.query('DELETE FROM cases WHERE id = $1 AND org_id = $2 RETURNING id', [req.params.id, req.orgId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Case not found' });
  await audit(req.orgId, req.user?.sub, 'case.delete', 'case', req.params.id, null, req.ip);
  res.json({ deleted: true, id: req.params.id });
});

// ---------------------------------------------------------------
// Payees & Payables — accounts PAYABLE. The org paying its own
// outside counsel, claims adjusters, expert witnesses, and other
// vendors. Kept fully separate from the cases.data.billing fields
// above (accounts RECEIVABLE — billing the carrier/client). Every
// query below runs on req.db, the same per-request RLS-scoped
// connection the cases routes use.
// ---------------------------------------------------------------
app.get('/api/payees', async (req, res) => {
  const result = await req.db.query('SELECT * FROM payees WHERE org_id = $1 ORDER BY name ASC', [req.orgId]);
  res.json({ payees: result.rows.map(p => ({ id:p.id, name:p.name, type:p.type, email:p.email, defaultRate: p.default_rate != null ? Number(p.default_rate) : 0 })) });
});
app.post('/api/payees', async (req, res) => {
  const { name, type, email, defaultRate } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const result = await req.db.query(
    `INSERT INTO payees (org_id, name, type, email, default_rate) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.orgId, name.trim(), type || 'Other', email || null, defaultRate || 0]
  );
  await audit(req.orgId, req.user?.sub, 'payee.create', 'payee', result.rows[0].id, { name }, req.ip);
  res.status(201).json({ id: result.rows[0].id, name: result.rows[0].name, type: result.rows[0].type });
});

function rowToPayable(row) {
  return {
    id: row.id, payeeId: row.payee_id, payeeName: row.payee_name, payeeType: row.payee_type,
    relatedCaseId: row.related_case_id, amount: Number(row.amount), description: row.description,
    dueDate: row.due_date, submittedDate: row.submitted_date, status: row.status,
    approvedBy: row.approved_by_name || null, paidDate: row.paid_date, paymentMethod: row.payment_method
  };
}
app.get('/api/payables', async (req, res) => {
  const { status } = req.query;
  const extra = status ? ' AND pb.status = $2' : '';
  const params = [req.orgId]; if (status) params.push(status);
  const result = await req.db.query(
    `SELECT pb.*, py.name AS payee_name, py.type AS payee_type, u.name AS approved_by_name
     FROM payables pb
     JOIN payees py ON py.id = pb.payee_id
     LEFT JOIN users u ON u.id = pb.approved_by
     WHERE pb.org_id = $1 ${extra}
     ORDER BY pb.created_at DESC`,
    params
  );
  res.json({ count: result.rows.length, payables: result.rows.map(rowToPayable) });
});
app.post('/api/payables', async (req, res) => {
  const { payeeId, relatedCaseId, amount, description, dueDate } = req.body || {};
  if (!payeeId) return res.status(400).json({ error: 'payeeId is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  const payeeCheck = await req.db.query('SELECT id FROM payees WHERE id = $1 AND org_id = $2', [payeeId, req.orgId]);
  if (!payeeCheck.rows[0]) return res.status(404).json({ error: 'Payee not found in your organization' });
  const result = await req.db.query(
    `INSERT INTO payables (org_id, payee_id, related_case_id, amount, description, due_date, submitted_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,'Submitted') RETURNING *`,
    [req.orgId, payeeId, relatedCaseId || null, amount, description || '', dueDate || null]
  );
  await audit(req.orgId, req.user?.sub, 'payable.create', 'payable', result.rows[0].id, { payeeId, amount }, req.ip);
  res.status(201).json({ id: result.rows[0].id, status: result.rows[0].status });
});
// Status transitions — Approve/Reject require admin+ (same rank
// check as team management above); Paid can follow Approve only.
app.patch('/api/payables/:id/status', requireOrgRole('admin'), async (req, res) => {
  const { status } = req.body || {};
  if (!PAYABLES_VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const existing = await req.db.query('SELECT * FROM payables WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'Payable not found' });

  const fields = ['status = $1'];
  const params = [status];
  if (status === 'Approved') { fields.push('approved_by = $' + (params.length+1)); params.push(req.user.sub); }
  if (status === 'Paid') { fields.push('paid_date = CURRENT_DATE'); }
  params.push(req.params.id, req.orgId);
  const result = await req.db.query(
    `UPDATE payables SET ${fields.join(', ')} WHERE id = $${params.length-1} AND org_id = $${params.length} RETURNING *`,
    params
  );
  await audit(req.orgId, req.user?.sub, 'payable.status_changed', 'payable', req.params.id, { newStatus: status }, req.ip);
  res.json({ id: result.rows[0].id, status: result.rows[0].status });
});
const PAYABLES_VALID_STATUSES = ['Draft','Submitted','Approved','Paid','Rejected'];

// Grant a defense firm access to a specific matter (carrier-side action only).
app.post('/api/cases/:id/share', async (req, res) => {
  if (req.user?.persona === 'defense') return res.status(403).json({ error: 'Only the owning carrier can share a matter' });
  const { firmOrgId } = req.body || {};
  if (!firmOrgId) return res.status(400).json({ error: 'firmOrgId is required' });
  const caseCheck = await req.db.query('SELECT id FROM cases WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!caseCheck.rows[0]) return res.status(404).json({ error: 'Case not found' });
  await q('INSERT INTO case_access (case_id, firm_org_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, firmOrgId]);
  await audit(req.orgId, req.user?.sub, 'case.share', 'case', req.params.id, { firmOrgId }, req.ip);
  res.json({ shared: true });
});

// ---------------------------------------------------------------
// SENTINEL AI SUITE — real Claude API calls, tenant-scoped case
// data pulled through req.db (same RLS-protected connection every
// other case route uses), never trusting anything the client sends
// about which case it is beyond the ID. Each returns { analysis }.
// ---------------------------------------------------------------
async function loadOneCase(req, caseId){
  const result = req.user?.persona === 'defense'
    ? await req.db.query(`SELECT c.* FROM cases c JOIN case_access ca ON ca.case_id = c.id WHERE ca.firm_org_id = $1 AND c.id = $2`, [req.orgId, caseId])
    : await req.db.query('SELECT * FROM cases WHERE org_id = $1 AND id = $2', [req.orgId, caseId]);
  return result.rows[0] ? rowToCase(result.rows[0]) : null;
}

// Sentinel Match — recommends which attorney should handle this matter.
app.post('/api/ai/sentinel-match/:caseId', async (req, res) => {
  try {
    const c = await loadOneCase(req, req.params.caseId);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const roster = await req.db.query(
      `SELECT attorney, COUNT(*) FILTER (WHERE status != 'Closed') AS open_count
       FROM cases WHERE org_id = $1 AND attorney IS NOT NULL GROUP BY attorney ORDER BY attorney`,
      [req.orgId]
    );
    const system = 'You are Sentinel Match, an AI that recommends the best-fit attorney for a litigation matter based on specialization, workload, and case complexity. Be specific and concise — 3-4 sentences, name your top recommendation and briefly justify it. This is a recommendation for a human to review, not an automatic assignment.';
    const prompt = `Matter to assign:\n${JSON.stringify(caseSummaryForAI(c), null, 2)}\n\nCurrent attorney workloads (open matter count):\n${JSON.stringify(roster.rows, null, 2)}\n\nWho should handle this matter, and why?`;
    const analysis = await callClaude(system, prompt, 400);
    await audit(req.orgId, req.user?.sub, 'ai.sentinel_match', 'case', c.id, null, req.ip);
    res.json({ analysis });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// Sentinel Settle — recommends a settlement number.
app.post('/api/ai/sentinel-settle/:caseId', async (req, res) => {
  try {
    const c = await loadOneCase(req, req.params.caseId);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const system = 'You are Sentinel Settle, an AI that recommends a settlement position based on the actual numbers and case facts in front of you — never a generic "split the difference." Give a specific recommended range, your reasoning in 2-3 sentences, and the single biggest risk factor to watch. This is a recommendation for a human negotiator to use, not an automatic offer.';
    const prompt = `Matter:\n${JSON.stringify(caseSummaryForAI(c), null, 2)}\n\nWhat settlement position would you recommend, and why?`;
    const analysis = await callClaude(system, prompt, 400);
    await audit(req.orgId, req.user?.sub, 'ai.sentinel_settle', 'case', c.id, null, req.ip);
    res.json({ analysis });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// Sentinel Strategy — models opposing counsel's likely next move.
app.post('/api/ai/sentinel-strategy/:caseId', async (req, res) => {
  try {
    const c = await loadOneCase(req, req.params.caseId);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const system = 'You are Sentinel Strategy, an AI that reads a case\'s current posture and recent activity to predict opposing counsel\'s likely next move and recommend a counter-strategy. 3-4 sentences, specific and actionable, grounded only in the facts given — do not invent details not present in the case data.';
    const prompt = `Matter:\n${JSON.stringify(caseSummaryForAI(c), null, 2)}\n\nWhat is opposing counsel likely to do next, and what should our strategy be?`;
    const analysis = await callClaude(system, prompt, 400);
    await audit(req.orgId, req.user?.sub, 'ai.sentinel_strategy', 'case', c.id, null, req.ip);
    res.json({ analysis });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// Sentinel Horizon — forecasts time-to-close and cost.
app.post('/api/ai/sentinel-horizon/:caseId', async (req, res) => {
  try {
    const c = await loadOneCase(req, req.params.caseId);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const system = 'You are Sentinel Horizon, an AI that forecasts when a litigation matter will realistically close and what it will cost to get there, based on its current stage, activity level, and stated timeline. Give a specific estimated closing window and total cost range, plus one sentence on the biggest factor that could speed this up or slow it down. Be direct about uncertainty where the data is thin.';
    const prompt = `Matter:\n${JSON.stringify(caseSummaryForAI(c), null, 2)}\n\nWhen will this likely close, and what will it cost?`;
    const analysis = await callClaude(system, prompt, 400);
    await audit(req.orgId, req.user?.sub, 'ai.sentinel_horizon', 'case', c.id, null, req.ip);
    res.json({ analysis });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// Sentinel Watch — portfolio-wide risk scan, not scoped to one case.
// The real risk SIGNALS are computed here with plain SQL/JS (reserve
// burn, staleness, approaching deadlines) — Claude's job is turning
// that into a clear, prioritized written flag, not inventing the
// signals itself.
app.post('/api/ai/sentinel-watch', async (req, res) => {
  try {
    const casesResult = await req.db.query(`SELECT * FROM cases WHERE org_id = $1 AND status != 'Closed'`, [req.orgId]);
    const cases = casesResult.rows.map(rowToCase);
    const signals = cases.map(c => {
      const reserveBurn = c.insurance?.reserveAmount ? ((c.billing?.totalBilled||0) / c.insurance.reserveAmount) * 100 : 0;
      const lastUpdate = (c.updates||[]).slice(-1)[0];
      const daysSinceActivity = lastUpdate ? Math.floor((Date.now() - new Date(lastUpdate.date)) / 864e5) : null;
      const daysToSol = c.keyDates?.sol ? Math.floor((new Date(c.keyDates.sol) - Date.now()) / 864e5) : null;
      return { matterNo: c.matterNo, client: c.client, reserveBurnPct: Math.round(reserveBurn), daysSinceActivity, daysToSol };
    }).filter(s => s.reserveBurnPct > 70 || (s.daysSinceActivity !== null && s.daysSinceActivity > 14) || (s.daysToSol !== null && s.daysToSol < 90));

    if (signals.length === 0) return res.json({ analysis: 'No matters currently trip a risk threshold — reserve burn, staleness, or approaching deadlines all look normal across the open portfolio.' });

    const system = 'You are Sentinel Watch, an AI that turns a list of flagged risk signals (reserve burn, stale activity, approaching deadlines) into a short, prioritized written brief for a claims leader. Rank by severity, be specific about matter names, and keep it to a tight paragraph or short list — this is meant to be read in 30 seconds, not a report.';
    const prompt = `Flagged matters this week:\n${JSON.stringify(signals, null, 2)}\n\nWrite the prioritized risk brief.`;
    const analysis = await callClaude(system, prompt, 500);
    await audit(req.orgId, req.user?.sub, 'ai.sentinel_watch', null, null, { flaggedCount: signals.length }, req.ip);
    res.json({ analysis, flaggedCount: signals.length });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// Saved reports — mirrors the frontend's Saved Reports panel.
// Previously in the schema with no route to actually reach it —
// wired up here.
// ---------------------------------------------------------------
app.get('/api/reports/saved', async (req, res) => {
  const result = await req.db.query('SELECT * FROM saved_reports WHERE org_id = $1 ORDER BY created_at DESC', [req.orgId]);
  res.json({ reports: result.rows.map(r => ({ id:r.id, reportId:r.report_id, name:r.name, category:r.category, rowCount:r.row_count, cols:r.cols, rows:r.rows, aiSummary:r.ai_summary, createdAt:r.created_at })) });
});
app.post('/api/reports/saved', async (req, res) => {
  const b = req.body || {};
  if (!b.reportId || !b.name) return res.status(400).json({ error: 'reportId and name are required' });
  const result = await req.db.query(
    `INSERT INTO saved_reports (org_id, created_by_user_id, report_id, name, category, row_count, cols, rows, ai_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.orgId, req.user?.sub || null, b.reportId, b.name, b.category || null, b.rowCount || (b.rows ? b.rows.length : 0), JSON.stringify(b.cols || []), JSON.stringify(b.rows || []), b.aiSummary || null]
  );
  res.status(201).json({ id: result.rows[0].id, createdAt: result.rows[0].created_at });
});
app.delete('/api/reports/saved/:id', async (req, res) => {
  const result = await req.db.query('DELETE FROM saved_reports WHERE id = $1 AND org_id = $2 RETURNING id', [req.params.id, req.orgId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Report not found' });
  res.json({ deleted: true });
});

// ---------------------------------------------------------------
// Reports email — unchanged from the prototype, still requires SMTP.
// ---------------------------------------------------------------
app.post('/api/reports/email', async (req, res) => {
  if (!SMTP_CONFIGURED) return res.status(503).json({ error: 'Email is not configured on this server. Set SMTP_HOST/PORT/USER/PASS and FROM_EMAIL.' });
  const { to, subject, message, reportName, csv, filename } = req.body || {};
  if (!to) return res.status(400).json({ error: '"to" is required' });
  if (!csv) return res.status(400).json({ error: '"csv" is required' });
  const recipients = Array.isArray(to) ? to.join(',') : String(to);
  try {
    const info = await mailer.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: recipients, subject: subject || `Report: ${reportName || 'Case Closed Pro Report'}`,
      text: message || `Attached: ${reportName || 'report'}`,
      attachments: [{ filename: filename || 'report.csv', content: csv, contentType: 'text/csv' }]
    });
    await audit(req.orgId, req.user?.sub, 'report.email', 'report', null, { to: recipients }, req.ip);
    res.json({ sent: true, to: recipients, messageId: info.messageId });
  } catch (e) {
    res.status(502).json({ error: 'Email send failed: ' + e.message });
  }
});

// ---------------------------------------------------------------
// Weekly digest — save/read the schedule, matching the frontend's
// "Weekly Executive Email" card. Actual sending is the scheduler
// function below, not this endpoint — this just persists the config.
// ---------------------------------------------------------------
app.get('/api/reports/schedule-weekly-digest', async (req, res) => {
  const result = await q('SELECT * FROM weekly_digest_config WHERE org_id = $1', [req.orgId]);
  const row = result.rows[0];
  res.json(row
    ? { recipients: row.recipients, day: row.day_of_week, enabled: row.enabled }
    : { recipients: [], day: 'Monday', enabled: false });
});
app.post('/api/reports/schedule-weekly-digest', requireOrgRole('admin'), async (req, res) => {
  const { recipients, day, enabled } = req.body || {};
  const dayVal = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].includes(day) ? day : 'Monday';
  await q(
    `INSERT INTO weekly_digest_config (org_id, recipients, day_of_week, enabled)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id) DO UPDATE SET recipients = $2, day_of_week = $3, enabled = $4`,
    [req.orgId, Array.isArray(recipients) ? recipients : String(recipients||'').split(',').map(s=>s.trim()).filter(Boolean), dayVal, !!enabled]
  );
  await audit(req.orgId, req.user?.sub, 'digest.schedule_updated', 'organization', req.orgId, { day: dayVal, enabled }, req.ip);
  res.json({ saved: true });
});

// Builds the same kind of summary the frontend's own digest builder
// does, but server-side, from a fresh query, for a specific org.
async function buildWeeklyDigestText(orgId){
  const orgResult = await q('SELECT name FROM organizations WHERE id = $1', [orgId]);
  const orgName = orgResult.rows[0]?.name || 'Your Organization';
  const casesResult = await q('SELECT * FROM cases WHERE org_id = $1', [orgId]);
  const cases = casesResult.rows.map(rowToCase);
  const open = cases.filter(c => c.status !== 'Closed');
  const totalReserves = cases.reduce((s,c) => s + (c.insurance.reserveAmount||0), 0);
  const material = open.filter(c => (c.exposure?.likelyExposure || c.value || 0) > 10000000);
  const solDue = open.filter(c => c.keyDates?.sol && new Date(c.keyDates.sol) < new Date(Date.now()+90*864e5));

  let s = `WEEKLY EXECUTIVE SUMMARY — ${orgName}\n${'='.repeat(50)}\n`;
  s += `Generated: ${new Date().toISOString().slice(0,10)}\n\n`;
  s += `Total Litigation: ${cases.length} (${open.length} open)\n`;
  s += `Total Reserves: $${totalReserves.toLocaleString()}\n`;
  s += `Material Matters (>$10M): ${material.length}\n`;
  s += `Matters with SOL inside 90 days: ${solDue.length}\n\n`;
  if (material.length) {
    s += `MATERIAL MATTERS\n${'-'.repeat(30)}\n`;
    material.slice(0,10).forEach(c => { s += `- ${c.matterNo||c.id} ${c.client}: $${(c.exposure?.likelyExposure||c.value||0).toLocaleString()}\n`; });
  }
  return s;
}

// Checked once an hour. Sends any org's digest whose configured day
// matches today and hasn't already gone out this ISO week.
//
// HONEST LIMIT, stated plainly rather than left to be discovered:
// Render's free tier puts this service to sleep after 15 minutes
// with no visitors, and a sleeping process runs no code at all —
// including this scheduler. On the free tier, a digest only sends
// reliably if someone happens to visit the app around the scheduled
// hour. This becomes fully reliable once you're on a paid Render
// plan that keeps the service running continuously — nothing about
// this code changes, only the hosting tier does.
function isoWeekKey(d){
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 864e5) + 1)/7);
  return date.getUTCFullYear()+'-W'+weekNo;
}
async function runWeeklyDigestCheck(){
  if (!SMTP_CONFIGURED) return;
  const todayName = new Date().toLocaleDateString('en-US',{weekday:'long', timeZone:'UTC'});
  const thisWeek = isoWeekKey(new Date());
  try {
    const due = await q(
      `SELECT * FROM weekly_digest_config WHERE enabled = true AND day_of_week = $1 AND (last_sent_week IS NULL OR last_sent_week != $2)`,
      [todayName, thisWeek]
    );
    for (const row of due.rows) {
      if (!row.recipients || row.recipients.length === 0) continue;
      const text = await buildWeeklyDigestText(row.org_id);
      await mailer.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: row.recipients.join(','),
        subject: `Weekly Executive Summary — ${new Date().toISOString().slice(0,10)}`,
        text
      });
      await q('UPDATE weekly_digest_config SET last_sent_week = $1 WHERE org_id = $2', [thisWeek, row.org_id]);
      console.log(`Weekly digest sent for org ${row.org_id}`);
    }
  } catch (e) {
    console.error('Weekly digest check failed:', e.message);
  }
}
setInterval(runWeeklyDigestCheck, 60 * 60 * 1000); // every hour
runWeeklyDigestCheck(); // also check once on startup, in case the process just woke up on the right day

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Case Closed Pro API (production) listening on :${PORT}`);
  console.log(SMTP_CONFIGURED ? `Email sending ENABLED via ${process.env.SMTP_HOST}` : 'Email sending DISABLED — set SMTP_HOST/USER/PASS to enable');
  console.log(API_KEY ? 'Static API_KEY auth path ENABLED (requires X-Org-Id header)' : 'Static API_KEY auth path DISABLED — user JWTs only');
});
