const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../utils/db');
const { evidenceHash, loadFullCase, ATTACH_DIR } = require('./cases');
const { createZip } = require('../utils/zip');

const router = express.Router();

const REPORTING_LINKS = [
  ['NCMEC CyberTipline (for child exploitation / CSAM)', 'https://report.cybertip.org   |   1-800-843-5678'],
  ['FBI — tips.fbi.gov or IC3', 'https://tips.fbi.gov   |   https://www.ic3.gov'],
  ['ICAC Task Force', 'https://www.icactaskforce.org'],
  ['Local law enforcement', ''],
];

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// GET /api/reports/:case_id — referral report. ?format=text|json|html
router.get('/:case_id', (req, res) => {
  const full = loadFullCase(req.params.case_id);
  if (!full) return res.status(404).json({ error: 'Case not found' });

  const format = req.query.format || 'text';
  if (format === 'json') return res.json(full);

  if (format === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(buildHtmlReport(full, (a) => `/api/cases/${full.case_.id}/attachments/${a.id}`));
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="case-${slug(full.case_.alias)}-report.txt"`
  );
  res.send(buildTextReport(full));
});

// GET /api/reports/:case_id/bundle — downloadable chain-of-custody ZIP:
// report.txt + report.html + manifest.json (with hashes) + every attachment.
router.get('/:case_id/bundle', (req, res) => {
  const full = loadFullCase(req.params.case_id);
  if (!full) return res.status(404).json({ error: 'Case not found' });
  const db = getDb();

  const files = [];

  // Attachments, copied into the bundle under stable relative paths.
  const attachRows = db
    .prepare('SELECT * FROM attachments WHERE case_id = ? ORDER BY added_at ASC')
    .all(full.case_.id);
  const relById = {};
  for (const a of attachRows) {
    const disk = path.join(ATTACH_DIR, full.case_.id, a.stored_path);
    if (!fs.existsSync(disk)) continue;
    const rel = `attachments/${a.id}-${a.filename}`;
    relById[a.id] = rel;
    files.push({ name: rel, data: fs.readFileSync(disk) });
  }

  // Reports. The HTML in the bundle references attachments by relative path.
  files.push({ name: 'report.txt', data: buildTextReport(full) });
  files.push({ name: 'report.html', data: buildHtmlReport(full, (a) => relById[a.id] || '#') });

  // Manifest: hash of every file + every evidence record, plus one overall
  // anchor hash so the whole package's integrity can be checked at a glance.
  const fileHashes = files
    .map((f) => ({
      name: f.name,
      size: Buffer.byteLength(f.data),
      sha256: crypto.createHash('sha256').update(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data)).digest('hex'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const evidenceHashes = full.evidence.map((e) => ({
    evidence_id: e.id, timestamp: e.timestamp, content_hash: e.content_hash,
    integrity_ok: e.integrity_ok,
  }));

  const anchorInput = JSON.stringify({ fileHashes, evidenceHashes });
  const manifest = {
    case_alias: full.case_.alias,
    case_id: full.case_.id,
    generated_at: new Date().toISOString(),
    lead_investigator: full.case_.lead_investigator || null,
    files: fileHashes,
    evidence: evidenceHashes,
    bundle_anchor_sha256: crypto.createHash('sha256').update(anchorInput).digest('hex'),
    note: 'Verify any file by re-hashing it with SHA-256 and comparing to the value above.',
  };
  files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

  const zip = createZip(files);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="case-${slug(full.case_.alias)}-bundle.zip"`);
  res.send(zip);
});

// ---------- text report ----------
function buildTextReport(full) {
  const { case_, suspects, evidence, lookups } = full;
  const lines = [];
  const line = (s = '') => lines.push(s);
  const sep = (c = '=', n = 64) => lines.push(c.repeat(n));

  sep();
  line('ONLINE PREDATOR INVESTIGATION — LAW ENFORCEMENT REFERRAL');
  sep();
  line(`Report Generated:   ${new Date().toISOString()}`);
  line(`Case Alias:         ${case_.alias}`);
  line(`Case Reference ID:  ${case_.id}`);
  line(`Case Status:        ${String(case_.status).toUpperCase()}`);
  line(`Lead Investigator:  ${case_.lead_investigator || '(not specified)'}`);
  line(`Date Opened:        ${case_.created_at}`);
  line(`Last Updated:       ${case_.updated_at}`);
  if (case_.notes) { line(); line('Case Background:'); wrap(case_.notes).forEach((l) => line('  ' + l)); }
  line();

  sep(); line('SUSPECT INFORMATION'); sep();
  if (!suspects.length) line('No suspect profiles recorded.');
  else suspects.forEach((s, i) => {
    line(`[Suspect ${i + 1}] ${s.display_name}`);
    if (s.known_usernames.length) line(`  Usernames:   ${s.known_usernames.join(', ')}`);
    if (s.known_emails.length)    line(`  Emails:      ${s.known_emails.join(', ')}`);
    if (s.known_phones.length)    line(`  Phone #s:    ${s.known_phones.join(', ')}`);
    if (s.platform_profiles.length) { line('  Platform Profiles:'); s.platform_profiles.forEach((p) => line(`    - ${p}`)); }
    if (s.notes) { line('  Notes:'); wrap(s.notes).forEach((l) => line('    ' + l)); }
    line();
  });

  sep(); line('USERNAME LOOKUP RESULTS'); sep();
  line('"FOUND" = verified via the platform\'s public API. "MANUAL CHECK" links');
  line('could not be auto-verified and MUST be confirmed visually before use.');
  line();
  if (!lookups.length) line('No username lookups recorded for this case.');
  else lookups.forEach((l) => {
    line(`Username: @${l.username}   (searched ${l.searched_at})`);
    const g = (st) => l.results.filter((r) => r.status === st);
    const found = g('FOUND'), manual = g('MANUAL CHECK'), notFound = g('NOT FOUND');
    const blocked = l.results.filter((r) => ['CHECK BLOCKED', 'ERROR', 'TIMEOUT'].includes(r.status));
    if (found.length) { line('  VERIFIED PROFILES:'); found.forEach((r) => line(`    [FOUND] ${r.platform}: ${r.url}`)); }
    else line('  VERIFIED PROFILES: none');
    if (manual.length) { line('  REQUIRES MANUAL VERIFICATION:'); manual.forEach((r) => line(`    [CHECK] ${r.platform}: ${r.url}`)); }
    if (blocked.length) { line('  COULD NOT DETERMINE (rate-limited / blocked):'); blocked.forEach((r) => line(`    [?] ${r.platform}: ${r.url}`)); }
    if (notFound.length) line(`  Confirmed absent on: ${notFound.map((r) => r.platform).join(', ')}`);
    line();
  });

  sep(); line('EVIDENCE LOG  (chronological, append-only)'); sep();
  line('Each entry carries a SHA-256 integrity hash computed at logging time.');
  line();
  if (!evidence.length) line('No evidence entries recorded.');
  else [...evidence].reverse().forEach((e, i) => {
    const ok = e.integrity_ok;
    const integrity = ok === null ? 'NOT HASHED' : ok ? 'VERIFIED (unaltered)' : '*** HASH MISMATCH — POSSIBLE TAMPERING ***';
    line(`[Evidence ${String(i + 1).padStart(3, '0')}]`);
    line(`  Type:           ${e.type}`);
    if (e.platform) line(`  Platform:       ${e.platform}`);
    line(`  Event Time:     ${e.timestamp}`);
    line(`  Logged At:      ${e.added_at}`);
    if (e.investigator) line(`  Collected By:   ${e.investigator}`);
    line(`  Integrity Hash: ${e.content_hash || '(none)'}`);
    line(`  Integrity:      ${integrity}`);
    line('  Content:');
    wrap(e.content, 70).forEach((l) => line('    | ' + l));
    if (e.attachments && e.attachments.length) {
      line('  Attachments:');
      e.attachments.forEach((a) => line(`    - ${a.filename} (${a.mime}, ${fmtBytes(a.size)})  SHA-256: ${a.sha256}`));
    }
    if (e.notes) { line('  Notes:'); wrap(e.notes).forEach((l) => line('    ' + l)); }
    line();
  });

  sep(); line('WHERE TO SUBMIT THIS REPORT'); sep();
  REPORTING_LINKS.forEach(([label, link], i) => { line(`${i + 1}. ${label}`); if (link) line(`     ${link}`); line(); });

  sep(); line('HANDLING NOTICE'); sep();
  line('- Do NOT download, save, or forward suspected child sexual abuse material.');
  line('  Report its location to NCMEC and let trained investigators handle it.');
  line('- Do not contact, confront, or publicly identify the suspect.');
  line('- Preserve originals; do not alter timestamps.');
  line();
  sep(); line('END OF REPORT'); sep();
  return lines.join('\n');
}

// ---------- html report (printable; pathFor maps an attachment to a URL/path) ----------
function buildHtmlReport(full, pathFor) {
  const { case_, suspects, evidence, lookups } = full;
  const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const suspectHtml = suspects.length
    ? suspects.map((s, i) => `
      <div class="suspect">
        <h3>Suspect ${i + 1}: ${h(s.display_name)}</h3>
        ${s.known_usernames.length ? `<p><b>Usernames:</b> ${h(s.known_usernames.join(', '))}</p>` : ''}
        ${s.known_emails.length ? `<p><b>Emails:</b> ${h(s.known_emails.join(', '))}</p>` : ''}
        ${s.known_phones.length ? `<p><b>Phones:</b> ${h(s.known_phones.join(', '))}</p>` : ''}
        ${s.platform_profiles.length ? `<p><b>Profiles:</b><br>${s.platform_profiles.map((p) => h(p)).join('<br>')}</p>` : ''}
        ${s.notes ? `<p><b>Notes:</b> ${h(s.notes)}</p>` : ''}
      </div>`).join('')
    : '<p class="muted">No suspect profiles recorded.</p>';

  const lookupHtml = lookups.length
    ? lookups.map((l) => {
        const row = (r) => `<tr class="st-${r.status.replace(/\s+/g, '-').toLowerCase()}">
          <td>${h(r.platform)}</td><td>${h(r.status)}</td>
          <td>${r.url ? `<a href="${h(r.url)}">${h(r.url)}</a>` : ''}</td></tr>`;
        return `<h3>@${h(l.username)} <span class="muted">(searched ${h(l.searched_at)})</span></h3>
          <table><thead><tr><th>Platform</th><th>Status</th><th>Link</th></tr></thead>
          <tbody>${l.results.slice().sort((a, b) => rank(a.status) - rank(b.status)).map(row).join('')}</tbody></table>`;
      }).join('')
    : '<p class="muted">No username lookups recorded.</p>';

  const evidenceHtml = evidence.length
    ? [...evidence].reverse().map((e, i) => {
        const badge = e.integrity_ok === false
          ? '<span class="bad">HASH MISMATCH — POSSIBLE TAMPERING</span>'
          : e.integrity_ok ? '<span class="ok">integrity verified</span>' : '<span class="muted">not hashed</span>';
        const atts = (e.attachments || []).map((a) => {
          const url = pathFor(a);
          const isImg = /^image\//.test(a.mime);
          return `<div class="att">
            ${isImg ? `<a href="${h(url)}"><img src="${h(url)}" alt="${h(a.filename)}"></a>` : ''}
            <div class="att-meta">${h(a.filename)} · ${h(a.mime)} · ${fmtBytes(a.size)}<br>
            <code>SHA-256: ${h(a.sha256)}</code> · <a href="${h(url)}">open</a></div>
          </div>`;
        }).join('');
        return `<div class="ev">
          <h3>Evidence ${i + 1}: ${h(e.type)} ${e.platform ? '· ' + h(e.platform) : ''} ${badge}</h3>
          <p class="muted">Event: ${h(e.timestamp)} · Logged: ${h(e.added_at)}${e.investigator ? ' · By: ' + h(e.investigator) : ''}</p>
          <pre>${h(e.content)}</pre>
          <p class="hash"><code>SHA-256: ${h(e.content_hash || '(none)')}</code></p>
          ${atts ? `<div class="atts">${atts}</div>` : ''}
          ${e.notes ? `<p><b>Notes:</b> ${h(e.notes)}</p>` : ''}
        </div>`;
      }).join('')
    : '<p class="muted">No evidence entries recorded.</p>';

  const reportLinks = REPORTING_LINKS.map(([l, link]) => `<li>${h(l)}${link ? `<br><code>${h(link)}</code>` : ''}</li>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Case ${h(case_.alias)} — Referral Report</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:860px;margin:2rem auto;padding:0 1.25rem;color:#111;line-height:1.5}
  h1{font-size:1.4rem;border-bottom:3px solid #111;padding-bottom:.4rem}
  h2{font-size:1.05rem;margin-top:2rem;background:#f0f0f0;padding:.4rem .6rem;border-left:4px solid #333}
  h3{font-size:.98rem;margin-bottom:.2rem}
  table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.85rem}
  th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left;word-break:break-all}
  th{background:#f5f5f5}
  pre{background:#f7f7f7;border:1px solid #ddd;padding:.6rem;white-space:pre-wrap;word-break:break-word;font-size:.85rem}
  code{font-size:.72rem;color:#444;word-break:break-all}
  .muted{color:#777}.ok{color:#127a3d;font-weight:700;font-size:.75rem}
  .bad{color:#b00;font-weight:700;font-size:.75rem}
  .meta td{border:none;padding:.1rem .5rem}
  .ev,.suspect{border:1px solid #e0e0e0;border-radius:6px;padding:.6rem .9rem;margin:.7rem 0}
  .st-found td{background:#eafaf0}.st-manual-check td{background:#fff7e6}
  .atts{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:.6rem}
  .att{max-width:240px;font-size:.7rem}.att img{max-width:240px;max-height:200px;border:1px solid #ccc;border-radius:4px}
  .att-meta{margin-top:.2rem}
  @media print{body{margin:0}h2{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>Online Predator Investigation — Law Enforcement Referral</h1>
<table class="meta">
  <tr><td><b>Case Alias</b></td><td>${h(case_.alias)}</td></tr>
  <tr><td><b>Case ID</b></td><td>${h(case_.id)}</td></tr>
  <tr><td><b>Status</b></td><td>${h(String(case_.status).toUpperCase())}</td></tr>
  <tr><td><b>Lead Investigator</b></td><td>${h(case_.lead_investigator || '(not specified)')}</td></tr>
  <tr><td><b>Opened</b></td><td>${h(case_.created_at)}</td></tr>
  <tr><td><b>Generated</b></td><td>${h(new Date().toISOString())}</td></tr>
</table>
${case_.notes ? `<p><b>Background:</b> ${h(case_.notes)}</p>` : ''}
<h2>Suspect Information</h2>${suspectHtml}
<h2>Username Lookup Results</h2>${lookupHtml}
<h2>Evidence Log</h2>${evidenceHtml}
<h2>Where to Submit</h2><ul>${reportLinks}</ul>
<h2>Handling Notice</h2>
<p>Do <b>not</b> download, save, or forward suspected child sexual abuse material — report its location to NCMEC. Do not contact, confront, or publicly identify the suspect. Preserve originals; do not alter timestamps.</p>
<p class="muted">Generated by muc.io. Use File → Print to save as PDF.</p>
</body></html>`;
}

function rank(s) {
  return s === 'FOUND' ? 0 : s === 'MANUAL CHECK' ? 1 : s === 'NOT FOUND' ? 3 : 2;
}

function slug(s) {
  return String(s).replace(/[^a-z0-9]+/gi, '_');
}

function wrap(text, width = 72) {
  const out = [];
  String(text).split('\n').forEach((para) => {
    let cur = '';
    para.split(/\s+/).forEach((word) => {
      if ((cur + ' ' + word).trim().length > width) { if (cur) out.push(cur); cur = word; }
      else cur = (cur ? cur + ' ' : '') + word;
    });
    out.push(cur);
  });
  return out;
}

// GET /api/reports/:case_id/briefing — a clean team briefing (not a formal LE
// report). Markdown-style plain text, easy to paste into a group chat or doc.
router.get('/:case_id/briefing', (req, res) => {
  const full = loadFullCase(req.params.case_id);
  if (!full) return res.status(404).json({ error: 'Case not found' });

  const { case_, suspects, evidence, lookups } = full;
  const lines = [];
  const line = (s = '') => lines.push(s);

  line(`# Investigation Briefing — ${case_.alias}`);
  line(`Generated: ${new Date().toISOString()}`);
  if (case_.lead_investigator) line(`Researcher: ${case_.lead_investigator}`);
  line();

  if (suspects.length) {
    line('## Suspect Profiles');
    suspects.forEach((s) => {
      line(`**${s.display_name}**`);
      if (s.known_usernames.length) line(`- Usernames: ${s.known_usernames.map((u) => '@' + u).join(', ')}`);
      if (s.known_emails.length)    line(`- Emails: ${s.known_emails.join(', ')}`);
      if (s.known_phones.length)    line(`- Phone numbers: ${s.known_phones.join(', ')}`);
      if (s.platform_profiles.length) { line('- Confirmed profiles:'); s.platform_profiles.forEach((p) => line(`  - ${p}`)); }
      if (s.notes) line(`- Notes: ${s.notes}`);
      line();
    });
  }

  if (lookups.length) {
    line('## Platform Lookups');
    lookups.forEach((l) => {
      const found = l.results.filter((r) => r.status === 'FOUND');
      const manual = l.results.filter((r) => r.status === 'MANUAL CHECK');
      line(`**@${l.username}** (searched ${l.searched_at})`);
      if (found.length) { line('Verified active:'); found.forEach((r) => line(`  ✓ ${r.platform}: ${r.url}`)); }
      if (manual.length) { line('Check manually:'); manual.forEach((r) => line(`  ? ${r.platform}: ${r.url}`)); }
      const absent = l.results.filter((r) => r.status === 'NOT FOUND').map((r) => r.platform);
      if (absent.length) line(`Not found on: ${absent.join(', ')}`);
      line();
    });
  }

  if (evidence.length) {
    line('## Evidence Notes');
    [...evidence].reverse().forEach((e, i) => {
      line(`### ${i + 1}. ${e.type}${e.platform ? ' · ' + e.platform : ''} — ${e.timestamp}`);
      line(e.content);
      if (e.attachments && e.attachments.length) line(`_${e.attachments.length} attachment(s) — see full bundle_`);
      if (e.notes) line(`_Note: ${e.notes}_`);
      line();
    });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug(case_.alias)}-briefing.txt"`);
  res.send(lines.join('\n'));
});

module.exports = router;
