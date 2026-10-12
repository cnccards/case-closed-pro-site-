// ---------------------------------------------------------------
// SCHEDULES FOR RECURRING EMAILS. Pure date math: no database, no email, no clock of its own.
// server.js owns the sending; this file only answers "is this email due today?" and "when is
// the next one?". All dates are plain 'YYYY-MM-DD' strings in Eastern time (the server passes
// today's Eastern date in), so there is no time-zone arithmetic in here to get wrong.
//
// A schedule looks like:
//   { pattern: 'daily' | 'weekdays' | 'every_other_day' | 'days' | 'weekly' | 'biweekly' | 'monthly',
//     days:     ['Mon','Fri']            // pattern 'days': any mix of weekdays
//     weekday:  'Mon'                    // weekly, biweekly, and monthly 'first_weekday'
//     monthlyMode: 'day_of_month' | 'first_weekday' | 'last_business_day',
//     dayOfMonth: 1..28,                 // monthly 'day_of_month'
//     hour: 0..23,                       // Eastern; sends at the first check after this hour
//     start: 'YYYY-MM-DD' }              // first possible send; also anchors every-other-day / biweekly
//
// A server on a sleeping (free) plan can miss the exact day. So "due" means: the most recent
// day this schedule should have fired is later than the last day it actually sent, and that
// day is recent enough that sending it late still makes sense (see MAX_LATE).
// ---------------------------------------------------------------
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const PATTERNS = ['daily', 'weekdays', 'every_other_day', 'days', 'weekly', 'biweekly', 'monthly'];
export const MONTHLY_MODES = ['day_of_month', 'first_weekday', 'last_business_day'];
const LONG = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
// How many days late a missed send is still worth sending.
const MAX_LATE = { daily: 1, weekdays: 1, every_other_day: 1, days: 2, weekly: 3, biweekly: 4, monthly: 5 };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function parse(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) throw new Error('Bad date: ' + s);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error('Bad date: ' + s);
  return d;
}
export const fmt = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export const weekdayOf = s => WEEKDAYS[(parse(s).getUTCDay() + 6) % 7]; // Mon..Sun
const mondayOf = s => addDays(s, -((parse(s).getUTCDay() + 6) % 7));
const lastDayOfMonth = s => { const d = parse(s); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); };
const isBusinessDay = s => !['Sat', 'Sun'].includes(weekdayOf(s));

// Checks and cleans a schedule from the browser. Throws an Error with a plain-language message.
export function normalize(input, todayStr) {
  const s = input && typeof input === 'object' ? input : {};
  const pattern = PATTERNS.includes(s.pattern) ? s.pattern : null;
  if (!pattern) throw new Error('Pick how often this should go out.');
  const out = { pattern, hour: 7 };
  const hr = s.hour === undefined || s.hour === null || s.hour === '' ? 7 : Number(s.hour);
  if (!Number.isInteger(hr) || hr < 0 || hr > 23) throw new Error('Pick an hour between 12 AM and 11 PM.');
  out.hour = hr;
  if (pattern === 'days') {
    const days = Array.isArray(s.days) ? s.days.filter(d => WEEKDAYS.includes(d)) : [];
    const uniq = WEEKDAYS.filter(d => days.includes(d));
    if (!uniq.length) throw new Error('Pick at least one day of the week.');
    out.days = uniq;
  }
  if (pattern === 'weekly' || pattern === 'biweekly') {
    if (!WEEKDAYS.includes(s.weekday)) throw new Error('Pick the day of the week.');
    out.weekday = s.weekday;
  }
  if (pattern === 'monthly') {
    const mode = MONTHLY_MODES.includes(s.monthlyMode) ? s.monthlyMode : 'day_of_month';
    out.monthlyMode = mode;
    if (mode === 'day_of_month') {
      const dom = Number(s.dayOfMonth);
      if (!Number.isInteger(dom) || dom < 1 || dom > 28) throw new Error('Pick a day of the month between 1 and 28 (so every month has it).');
      out.dayOfMonth = dom;
    }
    if (mode === 'first_weekday') {
      if (!WEEKDAYS.includes(s.weekday)) throw new Error('Pick the day of the week.');
      out.weekday = s.weekday;
    }
  }
  const startRaw = s.start ? String(s.start).slice(0, 10) : todayStr;
  parse(startRaw); // throws on a bad date
  out.start = startRaw;
  return out;
}

// Does this schedule fire on this calendar day (ignoring the hour)?
export function fires(sch, day) {
  if (day < sch.start) return false;
  const wd = weekdayOf(day);
  switch (sch.pattern) {
    case 'daily': return true;
    case 'weekdays': return wd !== 'Sat' && wd !== 'Sun';
    case 'every_other_day': return daysBetween(sch.start, day) % 2 === 0;
    case 'days': return (sch.days || []).includes(wd);
    case 'weekly': return wd === sch.weekday;
    case 'biweekly': return wd === sch.weekday && Math.round(daysBetween(mondayOf(sch.start), mondayOf(day)) / 7) % 2 === 0;
    case 'monthly': {
      const dom = parseInt(day.slice(8), 10);
      if (sch.monthlyMode === 'first_weekday') return wd === sch.weekday && dom <= 7;
      if (sch.monthlyMode === 'last_business_day') {
        if (!isBusinessDay(day)) return false;
        for (let i = dom + 1; i <= lastDayOfMonth(day); i++) { if (isBusinessDay(day.slice(0, 8) + String(i).padStart(2, '0'))) return false; }
        return true;
      }
      return dom === Math.min(sch.dayOfMonth || 1, lastDayOfMonth(day));
    }
    default: return false;
  }
}

// The latest day on or before `today` this schedule fires, or null (searches back 70 days).
export function lastScheduledDay(sch, today) {
  for (let i = 0; i <= 70; i++) {
    const d = addDays(today, -i);
    if (d < sch.start) return null;
    if (fires(sch, d)) return d;
  }
  return null;
}

// Is a send due right now? lastSent is the Eastern date of the last send ('' if never).
// `hour` is the current Eastern hour. Never sends twice for the same scheduled day.
export function isDue(sch, lastSent, today, hour) {
  const due = lastScheduledDay(sch, today);
  if (!due) return false;
  if (lastSent && lastSent >= due) return false;
  if (due === today && hour < sch.hour) return false;
  return daysBetween(due, today) <= (MAX_LATE[sch.pattern] || 1);
}

// First scheduled day strictly after `afterDay` (searches ahead 400 days), or null.
export function nextScheduledDay(sch, afterDay) {
  for (let i = 1; i <= 400; i++) { const d = addDays(afterDay, i); if (fires(sch, d)) return d; }
  return null;
}
// The day the next email will go out, as seen from now: today if it is still ahead, else the next one.
export function nextSend(sch, lastSent, today, hour) {
  if (fires(sch, today) && lastSent !== today && hour < sch.hour) return today;
  if (isDue(sch, lastSent, today, hour)) return today; // overdue: goes out on the next check
  return nextScheduledDay(sch, today);
}

export function hourLabel(h) { const x = h % 12 || 12; return x + ':00 ' + (h < 12 ? 'AM' : 'PM') + ' ET'; }
const ORD = n => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
export function describe(sch) {
  const at = ' at ' + hourLabel(sch.hour);
  switch (sch.pattern) {
    case 'daily': return 'Every day' + at;
    case 'weekdays': return 'Every weekday (Mon-Fri)' + at;
    case 'every_other_day': return 'Every other day' + at;
    case 'days': { const n = sch.days.map(d => LONG[d]); return 'Every ' + (n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0]) + at; }
    case 'weekly': return 'Every ' + LONG[sch.weekday] + at;
    case 'biweekly': return 'Every other ' + LONG[sch.weekday] + at;
    case 'monthly':
      if (sch.monthlyMode === 'first_weekday') return 'First ' + LONG[sch.weekday] + ' of each month' + at;
      if (sch.monthlyMode === 'last_business_day') return 'Last business day of each month' + at;
      return 'The ' + ORD(sch.dayOfMonth) + ' of each month' + at;
    default: return '';
  }
}
