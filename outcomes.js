// Closed-matter track record per defense attorney or firm. Pure. Feeds the AI explanation in Sentinel Match
// so its write-up cites what actually happened on past matters, not just who has room.
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
const nameOf = c => String((c.defenseCounsel && c.defenseCounsel.name) || c.attorney || '').trim();
const FAVORABLE = /dismiss|defense|summary|no[- ]?cause|take[- ]?nothing|nonsuit|withdrawn/i;
export function counselTrackRecords(cases, opts) {
  const o = opts || {}, by = new Map();
  for (const c of cases || []) {
    if (c.status !== 'Closed') continue;
    const n = nameOf(c); if (!n) continue;
    const r = by.get(n) || { name: n, closed: 0, byType: {}, dispositions: {}, ratios: [], days: [], fees: [], indemnity: [], favorable: 0 };
    const cl = c.closing || {}, res = num(c.insurance && c.insurance.reserveAmount), ind = num(cl.finalIndemnityPaid), fees = num(c.billing && c.billing.totalBilled);
    r.closed++; r.byType[c.type || 'Other'] = (r.byType[c.type || 'Other'] || 0) + 1;
    const dt = cl.dispositionType || 'Not recorded'; r.dispositions[dt] = (r.dispositions[dt] || 0) + 1; if (FAVORABLE.test(dt)) r.favorable++;
    if (res > 0 && ind >= 0 && cl.dispositionType) r.ratios.push(ind / res);
    const a = day(c.filed || c.fnolDate || c._createdAt), b = day(cl.dispositionDate); if (a != null && b != null && b >= a) r.days.push(b - a);
    if (fees > 0) r.fees.push(fees); if (ind > 0) r.indemnity.push(ind);
    by.set(n, r);
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const min = o.minClosed == null ? 1 : o.minClosed;
  return [...by.values()].filter(r => r.closed >= min).map(r => ({
    name: r.name, closed: r.closed, byType: r.byType, dispositions: r.dispositions,
    favorableRate: r.closed ? r.favorable / r.closed : null, indemnityVsReserve: avg(r.ratios), avgDaysOpen: avg(r.days) == null ? null : Math.round(avg(r.days)),
    avgFees: avg(r.fees) == null ? null : Math.round(avg(r.fees)), avgIndemnity: avg(r.indemnity) == null ? null : Math.round(avg(r.indemnity))
  })).sort((a, b) => b.closed - a.closed);
}
// A short block of plain text for the AI prompt. Names only the people asked about.
export function trackRecordText(records, names, matterType) {
  const want = new Set((names || []).map(x => String(x).trim().toLowerCase()));
  const lines = records.filter(r => !want.size || want.has(r.name.toLowerCase())).slice(0, 12).map(r => {
    const t = matterType && r.byType[matterType] ? `, ${r.byType[matterType]} of them ${matterType}` : '';
    return `- ${r.name}: ${r.closed} closed matter${r.closed === 1 ? '' : 's'}${t}` +
      (r.favorableRate != null ? `, ${Math.round(r.favorableRate * 100)}% ended by dismissal or defense result` : '') +
      (r.indemnityVsReserve != null ? `, paid ${Math.round(r.indemnityVsReserve * 100)}% of reserve on average` : '') +
      (r.avgDaysOpen != null ? `, ${r.avgDaysOpen} days to close on average` : '') + (r.avgFees != null ? `, average defense fees $${r.avgFees.toLocaleString('en-US')}` : '');
  });
  return lines.length ? 'Past results on closed matters (from this customer\'s own records):\n' + lines.join('\n') : '';
}
