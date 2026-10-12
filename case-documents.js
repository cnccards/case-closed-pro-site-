// ---------------------------------------------------------------
// REAL DOCUMENT STORAGE per matter. Files live in the database (bytea) so they are covered by the same
// backups and the same tenant isolation as everything else. Every open and download is logged.
// Pure helpers here (validation, names, headers); server.js owns the routes.
// ---------------------------------------------------------------
export const MAX_DOC_BYTES = 15 * 1024 * 1024;
export const ORG_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB per customer
export const DOC_TYPES = ['Pleading', 'Correspondence', 'Discovery', 'Medical', 'Expert', 'Policy', 'Invoice', 'Photo', 'Other'];

export const CASE_DOCUMENTS_DDL = [
  `CREATE TABLE IF NOT EXISTS case_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    name TEXT NOT NULL, mime TEXT NOT NULL, size_bytes INT NOT NULL, doc_type TEXT NOT NULL DEFAULT 'Other',
    source TEXT NOT NULL DEFAULT 'upload', content BYTEA NOT NULL,
    uploaded_by UUID, uploaded_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_case_documents_case ON case_documents(org_id, case_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS case_document_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES case_documents(id) ON DELETE CASCADE,
    user_id UUID, user_name TEXT, action TEXT NOT NULL DEFAULT 'download', at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_case_document_views_doc ON case_document_views(org_id, document_id, at DESC)`,
  ...['case_documents', 'case_document_views'].flatMap(t => [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${t}' AND policyname = '${t}_tenant_isolation') THEN
        CREATE POLICY ${t}_tenant_isolation ON ${t} USING (org_id = current_setting('app.current_org_id', true)::uuid);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${t}' AND policyname = '${t}_admin_bypass') THEN
        CREATE POLICY ${t}_admin_bypass ON ${t} FOR SELECT USING (current_setting('app.is_platform_admin', true) = 'true');
      END IF;
    END $$`
  ])
];

// Allowed kinds. Anything that can run script in a browser (html, svg, js) or on a machine (exe, zip) is refused.
const TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', rtf: 'application/rtf'
};
export const ALLOWED_EXT = Object.keys(TYPES);
export function extOf(name) { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
export function cleanName(name) {
  let n = String(name || '').replace(/[\\/\u0000-\u001f\u007f"<>|:*?]/g, '_').replace(/^\.+/, '').trim();
  if (n.length > 150) { const e = extOf(n); n = n.slice(0, 140) + (e ? '.' + e : ''); }
  return n || 'document';
}
const startsWith = (b, bytes) => bytes.every((v, i) => b[i] === v);
// Does the content look like what the extension claims? Stops "invoice.pdf" that is really something else.
export function looksLike(ext, b) {
  if (!b || !b.length) return false;
  switch (ext) {
    case 'pdf': return startsWith(b, [0x25, 0x50, 0x44, 0x46]);
    case 'png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpg': case 'jpeg': return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'gif': return startsWith(b, [0x47, 0x49, 0x46, 0x38]);
    case 'docx': case 'xlsx': case 'pptx': return startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
    case 'doc': case 'xls': case 'ppt': case 'msg': return startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]);
    case 'rtf': return startsWith(b, [0x7b, 0x5c, 0x72, 0x74, 0x66]);
    case 'txt': case 'csv': case 'eml': { const n = Math.min(b.length, 4096); for (let i = 0; i < n; i++) if (b[i] === 0) return false; return true; }
    default: return false;
  }
}
// -> { ok:true, name, mime, ext } | { ok:false, error }
export function validateUpload({ name, buf, usedBytes = 0 }) {
  const n = cleanName(name), ext = extOf(n);
  if (!buf || !buf.length) return { ok: false, error: 'The file is empty.' };
  if (!ALLOWED_EXT.includes(ext)) return { ok: false, error: 'That file type is not allowed. Use PDF, Word, Excel, PowerPoint, images, text, email (.eml/.msg) or RTF.' };
  if (buf.length > MAX_DOC_BYTES) return { ok: false, error: 'Files can be up to 15 MB. This one is ' + (buf.length / 1048576).toFixed(1) + ' MB.' };
  if (usedBytes + buf.length > ORG_QUOTA_BYTES) return { ok: false, error: 'Your storage is full (1 GB). Delete old files or ask us to raise the limit.' };
  if (!looksLike(ext, buf)) return { ok: false, error: 'The file contents do not match its ".' + ext + '" ending, so it was not saved.' };
  return { ok: true, name: n, ext, mime: TYPES[ext] };
}
// Inline only for formats a browser cannot run script from. Everything is nosniff and sandboxed.
export function deliveryHeaders(name, mime, inline) {
  const safe = cleanName(name).replace(/[^\x20-\x7e]/g, '_');
  const showInline = inline && (mime === 'application/pdf' || /^image\/(png|jpeg|gif)$/.test(mime));
  return {
    'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store',
    'Content-Disposition': (showInline ? 'inline' : 'attachment') + '; filename="' + safe + '"'
  };
}
