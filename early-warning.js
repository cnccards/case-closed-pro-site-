// ---------------------------------------------------------------
// EARLY-WARNING SCORE. Looks at one open matter and says how likely it is to go wrong soon, with
// the reasons in plain words. It is a transparent checklist, not a prediction of the case outcome:
// every point comes from a stated rule below, so a person can always see why a matter scored what
// it did. The same file runs on the server (emails) and in the app (screens), so they always agree.
//
// Pure functions: no imports, no clock. Pass today's date as 'YYYY-MM-DD'.
// Mark: the app copies the block between the EW-BEGIN / EW-END lines into the page, so keep that
// block free of `export` and of anything that needs a module.
// ---------------------------------------------------------------
/*EW-BEGIN*/
const EW_VERSION = 1;
const EW_THRESHOLDS = { high: 60, watch: 35 };
function ewDays(a, b) {
  const x = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z'), y = Date.parse(String(b).slice(0, 10) + 'T00:00:00Z');
  return isFinite(x) && isFinite(y) ? Math.round((y - x) / 864e5) : null;
}
function ewMoney(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
// Returns { score: 0-100, level: 'high' | 'watch' | 'ok', reasons: [{ key, points, text }] } (reasons strongest first).
function earlyWarning(c, today) {
  const reasons = [];
  const add = (key, points, text) => { if (points > 0) reasons.push({ key, points, text }); };
  if (!c || c.status === 'Closed') return { score: 0, level: 'ok', reasons: [] };
  const kd = c.keyDates || {}, ex = c.exposure || {}, ins = c.insurance || {}, bl = c.billing || {}, lc = c.lifecycle || {};
  const reserve = Number(ins.reserveAmount != null ? ins.reserveAmount : c.reserve) || 0;
  const likely = Number(ex.likelyExposure) || 0;

  // 1. Time-limit demands that have not been answered (the most expensive thing to miss).
  let dm = null;
  (Array.isArray(c.timeLimitDemands) ? c.timeLimitDemands : []).forEach(d => {
    if (!d || d.status !== 'open') return;
    const left = ewDays(today, String(d.extendedDeadline || d.deadline || '').slice(0, 10));
    if (left === null) return;
    if (dm === null || left < dm) dm = left;
  });
  if (dm !== null) {
    if (dm < 0) add('demand', 40, 'A time-limit demand is ' + Math.abs(dm) + ' day' + (Math.abs(dm) === 1 ? '' : 's') + ' past its deadline with no response recorded');
    else if (dm <= 3) add('demand', 30, 'A time-limit demand is due ' + (dm === 0 ? 'today' : 'in ' + dm + ' day' + (dm === 1 ? '' : 's')));
    else if (dm <= 10) add('demand', 20, 'A time-limit demand is due in ' + dm + ' days');
  }

  // 2. Statute of limitations.
  if (kd.sol) {
    const left = ewDays(today, kd.sol);
    if (left !== null) {
      if (left < 0) add('sol', 20, 'The statute of limitations date has passed (' + String(kd.sol).slice(0, 10) + ')');
      else if (left <= 30) add('sol', 20, 'Statute of limitations in ' + left + ' days');
      else if (left <= 90) add('sol', 10, 'Statute of limitations in ' + left + ' days');
    }
  }

  // 3. Answer to the complaint due (or already late) with nobody responsible.
  if (kd.answerDue) {
    const left = ewDays(today, kd.answerDue);
    if (left !== null && left <= 7) add('answer', left < 0 ? 15 : 12, left < 0 ? 'The answer due date passed ' + Math.abs(left) + ' days ago' : 'The answer is due in ' + left + ' day' + (left === 1 ? '' : 's'));
  }

  // 4. Reserve against likely exposure.
  if (likely > 0) {
    if (reserve < likely * 0.5) add('reserve', 30, 'The reserve (' + ewMoney(reserve) + ') is under half of the likely exposure (' + ewMoney(likely) + ')');
    else if (reserve < likely * 0.8) add('reserve', 20, 'The reserve (' + ewMoney(reserve) + ') is below the likely exposure (' + ewMoney(likely) + ')');
  }
  const demandAmt = Number(ex.demandAmount) || 0;
  if (demandAmt > 0 && reserve > 0 && demandAmt > reserve) add('demandvsreserve', 10, 'The demand (' + ewMoney(demandAmt) + ') is above the reserve');

  // 5. Defense spend against budget.
  const budget = Number(bl.budget) || 0, billed = Number(bl.totalBilled) || 0;
  if (budget > 0) {
    const r = billed / budget;
    if (r >= 1) add('budget', 20, 'Defense spend (' + ewMoney(billed) + ') has passed the budget (' + ewMoney(budget) + ')');
    else if (r >= 0.85) add('budget', 12, 'Defense spend is at ' + Math.round(r * 100) + '% of the budget');
    else if (r >= 0.75) add('budget', 8, 'Defense spend is at ' + Math.round(r * 100) + '% of the budget');
  } else if (reserve > 0 && billed / reserve > 0.5) add('burn', 10, 'Defense spend is over half of the reserve and no budget is set');

  // 6. Trial coming up.
  if (kd.trialDate) {
    const left = ewDays(today, kd.trialDate);
    if (left !== null && left >= 0) {
      if (left <= 30) add('trial', 15, 'Trial in ' + left + ' days');
      else if (left <= 60) add('trial', 10, 'Trial in ' + left + ' days');
    }
  }

  // 7. Nothing has happened for a long time.
  let last = c.filed ? String(c.filed).slice(0, 10) : '';
  (c.updates || []).forEach(u => { const d = u && u.date ? String(u.date).slice(0, 10) : ''; if (d && d > last) last = d; });
  if (last) {
    const quiet = ewDays(last, today);
    if (quiet !== null) {
      if (quiet >= 90) add('stale', 15, 'No activity recorded in ' + quiet + ' days');
      else if (quiet >= 45) add('stale', 10, 'No activity recorded in ' + quiet + ' days');
    }
  }

  // 8. A request for settlement authority has been waiting.
  let oldest = null;
  (c.authorityRequests || []).forEach(a => {
    if (a && a.status === 'Pending' && a.date) { const age = ewDays(String(a.date).slice(0, 10), today); if (age !== null && (oldest === null || age > oldest)) oldest = age; }
  });
  if (oldest !== null) {
    if (oldest >= 30) add('authority', 15, 'A settlement authority request has waited ' + oldest + ' days');
    else if (oldest >= 14) add('authority', 10, 'A settlement authority request has waited ' + oldest + ' days');
  }

  // 9. Ownership and early lifecycle gaps.
  if (!(c.attorney || '').trim() || c.attorney === 'Unassigned') add('unassigned', 12, 'No defense attorney is assigned');
  if (lc.servedDate && !lc.counselAssignedDate) {
    const age = ewDays(lc.servedDate, today);
    if (age !== null && age >= 7) add('nocounsel', 15, 'The suit was served ' + age + ' days ago and no counsel assignment is recorded');
  }
  if (!c.nextStep) add('nostep', 4, 'No next step is recorded');

  // 10. Overdue tasks.
  const late = (c.tasks || []).filter(t => t && !t.done && t.due && String(t.due).slice(0, 10) < today).length;
  if (late >= 3) add('tasks', 10, late + ' tasks are overdue');
  else if (late >= 1) add('tasks', 6, late + (late === 1 ? ' task is' : ' tasks are') + ' overdue');

  // 11. Size of the downside.
  const worst = Number(ex.worstCase) || 0;
  if (worst >= 1000000) add('severity', 8, 'Worst-case exposure is ' + ewMoney(worst));

  reasons.sort((a, b) => b.points - a.points);
  const score = Math.min(100, reasons.reduce((t, r) => t + r.points, 0));
  return { score, level: score >= EW_THRESHOLDS.high ? 'high' : score >= EW_THRESHOLDS.watch ? 'watch' : 'ok', reasons };
}
/*EW-END*/
export { EW_VERSION, EW_THRESHOLDS, earlyWarning };
