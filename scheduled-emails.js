// ---------------------------------------------------------------
// SCHEDULED EMAILS. A customer admin sets up any number of recurring emails, each with its own
// kind, schedule and recipients. This file holds the table definition, the checks on what a
// browser sends, and the runner that finds what is due and sends it. server.js wires the routes
// and passes in the things only it owns (database pool, mail transport, the older digest and
// alert builders). Date rules live in schedule.js; wording lives in email-jobs.js.
//
// Hosting note, stated plainly: a sleeping free-tier server runs no code. Missed sends are
// caught up when it wakes (see MAX_LATE in schedule.js); on a paid always-on plan they go out on time.
// ---------------------------------------------------------------
import * as SCH from './schedule.js';
import { buildDiaryMessages, buildFeedSummary, buildRiskEmail } from './email-jobs.js';
import { crPeriod, crBuild, crText, crHtml } from './client-report.js';

export const MAX_SCHEDULES_PER_ORG = 25;
export const MAX_RECIPIENTS = 20;
export const PERIODS = ['last_month', 'last_30', 'last_7', 'month_to_date'];

// who: 'list'   = goes to the addresses typed in
//      'people' = each team member gets their own version, no list needed
export const KINDS = {
  digest: { label: 'Executive briefing', who: 'list', blurb: 'The Sentinel Digest: a plain-English briefing on the whole portfolio.' },
  alerts: { label: 'Needs-attention alerts', who: 'people', blurb: 'Each person gets what needs them; managers get the whole portfolio. Skipped on days with nothing to report.' },
  diary: { label: 'Task reminders', who: 'people', blurb: 'Each person gets their own overdue, due-today and coming-up tasks. Skipped on days with nothing due.' },
  risk: { label: 'Matters at risk', who: 'list', blurb: 'Open matters that score high or watch on the early-warning checklist, with the reasons.' },
  feed_summary: { label: 'Claim feed summary', who: 'list', blurb: 'What the claim feed or uploads loaded since the last summary, including failures. Also tells you when nothing arrived.' },
  client_report: { label: 'Client report', who: 'list', blurb: 'The litigation report for one client account (or all accounts): open, closed, spend, upcoming dates, matters to watch.' }
};

export const SCHEDULED_EMAILS_DDL = [
  `CREATE TABLE IF NOT EXISTS scheduled_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL,
    recipients TEXT[] NOT NULL DEFAULT '{}',
    schedule JSONB NOT NULL, params JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_sent_date TEXT, last_sent_at TIMESTAMPTZ, last_error TEXT, last_result TEXT,
    created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_emails_org ON scheduled_emails(org_id)`,
  `ALTER TABLE scheduled_emails ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE scheduled_emails FORCE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scheduled_emails' AND policyname = 'scheduled_emails_tenant_isolation') THEN
      CREATE POLICY scheduled_emails_tenant_isolation ON scheduled_emails USING (org_id = current_setting('app.current_org_id', true)::uuid);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scheduled_emails' AND policyname = 'scheduled_emails_admin_bypass') THEN
      CREATE POLICY scheduled_emails_admin_bypass ON scheduled_emails USING (current_setting('app.is_platform_admin', true) = 'true');
    END IF;
  END $$`
];

// ---------- checks on what the browser sends ----------
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
export function cleanRecipients(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const out = [];
  for (let e of list) {
    e = String(e).trim().toLowerCase();
    if (!e) continue;
    if (e.length > 200 || !EMAIL_RE.test(e)) throw new Error(`"${String(e).slice(0, 60)}" is not a valid email address.`);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX_RECIPIENTS) throw new Error(`Up to ${MAX_RECIPIENTS} recipients per email.`);
  return out;
}
export function cleanParams(kind, p) {
  const x = p && typeof p === 'object' ? p : {};
  const out = {};
  if (kind === 'client_report') {
    out.account = String(x.account || '').trim().slice(0, 160);
    out.period = PERIODS.includes(x.period) ? x.period : 'last_month';
    out.includeRisk = x.includeRisk !== false;
  }
  if (kind === 'diary') {
    const n = Number(x.lookahead);
    out.lookahead = Number.isInteger(n) && n >= 0 && n <= 14 ? n : 3;
  }
  if (kind === 'feed_summary') out.sendEmpty = x.sendEmpty !== false; // a silent feed is worth hearing about
  if (kind === 'risk') out.sendEmpty = x.sendEmpty === true;
  if (kind === 'digest' || kind === 'alerts') out.sendEmpty = x.sendEmpty === true;
  return out;
}
// Full check of a create/update body. Returns { kind, name, recipients, schedule, params, enabled }.
export function cleanInput(body, today) {
  const b = body && typeof body === 'object' ? body : {};
  const kind = KINDS[b.kind] ? b.kind : null;
  if (!kind) throw new Error('Pick what to send.');
  const schedule = SCH.normalize(b.schedule, today);
  const recipients = cleanRecipients(b.recipients);
  if (KINDS[kind].who === 'list' && !recipients.length) throw new Error('Add at least one recipient email address.');
  const name = String(b.name || '').trim().slice(0, 120) || KINDS[kind].label;
  return { kind, name, recipients: KINDS[kind].who === 'list' ? recipients : [], schedule, params: cleanParams(kind, b.params), enabled: b.enabled !== false };
}
export function viewRow(row, et) {
  const sch = row.schedule || {};
  let next = null, desc = '';
  try { desc = SCH.describe(sch); next = row.enabled ? SCH.nextSend(sch, row.last_sent_date || '', et.date, et.hour) : null; } catch (e) { desc = 'Schedule needs to be set again'; }
  return {
    id: row.id, kind: row.kind, kindLabel: (KINDS[row.kind] || {}).label || row.kind, who: (KINDS[row.kind] || {}).who || 'list', name: row.name,
    recipients: row.recipients || [], schedule: sch, params: row.params || {}, enabled: !!row.enabled,
    description: desc, nextSend: next, lastSentDate: row.last_sent_date || null, lastSentAt: row.last_sent_at || null,
    lastError: row.last_error || null, lastResult: row.last_result || null
  };
}

// ---------- the runner ----------
// deps: { pool, mailer, smtpConfigured, from, easternNow, rowToCase, appUrl,
//         legacy: { digestFor(client, org) -> {subject,text}|null, saveDigest(client, orgId, {subject,text}), alertMessages(client, org) -> [{to,subject,text}] },
//         log }
export function makeScheduler(deps) {
  const state = { lastTick: null, lastTickOk: null, lastError: null, sentToday: 0 };
  const log = deps.log || console;

  async function usersOf(client, orgId) {
    return (await client.query('SELECT id, email, name, role FROM users WHERE org_id = $1 AND is_active = true', [orgId])).rows;
  }
  async function casesOf(client, orgId) {
    return (await client.query('SELECT * FROM cases WHERE org_id = $1', [orgId])).rows.map(deps.rowToCase);
  }

  // Builds the messages for one schedule without sending anything.
  // Returns { messages: [{to, subject, text, html?}], note }.
  async function build(client, org, s, et) {
    const p = s.params || {}, appUrl = deps.appUrl;
    const to = (s.recipients || []).join(',');
    switch (s.kind) {
      case 'digest': {
        const d = await deps.legacy.digestFor(client, org);
        if (!d) return { messages: [], note: 'The briefing is not part of this plan.' };
        return { messages: [{ to, subject: d.subject, text: d.text }], digest: d };
      }
      case 'alerts': {
        const msgs = await deps.legacy.alertMessages(client, org);
        if (!msgs.length && p.sendEmpty) return { messages: (await usersOf(client, org.id)).filter(u => u.role === 'owner' || u.role === 'admin').map(u => ({ to: u.email, subject: `All clear — ${org.name}`, text: `Hi ${u.name || 'there'},\n\nNothing needs attention across ${org.name} today.\n` })), note: '' };
        return { messages: msgs, note: msgs.length ? '' : 'Nothing needed attention.' };
      }
      case 'diary': {
        const m = buildDiaryMessages(await casesOf(client, org.id), await usersOf(client, org.id), et.date, org.name, appUrl, Number.isInteger(p.lookahead) ? p.lookahead : 3);
        return { messages: m, note: m.length ? '' : 'Nobody had tasks due.' };
      }
      case 'risk': {
        const r = buildRiskEmail(await casesOf(client, org.id), et.date, org.name, appUrl);
        if (r.empty && !p.sendEmpty) return { messages: [], note: 'No matters at risk.' };
        return { messages: [{ to, subject: r.subject, text: r.text, html: r.html || undefined }] };
      }
      case 'feed_summary': {
        const since = s.last_sent_at ? new Date(s.last_sent_at) : new Date(Date.now() - 7 * 864e5);
        const runs = (await client.query(`SELECT received, created, updated, unchanged, failed, errors, created_at FROM feed_runs WHERE org_id = $1 AND created_at > $2 AND dry_run = false ORDER BY created_at`, [org.id, since.toISOString()]).catch(() => ({ rows: [] }))).rows;
        const last = (await client.query(`SELECT max(created_at) AS at FROM feed_runs WHERE org_id = $1 AND dry_run = false`, [org.id]).catch(() => ({ rows: [] }))).rows[0]?.at || null;
        const days = Math.max(1, Math.round((Date.now() - since.getTime()) / 864e5));
        const f = buildFeedSummary(runs, s.last_sent_at ? `since the last summary (${days} day${days === 1 ? '' : 's'})` : 'in the last 7 days', et.date, org.name, appUrl, last);
        if (f.empty && p.sendEmpty === false) return { messages: [], note: 'Nothing arrived.' };
        return { messages: [{ to, subject: f.subject, text: f.text }] };
      }
      case 'client_report': {
        const per = crPeriod(PERIODS.includes(p.period) ? p.period : 'last_month', et.date);
        const d = crBuild(await casesOf(client, org.id), { account: p.account || '', period: per, today: et.date, orgName: org.name, includeRisk: p.includeRisk !== false });
        return { messages: [{ to, subject: `${p.account ? p.account + ' — ' : ''}Litigation report, ${per.label}`, text: crText(d), html: crHtml(d) }] };
      }
      default: return { messages: [], note: 'Unknown kind.' };
    }
  }

  async function deliver(messages) {
    let sent = 0, failed = 0, lastErr = '';
    for (const m of messages) {
      try {
        await deps.mailer.sendMail({ from: deps.from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
        sent++;
      } catch (e) { failed++; lastErr = e.message; log.error('Scheduled email to ' + String(m.to).replace(/[^@]*@/, '***@') + ' failed:', e.message); }
    }
    if (messages.length && sent === 0) throw new Error('Email could not be sent: ' + lastErr);
    return { sent, failed };
  }

  // One schedule, its own transaction. Locks the row so two server copies never both send.
  async function runOne(id) {
    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
      const row = (await client.query(`SELECT s.*, o.name AS org_name, o.plan_tier, o.features FROM scheduled_emails s JOIN organizations o ON o.id = s.org_id WHERE s.id = $1 AND s.enabled = true AND o.access_status = 'active' FOR UPDATE OF s SKIP LOCKED`, [id])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return null; }
      const et = deps.easternNow();
      if (!SCH.isDue(row.schedule, row.last_sent_date || '', et.date, et.hour)) { await client.query('ROLLBACK'); return null; }
      const org = { id: row.org_id, name: row.org_name, plan_tier: row.plan_tier, features: row.features };
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [row.org_id]);
      let result;
      await client.query('SAVEPOINT job');
      try {
        const b = await build(client, org, row, et);
        const r = b.messages.length ? await deliver(b.messages) : { sent: 0, failed: 0 };
        if (b.digest && b.digest.save && r.sent && deps.legacy.saveDigest) await deps.legacy.saveDigest(client, org.id, b.digest);
        result = r.sent ? `Sent ${r.sent} email${r.sent === 1 ? '' : 's'}${r.failed ? ', ' + r.failed + ' failed' : ''}` : (b.note || 'Nothing to send');
        state.sentToday += r.sent;
        await client.query(`UPDATE scheduled_emails SET last_sent_date = $2, last_sent_at = now(), last_error = NULL, last_result = $3, updated_at = now() WHERE id = $1`, [id, et.date, result]);
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT job').catch(() => {});
        await client.query(`UPDATE scheduled_emails SET last_error = $2, updated_at = now() WHERE id = $1`, [id, String(e.message).slice(0, 300)]);
        log.error(`Scheduled email ${id} (${row.kind}) failed, will retry at the next check:`, e.message);
        result = null;
      }
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (x) {}
      log.error('Scheduled email run failed:', e.message);
      return null;
    } finally { client.release(); }
  }

  // Finds everything due right now. Called every few minutes.
  async function tick() {
    state.lastTick = new Date().toISOString();
    if (!deps.smtpConfigured) { state.lastTickOk = true; return 0; }
    let ids = [];
    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
      const et = deps.easternNow();
      const rows = (await client.query(`SELECT s.id, s.schedule, s.last_sent_date FROM scheduled_emails s JOIN organizations o ON o.id = s.org_id WHERE s.enabled = true AND o.access_status = 'active' AND o.name NOT LIKE 'Health Check —%'`)).rows;
      await client.query('COMMIT');
      ids = rows.filter(r => { try { return SCH.isDue(r.schedule, r.last_sent_date || '', et.date, et.hour); } catch (e) { return false; } }).map(r => r.id);
      state.lastTickOk = true; state.lastError = null;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (x) {}
      state.lastTickOk = false; state.lastError = e.message;
      log.error('Scheduled email check failed:', e.message);
    } finally { client.release(); }
    let n = 0;
    for (const id of ids) { if (await runOne(id)) n++; }
    return n;
  }

  // For the "Send me a preview" button: builds the real email and sends it to one address only.
  async function previewFor(client, org, row, toEmail, toName) {
    const et = deps.easternNow();
    const b = await build(client, org, { ...row, recipients: [toEmail] }, et);
    let msgs = b.messages;
    if (!msgs.length) return { sent: 0, note: b.note || 'Nothing to send right now.' };
    // Per-person kinds make one message per person: send the requester their own, or the first.
    const mine = msgs.find(m => String(m.to).toLowerCase() === toEmail.toLowerCase()) || msgs[0];
    await deps.mailer.sendMail({ from: deps.from, to: toEmail, subject: '[Preview] ' + mine.subject, text: mine.text, ...(mine.html ? { html: mine.html } : {}) });
    return { sent: 1, note: '' };
  }

  return { tick, runOne, build, previewFor, state };
}
