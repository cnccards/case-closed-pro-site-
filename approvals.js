// ---------------------------------------------------------------
// APPROVAL WORKFLOW for settlement authority and reserve changes. Pure functions; server.js feeds them the
// stored case and the incoming change, and applies the result.
//
// The policy (saved by the account owner) has levels by dollar amount. Each level names who may approve a
// request up to that amount. A level with no names means any owner or admin. Rules the server enforces
// when the policy is turned on:
//   - Only a named approver (or an owner) can approve or deny, and only up to their level.
//   - Nobody approves their own request.
//   - The server stamps who asked and who decided, and when. The browser cannot set those fields.
//   - A decided request cannot be edited or deleted afterwards.
//   - A reserve increase over the threshold must go through a reserve request.
// With the policy off, the server still stamps names and dates but blocks nothing.
// ---------------------------------------------------------------
export const DEFAULT_POLICY = { enabled: false, blockSelfApproval: true, reserveThreshold: 25000, levels: [] };
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const em = v => String(v || '').trim().toLowerCase();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function cleanPolicy(input) {
  const b = input && typeof input === 'object' ? input : {};
  const levels = (Array.isArray(b.levels) ? b.levels : []).slice(0, 6).map(l => ({
    name: String((l && l.name) || 'Level').trim().slice(0, 60) || 'Level',
    upTo: l && l.upTo != null && l.upTo !== '' && Number.isFinite(Number(l.upTo)) && Number(l.upTo) > 0 ? Math.round(Number(l.upTo)) : null,
    approvers: [...new Set((Array.isArray(l && l.approvers) ? l.approvers : String((l && l.approvers) || '').split(/[,;\s]+/)).map(em).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 20)
  }));
  levels.sort((a, b) => (a.upTo == null ? Infinity : a.upTo) - (b.upTo == null ? Infinity : b.upTo));
  // The last level must have no ceiling, so every amount lands somewhere.
  if (levels.length && levels[levels.length - 1].upTo != null) levels.push({ name: 'Above all limits', upTo: null, approvers: [] });
  return { enabled: !!b.enabled, blockSelfApproval: b.blockSelfApproval !== false, reserveThreshold: Math.max(0, Math.round(num(b.reserveThreshold))) || DEFAULT_POLICY.reserveThreshold, levels };
}
export function levelFor(policy, amount) {
  const a = num(amount), ls = (policy && policy.levels) || [];
  return ls.find(l => l.upTo == null || a <= l.upTo) || null;
}
const isOwner = u => !!u && (u.platformAdmin || u.role === 'owner');
const isAdmin = u => isOwner(u) || (u && u.role === 'admin');
// May this user decide a request for `amount` that `requestedBy` (email) asked for?
export function canDecide(policy, user, amount, requestedBy) {
  if (!user) return { ok: false, reason: 'Sign in again.' };
  const p = policy || DEFAULT_POLICY;
  if (p.blockSelfApproval && requestedBy && em(requestedBy) === em(user.email)) return { ok: false, reason: 'You cannot approve your own request. Someone else needs to decide it.' };
  const lv = levelFor(p, amount);
  if (!lv) return isAdmin(user) ? { ok: true } : { ok: false, reason: 'Only an owner or admin can decide this.' };
  if (isOwner(user)) return { ok: true, level: lv };
  if (lv.approvers.length) return lv.approvers.includes(em(user.email)) ? { ok: true, level: lv } : { ok: false, reason: money(amount) + ' needs ' + lv.name + ' approval (' + lv.approvers.join(', ') + ').' };
  return isAdmin(user) ? { ok: true, level: lv } : { ok: false, reason: money(amount) + ' needs ' + lv.name + ' approval from an owner or admin.' };
}
const stamp = (u, now) => ({ by: u.email || '', name: u.name || u.email || '', at: now });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// prev, next: the case's data object before and after the change. Returns { ok, error?, data, notices[], reserve? }.
// `reserve` is set when an approved reserve request means the server must write the new reserve amount.
export function reviewChange({ policy, prevData, nextData, prevReserve, nextReserve, user, now }) {
  const p = policy || DEFAULT_POLICY, out = { ok: true, data: { ...nextData }, notices: [], reserve: null, budget: null };
  const fail = e => ({ ok: false, error: 'Approval rule: ' + e });
  for (const kind of ['authority', 'reserve', 'budget']) {
    const key = kind === 'authority' ? 'authorityRequests' : kind === 'reserve' ? 'reserveRequests' : 'budgetRequests', amtKey = kind === 'authority' ? 'amountRequested' : 'to';
    const before = Array.isArray(prevData[key]) ? prevData[key] : [], after = Array.isArray(nextData[key]) ? nextData[key] : before;
    if (after.length < before.length) return fail('Requests cannot be deleted once they are on record.');
    const res = [];
    for (let i = 0; i < after.length; i++) {
      const a = { ...after[i] }, o = before[i];
      if (!o) { // new request
        a.status = 'Pending'; delete a.approvedBy; delete a.approvedByName; delete a.approvedAt; delete a.approvedDate; delete a.approvedAmount;
        const s = stamp(user, now); a.requestedBy = s.by; a.requestedByName = s.name; a.requestedAt = s.at;
        if (!(num(a[amtKey]) > 0)) return fail('A request needs an amount above zero.');
        out.notices.push({ type: 'requested', kind, request: a, level: levelFor(p, a[amtKey]) });
        res.push(a); continue;
      }
      // existing request: identity and amount fields are the server's, whatever the browser sent
      for (const f of ['requestedBy', 'requestedByName', 'requestedAt', amtKey, 'date', 'justification', 'from']) a[f] = o[f];
      if (o.status !== 'Pending') {
        // decided: frozen
        res.push({ ...o }); if (a.status !== o.status) return fail('That request was already ' + String(o.status).toLowerCase() + ' and cannot be changed.');
        continue;
      }
      if (a.status === 'Pending') { res.push({ ...o }); continue; }
      if (a.status !== 'Approved' && a.status !== 'Denied') return fail('A request can only be approved or denied.');
      if (p.enabled) { const d = canDecide(p, user, o[amtKey], o.requestedBy); if (!d.ok) return fail(d.reason); }
      else if (p.blockSelfApproval === false) { /* policy off: nothing blocked */ }
      const s = stamp(user, now);
      a.approvedBy = s.by; a.approvedByName = s.name; a.approvedAt = s.at; a.approvedDate = String(now).slice(0, 10);
      if (a.status === 'Approved') { a.approvedAmount = o[amtKey]; if (kind === 'reserve') out.reserve = num(o.to); if (kind === 'budget') out.budget = num(o.to); }
      out.notices.push({ type: a.status === 'Approved' ? 'approved' : 'denied', kind, request: a });
      res.push(a);
    }
    if (after.length || before.length) out.data[key] = res;
  }
  // Direct reserve edits above the threshold need a request, unless this user could approve that amount.
  if (p.enabled && nextReserve != null && num(nextReserve) > num(prevReserve) && !out.reserve) {
    const inc = num(nextReserve) - num(prevReserve);
    if (inc > num(p.reserveThreshold)) {
      const d = canDecide({ ...p, blockSelfApproval: false }, user, nextReserve, '');
      if (!d.ok) return fail('Raising the reserve by ' + money(inc) + ' needs approval. Send a reserve request instead. (' + d.reason + ')');
    }
  }
  if (out.reserve != null) {
    out.data.reserveHistory = [...(Array.isArray(out.data.reserveHistory) ? out.data.reserveHistory : []), { at: now, from: num(prevReserve), to: out.reserve, by: user.email || '' }].slice(-50);
  }
  if (out.budget != null) out.data.billing = { ...(out.data.billing || {}), budget: out.budget };
  return out;
}

// Email text for a notice. recipients are chosen by the caller.
export function noticeMessage(n, c, orgName, appUrl) {
  const r = n.request, what = n.kind === 'authority' ? 'settlement authority' : n.kind === 'budget' ? 'a revised defense budget' : 'a reserve change';
  const amt = n.kind === 'authority' ? r.amountRequested : r.to, tag = (c.matterNo || '') + ' ' + (c.client || '');
  const link = appUrl ? '\n\nOpen it: ' + appUrl.replace(/\/$/, '') + '/case-closed-pro.html' : '';
  if (n.type === 'requested') return { subject: 'Approval needed: ' + money(amt) + ' ' + what + ' on ' + tag.trim(), text: (r.requestedByName || r.requestedBy) + ' asked for ' + what + ' of ' + money(amt) + ' on ' + tag.trim() + '.\n' + (r.justification ? 'Reason: ' + r.justification + '\n' : '') + (n.level ? 'Level: ' + n.level.name + '\n' : '') + link };
  return { subject: (n.type === 'approved' ? 'Approved: ' : 'Denied: ') + money(amt) + ' ' + what + ' on ' + tag.trim(), text: (r.approvedByName || r.approvedBy) + ' ' + n.type + ' your request for ' + what + ' of ' + money(amt) + ' on ' + tag.trim() + '.' + link };
}
// Who gets the "approval needed" email: the level's named approvers, else the owners and admins.
export function approverEmails(policy, level, adminEmails) {
  const list = level && level.approvers && level.approvers.length ? level.approvers : adminEmails;
  return [...new Set(list.map(em).filter(Boolean))].slice(0, 20);
}
