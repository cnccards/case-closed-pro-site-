// ---------------------------------------------------------------
// CLAIM FEED RUNS, HISTORY AND UNDO. Every real (not trial) load from the claim feed or an upload
// is written down: how many claims, what was created, what was updated, and for each updated
// matter what the changed values were BEFORE. That is what lets an admin undo a bad load.
//
// Undo is careful on purpose. A matter is only changed back (or removed, if the load created it)
// when nobody has touched it since the load. If someone edited it, or a later load changed it,
// it is left alone and listed, so undo never wipes out real work.
//
// Everything takes `db`, a client already scoped to one customer (req.db or a feed key's client).
// ---------------------------------------------------------------
import crypto from 'crypto';
import { normalizeRow, applyFields } from './claim-feed.js';

export const FEED_RUNS_DDL = [
  `CREATE TABLE IF NOT EXISTS feed_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source TEXT NOT NULL, key_name TEXT,
    received INT NOT NULL DEFAULT 0, created INT NOT NULL DEFAULT 0, updated INT NOT NULL DEFAULT 0,
    unchanged INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0,
    errors JSONB NOT NULL DEFAULT '[]'::jsonb, changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    dry_run BOOLEAN NOT NULL DEFAULT false,
    created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    undone_at TIMESTAMPTZ, undone_by UUID, undo_result JSONB)`,
  `CREATE INDEX IF NOT EXISTS idx_feed_runs_org ON feed_runs(org_id, created_at DESC)`,
  `ALTER TABLE feed_runs ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE feed_runs FORCE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feed_runs' AND policyname = 'feed_runs_tenant_isolation') THEN
      CREATE POLICY feed_runs_tenant_isolation ON feed_runs USING (org_id = current_setting('app.current_org_id', true)::uuid);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feed_runs' AND policyname = 'feed_runs_admin_bypass') THEN
      CREATE POLICY feed_runs_admin_bypass ON feed_runs FOR SELECT USING (current_setting('app.is_platform_admin', true) = 'true');
    END IF;
  END $$`
];

const COLS = new Set(['client', 'type', 'status', 'litigation_stage', 'carrier', 'reserve_amount', 'value', 'filed_date']);
const AT_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
export function ymd(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  return String(v).slice(0, 10);
}
// What to remember so a change can be put back: old column values and old top-level data keys.
export function makeBefore(cur, next) {
  const before = { cols: {}, data: {}, added: [] };
  for (const col of Object.keys(next.cols || {})) before.cols[col] = col === 'filed_date' ? ymd(cur[col]) : cur[col];
  const a = cur.data || {}, b = next.data || {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (k in a) before.data[k] = a[k]; else before.added.push(k);
  }
  return before;
}

// Loads rows into the customer's matters. Returns { ok, dryRun, received, created, updated, unchanged,
// failed, errors, unknownColumns, changes } — `changes` is for the history log and is removed before replying.
export async function runFeed(db, orgId, keyName, rows, dryRun, deps) {
  const out = { ok: true, dryRun, received: rows.length, created: 0, updated: 0, unchanged: 0, failed: 0, errors: [], unknownColumns: [], changes: [] };
  const unknown = new Set();
  for (let i = 0; i < rows.length; i++) {
    try {
      const { fields, unknown: unk } = normalizeRow(rows[i]);
      unk.forEach(u => unknown.add(String(u).slice(0, 60)));
      await deps.withRowSavepoint(db, async () => {
        const cur = (await db.query(`SELECT id, matter_no, client, type, status, litigation_stage, carrier, reserve_amount, value, filed_date, data, ${AT_SQL} AS prev_at FROM cases WHERE org_id = $1 AND lower(claim_no) = lower($2) ORDER BY created_at LIMIT 1 FOR UPDATE`, [orgId, fields.claimNo])).rows[0];
        if (!cur && !fields.client) throw new Error('client is required for a new claim');
        const base = deps.defaultCaseData();
        base.updates = [{ date: new Date().toISOString().slice(0, 10), author: 'Claim feed', type: 'Case Opened', text: `Matter created from the claim feed (${keyName}).` }];
        const r = applyFields(cur || null, fields, base);
        if (r.isNew) {
          const c = r.cols;
          const ins = await db.query(
            `INSERT INTO cases (org_id, matter_no, client, type, status, litigation_stage, carrier, claim_no, reserve_amount, filed_date, value, data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, matter_no, ${AT_SQL} AS at`,
            [orgId, 'FD-' + crypto.randomBytes(4).toString('hex').toUpperCase(), c.client, c.type || 'Other', c.status || 'Active', c.litigation_stage || 'Pre-Suit', c.carrier || null, fields.claimNo, c.reserve_amount || 0, c.filed_date || null, c.value || 0, JSON.stringify(r.data)]);
          const row = ins.rows[0];
          out.created++;
          if (row) out.changes.push({ kind: 'created', id: row.id, matterNo: row.matter_no, claimNo: fields.claimNo, at: row.at });
        } else if (r.changed.length) {
          const sets = ['data = $3', 'updated_at = now()'], vals = [orgId, fields.claimNo, JSON.stringify(r.data)];
          for (const [col, v] of Object.entries(r.cols)) { vals.push(v); sets.push(`${col} = $${vals.length}`); }
          const upd = await db.query(`UPDATE cases SET ${sets.join(', ')} WHERE org_id = $1 AND lower(claim_no) = lower($2) RETURNING id, matter_no, ${AT_SQL} AS at`, vals);
          const row = upd.rows[0];
          out.updated++;
          if (row) out.changes.push({ kind: 'updated', id: row.id, matterNo: row.matter_no, claimNo: fields.claimNo, at: row.at, prevAt: cur.prev_at, before: makeBefore(cur, r) });
        } else out.unchanged++;
      });
    } catch (e) {
      out.failed++;
      if (out.errors.length < 50) out.errors.push({ row: i + 1, claimNo: String((rows[i] && (rows[i].claimNo || rows[i].claim_no || rows[i]['Claim Number'])) || '').slice(0, 80), error: e.message });
    }
  }
  out.unknownColumns = Array.from(unknown).slice(0, 40);
  return out;
}

// Writes the run to the history and returns the reply for the caller (without the private `changes`).
export async function logRun(db, orgId, meta, out) {
  const { changes, ...reply } = out;
  if (out.dryRun) return reply;
  const r = await db.query(
    `INSERT INTO feed_runs (org_id, source, key_name, received, created, updated, unchanged, failed, errors, changes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [orgId, meta.source, String(meta.keyName || '').slice(0, 160), out.received, out.created, out.updated, out.unchanged, out.failed, JSON.stringify(out.errors), JSON.stringify(changes), meta.userId || null]);
  reply.runId = r.rows[0] && r.rows[0].id;
  return reply;
}

export async function listRuns(db, orgId, limit = 30) {
  const r = await db.query(
    `SELECT id, source, key_name, received, created, updated, unchanged, failed, created_at, undone_at, undo_result,
            (SELECT count(*) FROM jsonb_array_elements(changes)) AS changed_count
       FROM feed_runs WHERE org_id = $1 AND dry_run = false ORDER BY created_at DESC LIMIT $2`, [orgId, Math.min(100, limit)]);
  return r.rows.map(x => ({ id: x.id, source: x.source, keyName: x.key_name, received: +x.received, created: +x.created, updated: +x.updated, unchanged: +x.unchanged, failed: +x.failed, at: x.created_at, undoneAt: x.undone_at || null, undoResult: x.undo_result || null, canUndo: !x.undone_at && (+x.created + +x.updated) > 0 }));
}

// Puts a load back. Returns { restored, removed, skipped: [{matterNo, reason}] }.
// A matter is put back only if it is exactly as this load left it. One exception makes undoing a
// stack of loads work newest-first: if a LATER load was undone and that undo returned the matter to
// the state this load left, the matter counts as untouched (each undo records "at" and "was").
export async function undoRun(db, orgId, runId, userId) {
  const run = (await db.query('SELECT id, changes, undone_at FROM feed_runs WHERE id = $1 AND org_id = $2 FOR UPDATE', [runId, orgId])).rows[0];
  if (!run) { const e = new Error('That load was not found.'); e.statusCode = 404; throw e; }
  if (run.undone_at) { const e = new Error('That load has already been undone.'); e.statusCode = 409; throw e; }
  const changes = Array.isArray(run.changes) ? run.changes : [];
  const byCase = new Map();
  for (const ch of changes) { if (!byCase.has(ch.id)) byCase.set(ch.id, []); byCase.get(ch.id).push(ch); }
  const res = { restored: 0, removed: 0, skipped: [], restoredAt: {} };
  for (const [caseId, list] of byCase) {
    const lastAt = list[list.length - 1].at, label = list[0].matterNo || caseId;
    const cur = (await db.query(`SELECT id, ${AT_SQL} AS at FROM cases WHERE id = $1 AND org_id = $2 FOR UPDATE`, [caseId, orgId])).rows[0];
    if (!cur) { res.skipped.push({ matterNo: label, reason: 'Already deleted.' }); continue; }
    let untouched = cur.at === lastAt;
    if (!untouched) {
      const m = await db.query(`SELECT 1 FROM feed_runs WHERE org_id = $1 AND undone_at IS NOT NULL AND undo_result->'restoredAt'->$2->>'at' = $3 AND undo_result->'restoredAt'->$2->>'was' = $4 LIMIT 1`, [orgId, caseId, cur.at, lastAt]);
      untouched = m.rows.length > 0;
    }
    if (!untouched) { res.skipped.push({ matterNo: label, reason: 'Changed since this load, so it was left alone. If a later load changed it, undo that one first.' }); continue; }
    await db.query('SAVEPOINT undo_one');
    try {
      if (list[0].kind === 'created') {
        await db.query('DELETE FROM cases WHERE id = $1 AND org_id = $2', [caseId, orgId]);
        res.removed++;
      } else {
        let newAt = null;
        for (const ch of list.slice().reverse()) {
          const b = ch.before || { cols: {}, data: {}, added: [] };
          const sets = [`data = (COALESCE(data, '{}'::jsonb) - $3::text[]) || $4::jsonb`, 'updated_at = now()'];
          const vals = [caseId, orgId, b.added || [], JSON.stringify(b.data || {})];
          for (const [col, v] of Object.entries(b.cols || {})) {
            if (!COLS.has(col)) continue;
            vals.push(v); sets.push(`${col} = $${vals.length}`);
          }
          const u = await db.query(`UPDATE cases SET ${sets.join(', ')} WHERE id = $1 AND org_id = $2 RETURNING ${AT_SQL} AS at`, vals);
          newAt = u.rows[0] && u.rows[0].at;
        }
        if (newAt && list[0].prevAt) res.restoredAt[caseId] = { at: newAt, was: list[0].prevAt };
        res.restored++;
      }
      await db.query('RELEASE SAVEPOINT undo_one');
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT undo_one').catch(() => {});
      await db.query('RELEASE SAVEPOINT undo_one').catch(() => {});
      res.skipped.push({ matterNo: label, reason: 'Could not be put back (' + String(e.message).slice(0, 80) + ').' });
    }
  }
  await db.query('UPDATE feed_runs SET undone_at = now(), undone_by = $3, undo_result = $4 WHERE id = $1 AND org_id = $2', [runId, orgId, userId || null, JSON.stringify(res)]);
  const { restoredAt, ...reply } = res;
  return reply;
}

// Matters the claim feed created, for the "clear test data" screen. Only matters whose very first
// note says the feed created them.
export async function listFeedCreated(db, orgId) {
  const r = await db.query(
    `SELECT id, matter_no, client, claim_no, created_at, (data->'billing'->>'totalBilled') AS billed,
            jsonb_array_length(COALESCE(data->'updates','[]'::jsonb)) AS notes,
            jsonb_array_length(COALESCE(data->'documents','[]'::jsonb)) AS docs,
            jsonb_array_length(COALESCE(data->'tasks','[]'::jsonb)) AS tasks
       FROM cases WHERE org_id = $1 AND data->'updates'->0->>'author' = 'Claim feed' AND data->'updates'->0->>'type' = 'Case Opened'
       ORDER BY created_at DESC LIMIT 500`, [orgId]);
  return r.rows.map(x => ({ id: x.id, matterNo: x.matter_no, client: x.client, claimNo: x.claim_no, createdAt: x.created_at, billed: Number(x.billed) || 0, notes: +x.notes, docs: +x.docs, tasks: +x.tasks, touched: +x.notes > 1 || +x.docs > 0 || +x.tasks > 0 || (Number(x.billed) || 0) > 0 }));
}
// Deletes the chosen feed-created matters. Refuses anything the feed did not create.
export async function deleteFeedCreated(db, orgId, ids) {
  const clean = (Array.isArray(ids) ? ids : []).map(String).filter(s => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 500);
  if (!clean.length) return { deleted: 0 };
  const r = await db.query(
    `DELETE FROM cases WHERE org_id = $1 AND id = ANY($2::uuid[]) AND data->'updates'->0->>'author' = 'Claim feed' AND data->'updates'->0->>'type' = 'Case Opened' RETURNING id`, [orgId, clean]);
  return { deleted: r.rows.length };
}
