// ---------------------------------------------------------------
// CLAIM FEED. Pure functions (no database, no express) that turn rows sent by a
// customer's claims system (JSON or CSV) into a case update. server.js owns the
// routes, keys and database work; this file owns the field names and the rules.
//
// Rules:
//  * claimNo is the key. A row with a claimNo we already have updates that matter;
//    otherwise it creates one (client is then required).
//  * Only fields that are present and non-blank are applied. A blank never erases
//    something already in the app. Sending the same row twice changes nothing.
//  * Dates may be YYYY-MM-DD or MM/DD/YYYY. Money may contain $ and commas.
// ---------------------------------------------------------------

export const FEED_MAX_ROWS = 2000;

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// field -> accepted header spellings (all compared after norm())
export const FEED_FIELDS = [
  // key, label, kind, example, where it shows, aliases
  { key: 'claimNo', kind: 'text', req: 'Always', ex: 'CLM-2026-004417', where: 'Claim number on the matter. Used to match the same claim next time.', alias: ['claimnumber', 'claimno', 'claim', 'claimid', 'claimref'] },
  { key: 'client', kind: 'text', req: 'New claims only', ex: 'Acme Logistics LLC', where: 'Insured / client name.', alias: ['insured', 'insuredname', 'clientname', 'policyholder', 'defendant'] },
  { key: 'type', kind: 'text', req: 'No', ex: 'Auto Liability', where: 'Matter type.', alias: ['mattertype', 'claimtype', 'linetype', 'coverageline', 'lob'] },
  { key: 'status', kind: 'text', req: 'No', ex: 'Active', where: 'Matter status.', alias: ['claimstatus', 'matterstatus'] },
  { key: 'litigationStage', kind: 'text', req: 'No', ex: 'Pre-Suit', where: 'Litigation stage.', alias: ['stage', 'litstage', 'litigationstatus'] },
  { key: 'carrier', kind: 'text', req: 'No', ex: 'Hartford', where: 'Carrier on the matter.', alias: ['insurer', 'carriername'] },
  { key: 'account', kind: 'text', req: 'No', ex: 'Hartford claims', where: 'Client account (reports can be filtered by it).', alias: ['clientaccount', 'accountname', 'program', 'customeraccount'] },
  { key: 'state', kind: 'text', req: 'No', ex: 'TX or Texas', where: 'State of venue (used by lifecycle-by-area reports and Sentinel Match).', alias: ['venuestate', 'jurisdiction', 'lossstate', 'stateofvenue'] },
  { key: 'adjuster', kind: 'text', req: 'No', ex: 'Dana Whitfield', where: 'Claims adjuster.', alias: ['adjustername', 'primaryadjuster', 'examiner', 'claimsadjuster', 'handler'] },
  { key: 'backupAdjuster', kind: 'text', req: 'No', ex: 'Luis Ortega', where: 'Backup adjuster.', alias: ['backupadjustername', 'secondaryadjuster'] },
  { key: 'defenseFirm', kind: 'text', req: 'No', ex: 'Calloway & Pierce LLP', where: 'Defense firm assigned.', alias: ['defensecounselfirm', 'panelfirm', 'defenselawfirm'] },
  { key: 'defenseCounsel', kind: 'text', req: 'No', ex: 'Ryan Kessler', where: 'Defense attorney assigned.', alias: ['defenseattorney', 'defensecounselname', 'assignedcounsel', 'panelcounsel'] },
  { key: 'firmMatterNo', kind: 'text', req: 'No', ex: 'CP-22-0318', where: 'The defense firm’s own file number.', alias: ['defensefilenumber', 'firmfileno', 'firmfile', 'counselfileno'] },
  { key: 'plaintiffAttorney', kind: 'text', req: 'No', ex: 'Marcus Doyle', where: 'Claimant’s lawyer.', alias: ['claimantattorney', 'plaintiffcounsel', 'claimantcounsel', 'opposingcounsel'] },
  { key: 'plaintiffFirm', kind: 'text', req: 'No', ex: 'Doyle Injury Group', where: 'Claimant’s law firm.', alias: ['claimantfirm', 'plaintifflawfirm', 'opposingfirm'] },
  { key: 'lossDate', kind: 'date', req: 'No', ex: '2026-02-14', where: 'Lifecycle: date of loss.', alias: ['dateofloss', 'dol', 'lossdt'] },
  { key: 'fnolDate', kind: 'date', req: 'No', ex: '2026-02-16', where: 'Lifecycle: first notice of loss. Start of the FNOL-to-attorney reports.', alias: ['fnol', 'reporteddate', 'datereported', 'firstnotice', 'firstnoticeofloss', 'fnoldt', 'reportdate'] },
  { key: 'coverageDate', kind: 'date', req: 'No', ex: '2026-03-05', where: 'Lifecycle: coverage position sent.', alias: ['coverageposition', 'coveragepositiondate', 'rordate', 'coveragedecisiondate'] },
  { key: 'holdDate', kind: 'date', req: 'No', ex: '2026-02-20', where: 'Lifecycle: litigation hold sent.', alias: ['litigationholddate', 'lhdate'] },
  { key: 'claimantAttorneyDate', kind: 'date', req: 'No', ex: '2026-03-10', where: 'Lifecycle: claimant attorney retained (the date the claimant’s lawyer first appeared).', alias: ['repdate', 'claimantattorneyretained', 'claimantattorneyretaineddate', 'claimantrepresented', 'dateofrepresentation', 'attorneyretained', 'attorneyretaineddate', 'letterofrepresentation', 'lordate', 'repdt'] },
  { key: 'defenseAssignedDate', kind: 'date', req: 'No', ex: '2026-04-02', where: 'Lifecycle: defense counsel assigned. End of the FNOL-to-attorney reports.', alias: ['counselassigned', 'counselassigneddate', 'defenseassigned', 'assigneddate', 'defenseassignmentdate', 'dateassigned'] },
  { key: 'filedDate', kind: 'date', req: 'No', ex: '2026-04-20', where: 'Lifecycle: suit filed.', alias: ['filed', 'suitfiled', 'suitfileddate', 'datefiled', 'complaintfiled'] },
  { key: 'servedDate', kind: 'date', req: 'No', ex: '2026-04-28', where: 'Lifecycle: suit served.', alias: ['served', 'dateserved', 'servicedate', 'suitserved'] },
  { key: 'answerDue', kind: 'date', req: 'No', ex: '2026-05-28', where: 'Lifecycle: answer due.', alias: ['answerduedate', 'responsedue'] },
  { key: 'firstReportDate', kind: 'date', req: 'No', ex: '2026-05-10', where: 'Lifecycle: first counsel report received.', alias: ['firstcounselreport', 'initialreportdate'] },
  { key: 'reserveSetDate', kind: 'date', req: 'No', ex: '2026-02-18', where: 'Lifecycle: initial reserve set.', alias: ['initialreservedate', 'reservedate'] },
  { key: 'resolutionDate', kind: 'date', req: 'No', ex: '2026-09-30', where: 'Lifecycle: resolved (settled or dismissed).', alias: ['resolved', 'closeddate', 'dispositiondate', 'dateclosed', 'closedate'] },
  { key: 'reserveAmount', kind: 'money', req: 'No', ex: '125000', where: 'Current reserve.', alias: ['reserve', 'totalreserve', 'indemnityreserve', 'currentreserve'] },
  { key: 'value', kind: 'money', req: 'No', ex: '90000', where: 'Case value / exposure.', alias: ['exposure', 'casevalue', 'incurred', 'totalincurred'] }
];

const ALIAS = new Map();
for (const f of FEED_FIELDS) { ALIAS.set(norm(f.key), f); for (const a of f.alias) ALIAS.set(norm(a), f); }

// ---------- CSV ----------
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row); }
  if (rows.length < 2) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { if (h) o[h] = r[i] == null ? '' : r[i]; }); return o; });
}

// ---------- values ----------
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
export function stateName(v) {
  const t = String(v || '').trim().replace(/^State\s*-\s*/i, '');
  if (!t) return '';
  const up = t.toUpperCase();
  if (STATES[up]) return STATES[up];
  const hit = Object.values(STATES).find(n => n.toLowerCase() === t.toLowerCase());
  if (hit) return hit;
  throw new Error(`state "${v}" is not a U.S. state (use the name or 2-letter code)`);
}
export function feedDate(v, field) {
  const str = String(v).trim();
  let y, m, d;
  let x = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s.*)?$/))) { m = +x[1]; d = +x[2]; y = x[3].length === 2 ? 2000 + +x[3] : +x[3]; }
  else throw new Error(`${field} "${v}" is not a date (use YYYY-MM-DD or MM/DD/YYYY)`);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) throw new Error(`${field} "${v}" is not a real date`);
  return dt.toISOString().slice(0, 10);
}
export function feedMoney(v, field) {
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} "${v}" is not a dollar amount`);
  return n;
}
const clean = (v, n = 200) => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

// ---------- one row -> normalized fields ----------
// Returns { fields: {key: value}, unknown: [headers we did not recognise] }. Throws on a bad value.
export function normalizeRow(raw) {
  const fields = {}, unknown = [];
  for (const [k, v] of Object.entries(raw || {})) {
    const f = ALIAS.get(norm(k));
    if (!f) { unknown.push(k); continue; }
    if (v === null || v === undefined || String(v).trim() === '') continue; // blanks never erase
    if (typeof v === 'object') throw new Error(`${k} must be a single value`);
    if (f.kind === 'date') fields[f.key] = feedDate(v, f.key);
    else if (f.kind === 'money') fields[f.key] = feedMoney(v, f.key);
    else if (f.key === 'state') fields[f.key] = stateName(v);
    else fields[f.key] = clean(v, f.key === 'claimNo' ? 80 : 200);
  }
  if (!fields.claimNo) throw new Error('claimNo is required');
  return { fields, unknown };
}

// ---------- apply to a case ----------
// cur = { client, type, status, litigation_stage, carrier, reserve_amount, filed_date, value, data } for an
// existing matter, or null for a new one. Returns { cols: {column: value}, data, changed: [field names], isNew }.
const COL = { client: 'client', type: 'type', status: 'status', litigationStage: 'litigation_stage', carrier: 'carrier', reserveAmount: 'reserve_amount', value: 'value', filedDate: 'filed_date' };
export function applyFields(cur, f, baseData) {
  const isNew = !cur;
  const data = JSON.parse(JSON.stringify(isNew ? baseData : (cur.data || {})));
  const cols = {}, changed = [];
  const setCol = (key, val) => {
    const c = COL[key];
    const was = cur ? cur[c] : null;
    const same = was != null && (key === 'filedDate' ? (was instanceof Date ? was.getFullYear() + '-' + String(was.getMonth() + 1).padStart(2, '0') + '-' + String(was.getDate()).padStart(2, '0') : String(was).slice(0, 10)) === val : (typeof val === 'number' ? Number(was) === val : String(was) === val));
    if (!same) { cols[c] = val; changed.push(key); }
  };
  const setData = (obj, k, val, name) => { if (obj[k] !== val) { obj[k] = val; changed.push(name || k); } };
  for (const [key, val] of Object.entries(f)) {
    if (key === 'claimNo') continue;
    if (COL[key]) { setCol(key, val); continue; }
    switch (key) {
      case 'account': setData(data, 'clientAccount', val, key); break;
      case 'adjuster': setData(data, 'adjusterPrimary', val, key); break;
      case 'backupAdjuster': setData(data, 'adjusterBackup', val, key); break;
      case 'firmMatterNo': setData(data, 'firmMatterNo', val, key); break;
      case 'fnolDate': setData(data, 'fnolDate', val, key); break;
      case 'claimantAttorneyDate': setData(data, 'repDate', val, key); break;
      case 'state': { data.court = data.court || {}; setData(data.court, 'jurisdiction', 'State - ' + val, key); break; }
      case 'plaintiffAttorney': { data.opposing = data.opposing || {}; setData(data.opposing, 'counsel', val, key); break; }
      case 'plaintiffFirm': { data.opposing = data.opposing || {}; setData(data.opposing, 'counselFirm', val, key); break; }
      case 'answerDue': { data.keyDates = data.keyDates || {}; setData(data.keyDates, 'answerDue', val, key); break; }
      case 'resolutionDate': { data.closing = data.closing || {}; setData(data.closing, 'dispositionDate', val, key); break; }
      case 'defenseCounsel': case 'defenseFirm': {
        const dc = data.defenseCounsel && typeof data.defenseCounsel === 'object' ? data.defenseCounsel : { panelId: '', name: '', firm: '', email: '', phone: '' };
        setData(dc, key === 'defenseCounsel' ? 'name' : 'firm', val, key); data.defenseCounsel = dc; break;
      }
      case 'defenseAssignedDate': { data.lifecycle = data.lifecycle || {}; setData(data.lifecycle, 'counselAssignedDate', val, key); break; }
      case 'lossDate': case 'coverageDate': case 'holdDate': case 'servedDate': case 'firstReportDate': case 'reserveSetDate': {
        data.lifecycle = data.lifecycle || {}; setData(data.lifecycle, key, val, key); break;
      }
      default: break;
    }
  }
  return { cols, data, changed, isNew };
}

// ---------- body -> rows ----------
export function rowsFromBody(body, contentType) {
  if (typeof body === 'string') return parseCsv(body);
  if (body && Array.isArray(body.claims)) return body.claims;
  if (body && typeof body.csv === 'string') return parseCsv(body.csv);
  if (Array.isArray(body)) return body;
  return null;
}
