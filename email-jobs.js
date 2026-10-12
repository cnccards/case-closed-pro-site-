// ---------------------------------------------------------------
// WORDING OF THE SCHEDULED EMAILS. Pure functions: data in, subject and text out. No database and
// no sending here, so every message can be tested by itself. scheduled-emails.js decides who gets
// what and when; this file decides what it says.
// ---------------------------------------------------------------
import { earlyWarning } from './early-warning.js';

const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const dayDiff = (a, b) => { const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z'); return isFinite(x) && isFinite(y) ? Math.round((y - x) / 864e5) : null; };
const niceDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) : (s || ''); };
const label = c => `${c.matterNo || c.id} ${c.client}`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ---------- task reminders ("diary") ----------
// One email per person, listing their own open tasks that are overdue, due today, or due within
// `lookahead` days. Nobody gets an email on a day they have nothing due.
export function buildDiaryMessages(cases, users, today, orgName, appUrl, lookahead = 3) {
  const out = [];
  const open = cases.filter(c => c.status !== 'Closed');
  for (const u of users) {
    const nm = String(u.name || '').trim().toLowerCase();
    if (!nm || !u.email) continue;
    const rows = [];
    for (const c of open) {
      for (const t of (c.tasks || [])) {
        if (!t || t.done || !t.due) continue;
        if (String(t.assignedTo || '').trim().toLowerCase() !== nm) continue;
        const due = String(t.due).slice(0, 10), left = dayDiff(today, due);
        if (left === null || left > lookahead) continue;
        rows.push({ c, t, due, left });
      }
    }
    if (!rows.length) continue;
    rows.sort((a, b) => a.left - b.left || (a.t.priority === 'High' ? -1 : 1));
    const late = rows.filter(r => r.left < 0), todayRows = rows.filter(r => r.left === 0), soon = rows.filter(r => r.left > 0);
    const line = r => `   - ${r.t.title}  [${label(r.c)}]${r.t.priority === 'High' ? '  (high priority)' : ''}`;
    let t = `Hi ${u.name || 'there'},\n\nYour task list in ${orgName}:\n\n`;
    if (late.length) { t += `OVERDUE (${late.length})\n` + late.map(r => `${line(r)}  — was due ${niceDate(r.due)}`).join('\n') + '\n\n'; }
    if (todayRows.length) { t += `DUE TODAY (${todayRows.length})\n` + todayRows.map(line).join('\n') + '\n\n'; }
    if (soon.length) { t += `COMING UP (${soon.length})\n` + soon.map(r => `${line(r)}  — due ${niceDate(r.due)}`).join('\n') + '\n\n'; }
    t += `Open Case Closed to mark them done:\n${appUrl}\n`;
    out.push({ to: u.email, subject: `${late.length ? late.length + ' overdue, ' : ''}${todayRows.length + soon.length} task${rows.length === 1 ? '' : 's'} on your list — ${orgName}`, text: t });
  }
  return out;
}

// ---------- claim feed summary ----------
// runs: rows from feed_runs since the last summary. Says plainly when nothing arrived, because a
// silent feed is usually a broken feed.
export function buildFeedSummary(runs, sinceLabel, today, orgName, appUrl, lastRunAt) {
  const t = { runs: runs.length, received: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const errs = new Map();
  for (const r of runs) {
    t.received += Number(r.received) || 0; t.created += Number(r.created) || 0; t.updated += Number(r.updated) || 0; t.unchanged += Number(r.unchanged) || 0; t.failed += Number(r.failed) || 0;
    for (const e of (Array.isArray(r.errors) ? r.errors : [])) { const k = String(e.error || '').slice(0, 120); if (k) errs.set(k, (errs.get(k) || 0) + 1); }
  }
  let body;
  if (!runs.length) {
    body = `No claims came in ${sinceLabel}.\n\n` + (lastRunAt ? `The last file or feed arrived on ${niceDate(String(lastRunAt).slice(0, 10))}.\n\n` : 'No feed or file has been received yet.\n\n') +
      'If you expect claims every day, check that the sending system is running and that its key has not been turned off (API & Import, Claim feed).\n';
  } else {
    body = `${sinceLabel[0].toUpperCase() + sinceLabel.slice(1)}:\n\n` +
      `   Files or batches received: ${t.runs}\n   Claims received: ${t.received}\n   New matters created: ${t.created}\n   Existing matters updated: ${t.updated}\n   No change: ${t.unchanged}\n   Could not be loaded: ${t.failed}\n\n`;
    if (t.failed) {
      body += 'WHY SOME COULD NOT BE LOADED\n' + Array.from(errs.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, n]) => `   - ${m}${n > 1 ? ` (${n} times)` : ''}`).join('\n') + '\n\n';
    }
    if (t.created) body += 'New matters are waiting for an attorney. Open Case Closed to assign counsel.\n';
  }
  const subject = !runs.length ? `No claims received ${sinceLabel} — ${orgName}` : `Claim feed: ${t.created} new, ${t.updated} updated${t.failed ? ', ' + t.failed + ' failed' : ''} — ${orgName}`;
  return { subject, text: `Claim feed summary — ${orgName}\n${niceDate(today)}\n\n${body}\n${appUrl}\n`, empty: !runs.length, totals: t };
}

// ---------- matters at risk ----------
export function buildRiskEmail(cases, today, orgName, appUrl, max = 15) {
  const rows = cases.filter(c => c.status !== 'Closed').map(c => ({ c, r: earlyWarning(c, today) })).filter(x => x.r.level !== 'ok').sort((a, b) => b.r.score - a.r.score);
  if (!rows.length) return { empty: true, subject: `No matters at risk — ${orgName}`, text: `No open matter in ${orgName} scores as high-risk or watch today.\n`, html: '' };
  const high = rows.filter(x => x.r.level === 'high').length;
  let t = `${rows.length} open matter${rows.length === 1 ? '' : 's'} need a look in ${orgName} (${high} high, ${rows.length - high} watch).\n\n`;
  rows.slice(0, max).forEach(x => {
    t += `${x.r.level === 'high' ? '[HIGH]' : '[WATCH]'} ${label(x.c)} — score ${x.r.score}${x.c.attorney ? ' — ' + x.c.attorney : ''}\n`;
    x.r.reasons.slice(0, 4).forEach(r => { t += `   - ${r.text}\n`; });
    t += '\n';
  });
  if (rows.length > max) t += `...and ${rows.length - max} more in Case Closed.\n\n`;
  t += `The score is a checklist of stated rules (deadlines, reserves, spend, quiet matters), not a prediction of the outcome.\n${appUrl}\n`;
  let h = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:#1F2937;line-height:1.45"><h2 style="font-size:16px;margin:0 0 8px">${esc(orgName)} — matters at risk</h2><p style="font-size:13px;margin:0 0 10px">${rows.length} open matter${rows.length === 1 ? '' : 's'} (${high} high, ${rows.length - high} watch).</p>`;
  rows.slice(0, max).forEach(x => {
    const col = x.r.level === 'high' ? '#B91C1C' : '#B45309';
    h += `<div style="border-left:4px solid ${col};padding:6px 10px;margin:6px 0;background:#FAFAFA"><div style="font-size:13px"><b>${esc(label(x.c))}</b> <span style="color:${col};font-weight:700">· ${x.r.level === 'high' ? 'High' : 'Watch'} (${x.r.score})</span></div>${x.r.reasons.slice(0, 4).map(r => `<div style="font-size:12px;color:#6B7280">• ${esc(r.text)}</div>`).join('')}</div>`;
  });
  h += `<p style="font-size:11px;color:#6B7280;margin-top:14px">The score is a checklist of stated rules, not a prediction of the outcome. <a href="${esc(appUrl)}">Open Case Closed</a></p></div>`;
  return { empty: false, subject: `${high ? high + ' high-risk, ' : ''}${rows.length - high} to watch — ${orgName}`, text: t, html: h };
}
