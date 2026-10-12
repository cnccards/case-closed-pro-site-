// ---------------------------------------------------------------
// EMAIL-IN. Forward or copy an email to a matter's own address and it lands on the matter: the message as a
// private note, and its attachments as files. Works with an inbound-email provider that posts JSON
// (Postmark's inbound webhook format). Pure helpers; server.js owns the route and the database.
//
// Address:  m-<org id, 32 hex>-<12 hex>@<INBOUND_EMAIL_DOMAIN>
// Safety:   the webhook needs a shared secret; the sender must be someone we know (a user, approved counsel,
//           or the matter's counsel); and the provider must report SPF or DKIM pass, so a forged "From" is dropped.
// ---------------------------------------------------------------
import crypto from 'crypto';
export const ADDRESS_RE = /^m-([0-9a-f]{32})-([0-9a-f]{12})$/i;
export function newToken() { return crypto.randomBytes(6).toString('hex'); }
export function addressFor(orgId, token, domain) { return 'm-' + String(orgId).replace(/-/g, '').toLowerCase() + '-' + token + '@' + domain; }
export function parseAddress(addr) {
  const local = String(addr || '').trim().toLowerCase().replace(/^.*</, '').replace(/>.*$/, '').split('@')[0];
  const m = ADDRESS_RE.exec(local); if (!m) return null;
  const h = m[1]; return { orgId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, token: m[2].toLowerCase() };
}
// Constant-time check of the shared secret from ?key= or the Basic-auth password.
export function secretOk(secret, req) {
  if (!secret || String(secret).length < 16) return false;
  let given = String((req.query && req.query.key) || '');
  const auth = String((req.headers && req.headers.authorization) || '');
  if (!given && /^Basic /i.test(auth)) { const dec = Buffer.from(auth.slice(6), 'base64').toString(); given = dec.slice(dec.indexOf(':') + 1); }
  const a = Buffer.from(given), b = Buffer.from(String(secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const hdr = (p, name) => { const h = (p.Headers || []).find(x => String(x.Name).toLowerCase() === name); return h ? String(h.Value) : ''; };
// -> { messageId, from:{email,name}, to:[emails], subject, text, spfPass, dkimPass, attachments:[{name,mime,buf}] }
export function parseInbound(p) {
  if (!p || typeof p !== 'object') return null;
  const from = { email: String((p.FromFull && p.FromFull.Email) || p.From || '').toLowerCase().replace(/^.*</, '').replace(/>.*$/, '').trim(), name: String((p.FromFull && p.FromFull.Name) || '').trim() };
  const to = [].concat((p.ToFull || []).map(x => x.Email), (p.CcFull || []).map(x => x.Email), (p.BccFull || []).map(x => x.Email), p.OriginalRecipient ? [p.OriginalRecipient] : []).filter(Boolean).map(x => String(x).toLowerCase());
  let text = String(p.StrippedTextReply || p.TextBody || '').trim();
  if (!text && p.HtmlBody) text = String(p.HtmlBody).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  const spf = hdr(p, 'received-spf'), auth = hdr(p, 'authentication-results');
  return {
    messageId: String(p.MessageID || hdr(p, 'message-id') || '').slice(0, 200), from, to, subject: String(p.Subject || '(no subject)').slice(0, 200), text,
    spfPass: /^pass\b/i.test(spf.trim()) || /spf=pass/i.test(auth), dkimPass: /dkim=pass/i.test(auth),
    attachments: (p.Attachments || []).slice(0, 15).map(a => ({ name: String(a.Name || 'attachment'), mime: String(a.ContentType || ''), buf: Buffer.from(String(a.Content || ''), 'base64') })).filter(a => a.buf.length)
  };
}
export function senderVerified(m, allowUnverified) { return !!allowUnverified || m.spfPass || m.dkimPass; }
export function noteText(m, skipped) {
  const body = m.text.length > 4000 ? m.text.slice(0, 4000) + '\n[shortened]' : m.text;
  return 'Email from ' + (m.from.name ? m.from.name + ' <' + m.from.email + '>' : m.from.email) + ' — ' + m.subject + '\n\n' + body + (skipped && skipped.length ? '\n\nNot saved: ' + skipped.join('; ') : '');
}
