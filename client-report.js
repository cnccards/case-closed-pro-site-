// ---------------------------------------------------------------
// CLIENT REPORT. The monthly report a TPA sends to each insurance-company client (a "client
// account"): what is open, what closed and how, what it cost, what is coming up, and which
// matters need watching. Pure functions: no database, no clock. The server uses this for the
// scheduled email; the app copies the block between CR-BEGIN / CR-END into the page for the
// on-screen report and "Print / save as PDF", so the two always match.
// It reads the early-warning block, so in the app that block must be present too.
// ---------------------------------------------------------------
import { earlyWarning } from './early-warning.js';
/*CR-BEGIN*/
function crDate(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : '';
}
function crDays(a, b) {
  const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z');
  return isFinite(x) && isFinite(y) ? Math.round((y - x) / 864e5) : null;
}
function crAddDays(s, n) { const d = new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5); return d.toISOString().slice(0, 10); }
function crMoney(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function crEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function crNiceDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return s || '';
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
}
// kind: 'last_month' | 'last_30' | 'last_7' | 'month_to_date'. Returns { start, end, label, kind }.
function crPeriod(kind, today) {
  const y = +today.slice(0, 4), mo = +today.slice(5, 7);
  if (kind === 'last_7') return { kind, start: crAddDays(today, -6), end: today, label: 'Last 7 days' };
  if (kind === 'last_30') return { kind, start: crAddDays(today, -29), end: today, label: 'Last 30 days' };
  if (kind === 'month_to_date') return { kind, start: today.slice(0, 8) + '01', end: today, label: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo - 1] + ' ' + y + ' (to date)' };
  const pm = mo === 1 ? 12 : mo - 1, py = mo === 1 ? y - 1 : y;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const p2 = n => String(n).padStart(2, '0');
  return { kind: 'last_month', start: py + '-' + p2(pm) + '-01', end: py + '-' + p2(pm) + '-' + p2(last), label: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][pm - 1] + ' ' + py };
}
function crOpened(c) { return crDate(c.openedDate) || crDate(c._createdAt) || crDate(c.filed); }
function crClosedOn(c) { return crDate(c.closing && c.closing.dispositionDate) || crDate(c._updatedAt); }
// opts: { account:'' (all accounts), period:{start,end,label}, today, orgName, includeRisk }
function crBuild(cases, opts) {
  const o = opts || {}, today = o.today, per = o.period;
  const acct = String(o.account || '').trim();
  const mine = cases.filter(c => !acct || String(c.clientAccount || '').trim() === acct);
  const open = mine.filter(c => c.status !== 'Closed');
  const inPer = d => d && d >= per.start && d <= per.end;
  const opened = mine.filter(c => inPer(crOpened(c)));
  const closed = mine.filter(c => c.status === 'Closed' && inPer(crClosedOn(c)));
  const reserves = open.reduce((t, c) => t + (Number(c.insurance && c.insurance.reserveAmount) || 0), 0);
  const likely = open.reduce((t, c) => t + (Number(c.exposure && c.exposure.likelyExposure) || 0), 0);
  let invoiced = 0, invCount = 0;
  mine.forEach(c => ((c.billing && c.billing.invoices) || []).forEach(i => { const d = crDate(i.date); if (inPer(d)) { invoiced += Number(i.amount) || 0; invCount++; } }));
  const openBilled = open.reduce((t, c) => t + (Number(c.billing && c.billing.totalBilled) || 0), 0);
  const withBudget = open.filter(c => Number(c.billing && c.billing.budget) > 0);
  const overBudget = withBudget.filter(c => (Number(c.billing.totalBilled) || 0) > Number(c.billing.budget));
  const closedRows = closed.map(c => {
    const od = crOpened(c), cd = crClosedOn(c);
    return { matter: c.matterNo || c.id, client: c.client, disposition: (c.closing && c.closing.dispositionType) || 'Not recorded', indemnity: Number(c.closing && c.closing.finalIndemnityPaid) || 0, fees: Number(c.billing && c.billing.totalBilled) || 0, days: od && cd ? crDays(od, cd) : null, firm: (c.defenseCounsel && (c.defenseCounsel.firm || c.defenseCounsel.name)) || c.attorney || '' };
  }).sort((a, b) => (a.matter < b.matter ? -1 : 1));
  const indemnity = closedRows.reduce((t, r) => t + r.indemnity, 0), closedFees = closedRows.reduce((t, r) => t + r.fees, 0);
  const dispo = {}; closedRows.forEach(r => { dispo[r.disposition] = (dispo[r.disposition] || 0) + 1; });
  const horizon = crAddDays(today, 60), upcoming = [];
  open.forEach(c => {
    const k = c.keyDates || {};
    [['trialDate', 'Trial'], ['mediationDate', 'Mediation'], ['sol', 'Statute of limitations'], ['discoveryClose', 'Discovery closes'], ['msjDeadline', 'Summary-judgment deadline'], ['answerDue', 'Answer due']].forEach(([f, label]) => {
      const d = crDate(k[f]); if (d && d >= today && d <= horizon) upcoming.push({ date: d, what: label, matter: c.matterNo || c.id, client: c.client, days: crDays(today, d) });
    });
    (Array.isArray(c.timeLimitDemands) ? c.timeLimitDemands : []).forEach(dm => {
      if (!dm || dm.status !== 'open') return;
      const d = crDate(dm.extendedDeadline || dm.deadline); if (d && d <= horizon) upcoming.push({ date: d, what: d < today ? 'Time-limit demand (PAST DUE)' : 'Time-limit demand', matter: c.matterNo || c.id, client: c.client, days: crDays(today, d) });
    });
  });
  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let watch = [];
  if (o.includeRisk !== false) {
    watch = open.map(c => { const r = earlyWarning(c, today); return { matter: c.matterNo || c.id, client: c.client, score: r.score, level: r.level, reasons: r.reasons.slice(0, 3).map(x => x.text) }; })
      .filter(x => x.level !== 'ok').sort((a, b) => b.score - a.score).slice(0, 10);
  }
  const avg = (list, f) => { const v = list.map(f).filter(x => x != null && x >= 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const lcOf = c => ({ fnol: crDate(c.fnolDate), asg: crDate(c.lifecycle && c.lifecycle.counselAssignedDate), filed: crDate(c.filed) });
  const toAsg = avg(mine, c => { const l = lcOf(c); return l.fnol && l.asg ? crDays(l.fnol, l.asg) : null; });
  const toFiled = avg(mine, c => { const l = lcOf(c); return l.fnol && l.filed ? crDays(l.fnol, l.filed) : null; });
  return {
    account: acct, orgName: o.orgName || '', today, period: per,
    totals: { open: open.length, opened: opened.length, closed: closed.length, reserves, likelyExposure: likely, invoiced, invoiceCount: invCount, openBilled, indemnityPaid: indemnity, closedFees, budgeted: withBudget.length, overBudget: overBudget.length },
    dispositions: Object.entries(dispo).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    closedRows, opened: opened.slice(0, 25).map(c => ({ matter: c.matterNo || c.id, client: c.client, type: c.type || '', date: crOpened(c) })),
    upcoming: upcoming.slice(0, 25), watch,
    lifecycle: { daysToCounsel: toAsg, daysToSuit: toFiled }
  };
}
function crText(d) {
  const t = d.totals, L = [];
  L.push((d.account ? d.account + ' — ' : '') + 'Litigation report, ' + d.period.label);
  L.push('Prepared by ' + d.orgName + ' on ' + crNiceDate(d.today), '');
  L.push('AT A GLANCE');
  L.push('  Open matters: ' + t.open + '   Opened this period: ' + t.opened + '   Closed this period: ' + t.closed);
  L.push('  Reserves on open matters: ' + crMoney(t.reserves) + '   Likely exposure: ' + crMoney(t.likelyExposure));
  L.push('  Defense invoices this period: ' + crMoney(t.invoiced) + ' (' + t.invoiceCount + ')   Indemnity paid on closed matters: ' + crMoney(t.indemnityPaid));
  if (t.budgeted) L.push('  Matters over budget: ' + t.overBudget + ' of ' + t.budgeted + ' with a budget set');
  if (d.lifecycle.daysToCounsel != null) L.push('  Average days from first notice to counsel assigned: ' + d.lifecycle.daysToCounsel);
  if (d.lifecycle.daysToSuit != null) L.push('  Average days from first notice to suit filed: ' + d.lifecycle.daysToSuit);
  if (d.closedRows.length) {
    L.push('', 'CLOSED THIS PERIOD');
    d.closedRows.forEach(r => L.push('  ' + r.matter + '  ' + r.client + ' — ' + r.disposition + ', indemnity ' + crMoney(r.indemnity) + ', defense fees ' + crMoney(r.fees) + (r.days != null ? ', ' + r.days + ' days open' : '')));
  }
  if (d.upcoming.length) {
    L.push('', 'COMING UP (next 60 days)');
    d.upcoming.forEach(u => L.push('  ' + crNiceDate(u.date) + '  ' + u.what + ' — ' + u.matter + ' ' + u.client + (u.days < 0 ? ' (' + Math.abs(u.days) + ' days past)' : u.days === 0 ? ' (today)' : ' (in ' + u.days + ' days)')));
  }
  if (d.watch.length) {
    L.push('', 'MATTERS TO WATCH');
    d.watch.forEach(w => { L.push('  ' + w.matter + '  ' + w.client + ' — ' + (w.level === 'high' ? 'HIGH' : 'WATCH') + ' (' + w.score + ')'); w.reasons.forEach(r => L.push('      - ' + r)); });
  }
  L.push('', 'Figures come from the matters recorded in Case Closed as of ' + crNiceDate(d.today) + '. This report is not legal advice.');
  return L.join('\n');
}
function crHtml(d) {
  const t = d.totals, NAVY = '#1E3A5F', INK = '#1F2937', MUTE = '#6B7280', LINE = '#E5E7EB';
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid ' + NAVY + ';font-size:11px;color:' + MUTE + ';font-weight:600"';
  const td = (extra) => 'style="padding:6px 8px;border-bottom:1px solid ' + LINE + ';font-size:12px;color:' + INK + ';' + (extra || '') + '"';
  const tile = (label, val) => '<td style="width:25%;padding:10px 12px;border:1px solid ' + LINE + ';vertical-align:top"><div style="font-size:11px;color:' + MUTE + '">' + crEsc(label) + '</div><div style="font-size:20px;font-weight:700;color:' + NAVY + ';margin-top:2px">' + crEsc(val) + '</div></td>';
  const sec = h => '<h2 style="font-size:14px;color:' + NAVY + ';margin:22px 0 6px;border-bottom:1px solid ' + LINE + ';padding-bottom:4px">' + crEsc(h) + '</h2>';
  let h = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:' + INK + ';line-height:1.45">';
  h += '<div style="background:' + NAVY + ';color:#fff;padding:16px 20px"><div style="font-size:12px;opacity:.85">' + crEsc(d.orgName) + '</div><div style="font-size:20px;font-weight:700;margin-top:2px">' + crEsc(d.account ? d.account + ' — litigation report' : 'Litigation report — all accounts') + '</div><div style="font-size:12px;opacity:.85;margin-top:2px">' + crEsc(d.period.label) + ' · prepared ' + crEsc(crNiceDate(d.today)) + '</div></div>';
  h += '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:14px"><tr>' + tile('Open matters', t.open) + tile('Opened this period', t.opened) + tile('Closed this period', t.closed) + tile('Reserves (open)', crMoney(t.reserves)) + '</tr><tr>' + tile('Likely exposure', crMoney(t.likelyExposure)) + tile('Defense invoices', crMoney(t.invoiced)) + tile('Indemnity paid (closed)', crMoney(t.indemnityPaid)) + tile('Over budget', t.budgeted ? t.overBudget + ' of ' + t.budgeted : 'No budgets set') + '</tr></table>';
  if (d.lifecycle.daysToCounsel != null || d.lifecycle.daysToSuit != null) {
    h += '<p style="font-size:12px;color:' + MUTE + ';margin:10px 0 0">' + (d.lifecycle.daysToCounsel != null ? 'First notice to counsel assigned: <b style="color:' + INK + '">' + d.lifecycle.daysToCounsel + ' days</b> on average. ' : '') + (d.lifecycle.daysToSuit != null ? 'First notice to suit filed: <b style="color:' + INK + '">' + d.lifecycle.daysToSuit + ' days</b> on average.' : '') + '</p>';
  }
  if (d.closedRows.length) {
    h += sec('Closed this period');
    if (d.dispositions.length) h += '<p style="font-size:12px;margin:0 0 6px;color:' + MUTE + '">' + d.dispositions.map(x => crEsc(x.name) + ': ' + x.n).join(' · ') + '</p>';
    h += '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse"><tr><th ' + th + '>Matter</th><th ' + th + '>Insured</th><th ' + th + '>Outcome</th><th ' + th + '>Indemnity</th><th ' + th + '>Defense fees</th><th ' + th + '>Days open</th></tr>';
    d.closedRows.forEach(r => { h += '<tr><td ' + td() + '>' + crEsc(r.matter) + '</td><td ' + td() + '>' + crEsc(r.client) + '</td><td ' + td() + '>' + crEsc(r.disposition) + '</td><td ' + td('text-align:right') + '>' + crMoney(r.indemnity) + '</td><td ' + td('text-align:right') + '>' + crMoney(r.fees) + '</td><td ' + td('text-align:right') + '>' + (r.days != null ? r.days : '—') + '</td></tr>'; });
    h += '</table>';
  }
  if (d.opened.length) {
    h += sec('Opened this period');
    h += '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse"><tr><th ' + th + '>Matter</th><th ' + th + '>Insured</th><th ' + th + '>Type</th><th ' + th + '>Opened</th></tr>';
    d.opened.forEach(r => { h += '<tr><td ' + td() + '>' + crEsc(r.matter) + '</td><td ' + td() + '>' + crEsc(r.client) + '</td><td ' + td() + '>' + crEsc(r.type) + '</td><td ' + td() + '>' + crEsc(crNiceDate(r.date)) + '</td></tr>'; });
    h += '</table>';
  }
  if (d.upcoming.length) {
    h += sec('Coming up in the next 60 days');
    h += '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse"><tr><th ' + th + '>Date</th><th ' + th + '>What</th><th ' + th + '>Matter</th><th ' + th + '>When</th></tr>';
    d.upcoming.forEach(u => { const late = u.days < 0; h += '<tr><td ' + td() + '>' + crEsc(crNiceDate(u.date)) + '</td><td ' + td(late ? 'color:#B91C1C;font-weight:700' : '') + '>' + crEsc(u.what) + '</td><td ' + td() + '>' + crEsc(u.matter + ' ' + u.client) + '</td><td ' + td() + '>' + (late ? Math.abs(u.days) + ' days past' : u.days === 0 ? 'today' : 'in ' + u.days + ' days') + '</td></tr>'; });
    h += '</table>';
  }
  if (d.watch.length) {
    h += sec('Matters to watch');
    d.watch.forEach(w => {
      const col = w.level === 'high' ? '#B91C1C' : '#B45309';
      h += '<div style="border-left:4px solid ' + col + ';padding:6px 10px;margin:6px 0;background:#FAFAFA"><div style="font-size:12px"><b>' + crEsc(w.matter) + '</b> ' + crEsc(w.client) + ' <span style="color:' + col + ';font-weight:700">· ' + (w.level === 'high' ? 'High' : 'Watch') + ' (' + w.score + ')</span></div>' + w.reasons.map(r => '<div style="font-size:12px;color:' + MUTE + '">• ' + crEsc(r) + '</div>').join('') + '</div>';
    });
  }
  h += '<p style="font-size:11px;color:' + MUTE + ';margin:22px 0 0;border-top:1px solid ' + LINE + ';padding-top:8px">Figures come from the matters recorded in Case Closed as of ' + crEsc(crNiceDate(d.today)) + '. Indemnity and fees are the amounts recorded on each matter. This report is not legal advice.</p></div>';
  return h;
}
/*CR-END*/
export { crPeriod, crBuild, crText, crHtml, crDate, crAddDays };
