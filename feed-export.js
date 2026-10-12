// ---------------------------------------------------------------
// OUTBOUND FEED. The mirror image of the claim feed: the customer's claims system (or a person)
// pulls the current status of matters out of Case Closed, so nobody types the same update twice.
// It is a pull, not a push: the claims system asks "what changed since I last asked?" with a
// cursor, and gets back only those matters. Field names match the inbound feed where they overlap,
// so one mapping serves both directions.
// Pure functions: rows in, rows out. server.js owns the key check and the query.
// ---------------------------------------------------------------
const ymd = v => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v)); return m ? m[1] : '';
};
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Column order for CSV. First group matches the inbound feed's names; the rest are outbound-only.
export const EXPORT_COLUMNS = [
  'claimNo', 'matterNo', 'client', 'account', 'carrier', 'type', 'status', 'litigationStage', 'state',
  'adjuster', 'backupAdjuster', 'defenseFirm', 'defenseCounsel', 'firmMatterNo', 'plaintiffAttorney', 'plaintiffFirm',
  'lossDate', 'fnolDate', 'coverageDate', 'holdDate', 'claimantAttorneyDate', 'defenseAssignedDate', 'filedDate', 'servedDate', 'answerDue',
  'firstReportDate', 'reserveSetDate', 'resolutionDate',
  'reserveAmount', 'value', 'likelyExposure', 'demandAmount', 'defenseBudget', 'defenseBilled', 'defensePaid',
  'trialDate', 'mediationDate', 'dispositionType', 'indemnityPaid', 'nextStep', 'riskScore', 'riskLevel', 'updatedAt'
];

// c is a case as rowToCase returns it. `risk` is { score, level } from earlyWarning (optional).
export function toExportRow(c, risk) {
  const lc = c.lifecycle || {}, dc = c.defenseCounsel || {}, kd = c.keyDates || {}, cl = c.closing || {}, ex = c.exposure || {}, bl = c.billing || {};
  const juris = String((c.court && c.court.jurisdiction) || '');
  return {
    claimNo: (c.insurance && c.insurance.claimNo) || c.claimNo || '',
    matterNo: c.matterNo || '', client: c.client || '', account: c.clientAccount || '', carrier: (c.insurance && c.insurance.carrier) || '',
    type: c.type || '', status: c.status || '', litigationStage: c.litigationStage || '', state: /^State\s*-\s*/i.test(juris) ? juris.replace(/^State\s*-\s*/i, '') : '',
    adjuster: c.adjusterPrimary || '', backupAdjuster: c.adjusterBackup || '',
    defenseFirm: dc.firm || '', defenseCounsel: dc.name || c.attorney || '', firmMatterNo: c.firmMatterNo || '',
    plaintiffAttorney: (c.opposing && c.opposing.counsel) || '', plaintiffFirm: (c.opposing && c.opposing.counselFirm) || '',
    lossDate: ymd(lc.lossDate), fnolDate: ymd(c.fnolDate), coverageDate: ymd(lc.coverageDate), holdDate: ymd(lc.holdDate), claimantAttorneyDate: ymd(c.repDate),
    defenseAssignedDate: ymd(lc.counselAssignedDate), filedDate: ymd(c.filed), servedDate: ymd(lc.servedDate), answerDue: ymd(kd.answerDue),
    firstReportDate: ymd(lc.firstReportDate), reserveSetDate: ymd(lc.reserveSetDate), resolutionDate: ymd(cl.dispositionDate),
    reserveAmount: num(c.insurance && c.insurance.reserveAmount), value: num(c.value), likelyExposure: num(ex.likelyExposure), demandAmount: num(ex.demandAmount),
    defenseBudget: num(bl.budget), defenseBilled: num(bl.totalBilled), defensePaid: num(bl.totalPaid),
    trialDate: ymd(kd.trialDate), mediationDate: ymd(kd.mediationDate), dispositionType: cl.dispositionType || '', indemnityPaid: num(cl.finalIndemnityPaid),
    nextStep: String(c.nextStep || '').slice(0, 300), riskScore: risk ? risk.score : '', riskLevel: risk ? risk.level : '',
    updatedAt: c._updatedAt instanceof Date ? c._updatedAt.toISOString() : String(c._updatedAt || '')
  };
}
const csvCell = v => {
  let s = v == null ? '' : String(v);
  // Stop a spreadsheet from running a cell that starts like a formula.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(rows) {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map(k => csvCell(r[k])).join(','));
  return lines.join('\r\n') + '\r\n';
}
// A cursor is the newest updated_at (ISO text) the caller has seen. Anything that does not parse means "from the start".
export function cleanCursor(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const t = Date.parse(s);
  return isFinite(t) ? new Date(t).toISOString() : null;
}
