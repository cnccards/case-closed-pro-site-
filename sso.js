// ---------------------------------------------------------------
// SINGLE SIGN-ON (OpenID Connect). Pure helpers: no express, no database. server.js owns the
// routes and the user lookup; this file owns the protocol steps so they can be tested alone.
//
// Flow: authorization code with PKCE. The customer's identity provider (Okta, Microsoft Entra,
// Google Workspace, Ping and others that publish /.well-known/openid-configuration) signs the
// person in, including any multi-factor step it requires. We verify the signed ID token
// (RS256) against the provider's published keys, then match the email to an account.
// ---------------------------------------------------------------
import crypto from 'crypto';

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------- client secret at rest (AES-256-GCM, key derived from a server secret) ----------
export function encryptSecret(plain, secret) {
  const key = crypto.createHash('sha256').update('sso-secret|' + secret).digest();
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1.' + [iv, c.getAuthTag(), enc].map(b64u).join('.');
}
export function decryptSecret(blob, secret) {
  const p = String(blob || '').split('.');
  if (p[0] !== 'v1' || p.length !== 4) throw new Error('bad secret blob');
  const key = crypto.createHash('sha256').update('sso-secret|' + secret).digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p[1], 'base64url'));
  d.setAuthTag(Buffer.from(p[2], 'base64url'));
  return Buffer.concat([d.update(Buffer.from(p[3], 'base64url')), d.final()]).toString('utf8');
}

// ---------- input checks ----------
export function normDomains(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const out = [];
  for (let d of list) {
    d = String(d).trim().toLowerCase().replace(/^@/, '');
    if (!d) continue;
    if (!/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) throw new Error(`"${d}" is not a valid email domain (example: yourcompany.com)`);
    if (!out.includes(d)) out.push(d);
  }
  return out.slice(0, 20);
}
export function emailDomain(email) { const m = /^[^\s@]+@([^\s@]+)$/.exec(String(email || '').trim().toLowerCase()); return m ? m[1] : ''; }
// The provider address must be https and a public host name: never an IP address, localhost or an internal name.
export function checkIssuer(u) {
  let url; try { url = new URL(String(u || '').trim()); } catch (e) { throw new Error('Enter the provider address as a full https:// URL.'); }
  if (url.protocol !== 'https:') throw new Error('The provider address must start with https://');
  const h = url.hostname.toLowerCase();
  if (!h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) throw new Error('The provider address must be a public host name.');
  if (url.username || url.password || url.search || url.hash) throw new Error('The provider address must not include a login, query or fragment.');
  return url.origin + url.pathname.replace(/\/+$/, '');
}
function checkHttps(u, label) { const x = new URL(u); if (x.protocol !== 'https:') throw new Error(label + ' is not https'); return u; }

// ---------- discovery ----------
const discCache = new Map();
export async function discover(issuer, fetchFn = fetch) {
  const hit = discCache.get(issuer); if (hit && hit.exp > Date.now()) return hit.doc;
  const r = await fetchFn(issuer + '/.well-known/openid-configuration', { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('The identity provider did not return its settings (HTTP ' + r.status + ').');
  const doc = await r.json();
  if (!doc || String(doc.issuer || '').replace(/\/+$/, '') !== issuer) throw new Error('The provider address does not match the issuer the provider reports.');
  ['authorization_endpoint', 'token_endpoint', 'jwks_uri'].forEach(k => checkHttps(doc[k], k));
  discCache.set(issuer, { doc, exp: Date.now() + 10 * 60000 });
  return doc;
}

// ---------- PKCE and the sign-in request ----------
export function newLoginRequest() {
  const verifier = b64u(crypto.randomBytes(32));
  return { state: b64u(crypto.randomBytes(24)), nonce: b64u(crypto.randomBytes(24)), verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) };
}
export function buildAuthUrl(doc, { clientId, redirectUri, state, nonce, challenge, loginHint }) {
  const u = new URL(doc.authorization_endpoint);
  const p = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' };
  if (loginHint) p.login_hint = loginHint;
  Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
export async function exchangeCode(doc, { clientId, clientSecret, redirectUri, code, verifier }, fetchFn = fetch) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: verifier });
  const r = await fetchFn(doc.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error('The identity provider rejected the sign-in' + (j.error ? ' (' + String(j.error).slice(0, 60) + ')' : '') + '.');
  return j;
}

// ---------- ID token ----------
export async function verifyIdToken(idToken, doc, { issuer, clientId, nonce }, jwt, fetchFn = fetch) {
  const dec = jwt.decode(idToken, { complete: true });
  if (!dec || !dec.header || dec.header.alg !== 'RS256' || !dec.header.kid) throw new Error('The sign-in token is not in a supported format.');
  const r = await fetchFn(doc.jwks_uri, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Could not load the provider’s signing keys.');
  const jwk = ((await r.json()).keys || []).find(k => k.kid === dec.header.kid && k.kty === 'RSA');
  if (!jwk) throw new Error('The sign-in token was signed with an unknown key.');
  const pem = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
  let claims;
  try { claims = jwt.verify(idToken, pem, { algorithms: ['RS256'], audience: clientId, clockTolerance: 60 }); }
  catch (e) { throw new Error('The sign-in token could not be verified (' + e.message + ').'); }
  if (String(claims.iss || '').replace(/\/+$/, '') !== issuer && String(claims.iss || '').replace(/\/+$/, '') !== String(doc.issuer).replace(/\/+$/, '')) throw new Error('The sign-in token came from a different provider than the one set up.');
  if (!claims.nonce || claims.nonce !== nonce) throw new Error('The sign-in did not match the request that started it. Try again.');
  return claims;
}
// Email from the claims. Some providers (Microsoft Entra) leave "email" out and use preferred_username / upn.
export function emailFromClaims(c) {
  const cand = [c.email, c.preferred_username, c.upn].find(v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  if (!cand) throw new Error('The identity provider did not send an email address. Ask your administrator to include the email claim.');
  if (c.email_verified === false || c.email_verified === 'false') throw new Error('The identity provider says this email address is not verified.');
  return cand.trim().toLowerCase();
}
