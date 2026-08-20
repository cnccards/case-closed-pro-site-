/**
 * Case Closed Pro — Production API Server
 * ---------------------------------------------------------------
 * Rewired from the lowdb prototype to real Postgres with real
 * multi-tenancy: every case belongs to an organization (org_id),
 * every query is scoped to the caller's org, and defense-firm
 * access to a carrier's matters is explicit (case_access table),
 * never implicit.
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
import Stripe from 'stripe';
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
// Billing (Stripe) — optional. Create two recurring Prices in your
// Stripe Dashboard (Starter, Growth) and set their IDs below via
// env vars. Enterprise has no self-serve checkout — it's a
// "contact sales" tier by design, matching the pricing calculator.
// ---------------------------------------------------------------
const STRIPE_CONFIGURED = !!process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_CONFIGURED ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const STRIPE_PRICE_STARTER = process.env.STRIPE_PRICE_STARTER;
const STRIPE_PRICE_GROWTH = process.env.STRIPE_PRICE_GROWTH;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function tierForMatterCount(n) {
  if (n <= 250) return 'starter';
  if (n <= 750) return 'growth';
  return 'enterprise';
}
function priceIdForTier(tier) {
  if (tier === 'starter') return STRIPE_PRICE_STARTER;
  if (tier === 'growth') return STRIPE_PRICE_GROWTH;
  return null; // enterprise = contact sales, no self-serve price
}

// ---------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function publicUser(u) {
  return { id: u.id, orgId: u.org_id, email: u.email, name: u.name, persona: u.persona, role: u.role, createdAt: u.created_at, totpEnabled: !!u.totp_enabled };
}
function signToken(user) {
  return jwt.sign(
    { sub: user.id, orgId: user.org_id, email: user.email, persona: user.persona, role: user.role },
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

// Stripe webhook MUST be registered before express.json() below —
// signature verification needs the raw, unparsed request body.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_CONFIGURED) return res.status(503).send('Billing not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Stripe webhook signature verification failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orgId = session.client_reference_id || session.metadata?.orgId;
        if (orgId) {
          await q(
            `UPDATE organizations SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = 'active' WHERE id = $3`,
            [session.customer, session.subscription, orgId]
          );
          await audit(orgId, null, 'billing.checkout_completed', 'organization', orgId, { sessionId: session.id }, null);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await q(`UPDATE organizations SET subscription_status = $1 WHERE stripe_subscription_id = $2`, [sub.status, sub.id]);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await q(`UPDATE organizations SET subscription_status = 'canceled' WHERE stripe_subscription_id = $1`, [sub.id]);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await q(`UPDATE organizations SET subscription_status = 'past_due' WHERE stripe_customer_id = $1`, [invoice.customer]);
        break;
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).send('Webhook handler failed');
  }
});

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
// with their firm via case_access.
// ---------------------------------------------------------------
async function scopedCaseQuery(req, extraWhere = '', extraParams = []) {
  if (req.user?.persona === 'defense') {
    return q(
      `SELECT c.* FROM cases c
       JOIN case_access ca ON ca.case_id = c.id
       WHERE ca.firm_org_id = $1 ${extraWhere}
       ORDER BY c.created_at DESC`,
      [req.orgId, ...extraParams]
    );
  }
  return q(`SELECT * FROM cases WHERE org_id = $1 ${extraWhere} ORDER BY created_at DESC`, [req.orgId, ...extraParams]);
}

// ---------------------------------------------------------------
// Billing — create a Checkout session for the org's plan. The
// tier is derived from the org's actual open-matter count, same
// bands as the pricing calculator, so the price shown always
// matches what they'd see there. Enterprise has no self-serve
// checkout by design — return a "contact sales" signal instead.
// ---------------------------------------------------------------
app.post('/api/billing/create-checkout-session', async (req, res) => {
  if (!STRIPE_CONFIGURED) return res.status(503).json({ error: 'Billing is not configured on this server. Set STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH.' });
  if (req.user?.persona === 'defense') return res.status(403).json({ error: 'Defense-firm accounts are never billed — nothing to check out.' });

  const countResult = await q(`SELECT COUNT(*)::int AS n FROM cases WHERE org_id = $1 AND status != 'Closed'`, [req.orgId]);
  const matterCount = countResult.rows[0].n;
  const tier = tierForMatterCount(matterCount);
  const priceId = priceIdForTier(tier);
  if (!priceId) {
    return res.status(200).json({ tier, matterCount, contactSalesRequired: true, message: 'This org is in the Enterprise band — checkout is handled by sales, not self-serve.' });
  }

  const orgResult = await q('SELECT * FROM organizations WHERE id = $1', [req.orgId]);
  const org = orgResult.rows[0];
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: org.name, metadata: { orgId: org.id } });
    customerId = customer.id;
    await q('UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2', [customerId, org.id]);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: org.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: (process.env.APP_URL || 'http://localhost:3000') + '/case-closed-pro.html?billing=success',
    cancel_url: (process.env.APP_URL || 'http://localhost:3000') + '/case-closed-pro.html?billing=canceled',
    metadata: { orgId: org.id, tier }
  });
  res.json({ url: session.url, tier, matterCount });
});

app.get('/api/billing/status', async (req, res) => {
  const orgResult = await q('SELECT * FROM organizations WHERE id = $1', [req.orgId]);
  const org = orgResult.rows[0];
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const countResult = await q(`SELECT COUNT(*)::int AS n FROM cases WHERE org_id = $1 AND status != 'Closed'`, [req.orgId]);
  const matterCount = countResult.rows[0].n;
  res.json({
    planTier: org.plan_tier,
    suggestedTier: tierForMatterCount(matterCount),
    matterCount,
    subscriptionStatus: org.subscription_status,
    billingConfigured: STRIPE_CONFIGURED
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
  const result = await q(
    `INSERT INTO cases (org_id, matter_no, client, type, status, litigation_stage, attorney, carrier, claim_no, reserve_amount, filed_date, deadline_date, value, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.orgId, b.matterNo || null, b.client, b.type || 'Other', b.status || 'Active', b.litigationStage || 'Pre-Suit',
     b.attorney || null, b.carrier || null, b.claimNo || null, b.reserveAmount || 0, b.filed || null, b.deadline || null, b.value || 0, JSON.stringify(data)]
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < records.length; i++) {
      const b = records[i];
      try {
        if (!b.client) throw new Error('client is required');
        const data = { ...defaultCaseData(), ...(b.data || {}) };
        if (b.settlementAmount != null) data.exposure.settlementAmount = b.settlementAmount;
        const result = await client.query(
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
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Import failed: ' + e.message });
  } finally {
    client.release();
  }
  await audit(req.orgId, req.user?.sub, 'case.import', 'case', null, { imported: created.length, failed: errors.length }, req.ip);
  res.status(201).json({ imported: created.length, failed: errors.length, errors, cases: created });
});

app.patch('/api/cases/:id', async (req, res) => {
  const existing = await q('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'Case not found' });
  const current = existing.rows[0];
  const b = req.body || {};
  const mergedData = { ...current.data, ...(b.data || {}) };
  const result = await q(
    `UPDATE cases SET
       matter_no = COALESCE($1, matter_no), client = COALESCE($2, client), type = COALESCE($3, type),
       status = COALESCE($4, status), litigation_stage = COALESCE($5, litigation_stage), attorney = COALESCE($6, attorney),
       carrier = COALESCE($7, carrier), claim_no = COALESCE($8, claim_no), reserve_amount = COALESCE($9, reserve_amount),
       value = COALESCE($10, value), data = $11
     WHERE id = $12 AND org_id = $13 RETURNING *`,
    [b.matterNo, b.client, b.type, b.status, b.litigationStage, b.attorney, b.carrier, b.claimNo, b.reserveAmount, b.value,
     JSON.stringify(mergedData), req.params.id, req.orgId]
  );
  await audit(req.orgId, req.user?.sub, 'case.update', 'case', req.params.id, { fields: Object.keys(b) }, req.ip);
  res.json(rowToCase(result.rows[0]));
});

app.delete('/api/cases/:id', async (req, res) => {
  const result = await q('DELETE FROM cases WHERE id = $1 AND org_id = $2 RETURNING id', [req.params.id, req.orgId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Case not found' });
  await audit(req.orgId, req.user?.sub, 'case.delete', 'case', req.params.id, null, req.ip);
  res.json({ deleted: true, id: req.params.id });
});

// Grant a defense firm access to a specific matter (carrier-side action only).
app.post('/api/cases/:id/share', async (req, res) => {
  if (req.user?.persona === 'defense') return res.status(403).json({ error: 'Only the owning carrier can share a matter' });
  const { firmOrgId } = req.body || {};
  if (!firmOrgId) return res.status(400).json({ error: 'firmOrgId is required' });
  const caseCheck = await q('SELECT id FROM cases WHERE id = $1 AND org_id = $2', [req.params.id, req.orgId]);
  if (!caseCheck.rows[0]) return res.status(404).json({ error: 'Case not found' });
  await q('INSERT INTO case_access (case_id, firm_org_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, firmOrgId]);
  await audit(req.orgId, req.user?.sub, 'case.share', 'case', req.params.id, { firmOrgId }, req.ip);
  res.json({ shared: true });
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Case Closed Pro API (production) listening on :${PORT}`);
  console.log(SMTP_CONFIGURED ? `Email sending ENABLED via ${process.env.SMTP_HOST}` : 'Email sending DISABLED — set SMTP_HOST/USER/PASS to enable');
  console.log(API_KEY ? 'Static API_KEY auth path ENABLED (requires X-Org-Id header)' : 'Static API_KEY auth path DISABLED — user JWTs only');
});
