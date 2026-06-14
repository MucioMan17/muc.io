const express = require('express');
const { getDb } = require('../utils/db');
const { evidenceHash } = require('./cases');

const router = express.Router();

const parseSuspect = (s) => ({
  ...s,
  known_usernames: JSON.parse(s.known_usernames),
  known_emails: JSON.parse(s.known_emails),
  known_phones: JSON.parse(s.known_phones),
  platform_profiles: JSON.parse(s.platform_profiles),
});

// GET /api/reports/:case_id — generate a law-enforcement referral report.
// ?format=json returns structured data; default is a printable plain-text doc.
router.get('/:case_id', (req, res) => {
  const db = getDb();
  const case_ = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.case_id);
  if (!case_) return res.status(404).json({ error: 'Case not found' });

  const suspects = db.prepare('SELECT * FROM suspects WHERE case_id = ?').all(req.params.case_id).map(parseSuspect);
  const evidence = db.prepare('SELECT * FROM evidence WHERE case_id = ? ORDER BY timestamp ASC').all(req.params.case_id);
  const lookups = db.prepare('SELECT * FROM lookup_results WHERE case_id = ? ORDER BY searched_at ASC')
    .all(req.params.case_id)
    .map((l) => ({ ...l, results: JSON.parse(l.results) }));

  if ((req.query.format || 'text') === 'json') {
    return res.json({ case_, suspects, evidence, lookups });
  }

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

  sep();
  line('SUSPECT INFORMATION');
  sep();
  if (!suspects.length) {
    line('No suspect profiles recorded.');
  } else {
    suspects.forEach((s, i) => {
      line(`[Suspect ${i + 1}] ${s.display_name}`);
      if (s.known_usernames.length) line(`  Usernames:   ${s.known_usernames.join(', ')}`);
      if (s.known_emails.length)    line(`  Emails:      ${s.known_emails.join(', ')}`);
      if (s.known_phones.length)    line(`  Phone #s:    ${s.known_phones.join(', ')}`);
      if (s.platform_profiles.length) {
        line('  Platform Profiles:');
        s.platform_profiles.forEach((p) => line(`    - ${p}`));
      }
      if (s.notes) { line('  Notes:'); wrap(s.notes).forEach((l) => line('    ' + l)); }
      line();
    });
  }

  sep();
  line('USERNAME LOOKUP RESULTS');
  sep();
  line('NOTE: "FOUND" results are verified via each platform\'s public API.');
  line('"MANUAL CHECK" links could not be auto-verified (login walls / anti-bot)');
  line('and MUST be confirmed visually before being treated as attributable.');
  line();
  if (!lookups.length) {
    line('No username lookups recorded for this case.');
  } else {
    lookups.forEach((l) => {
      line(`Username: @${l.username}   (searched ${l.searched_at})`);
      const found = l.results.filter((r) => r.status === 'FOUND');
      const manual = l.results.filter((r) => r.status === 'MANUAL CHECK');
      const notFound = l.results.filter((r) => r.status === 'NOT FOUND');
      const blocked = l.results.filter((r) => ['CHECK BLOCKED', 'ERROR', 'TIMEOUT'].includes(r.status));

      if (found.length) {
        line('  VERIFIED PROFILES:');
        found.forEach((r) => line(`    [FOUND] ${r.platform}: ${r.url}`));
      } else {
        line('  VERIFIED PROFILES: none');
      }
      if (manual.length) {
        line('  REQUIRES MANUAL VERIFICATION:');
        manual.forEach((r) => line(`    [CHECK] ${r.platform}: ${r.url}`));
      }
      if (blocked.length) {
        line('  COULD NOT DETERMINE (rate-limited / blocked — re-check by hand):');
        blocked.forEach((r) => line(`    [?] ${r.platform}: ${r.url}`));
      }
      if (notFound.length) {
        line(`  Confirmed absent on: ${notFound.map((r) => r.platform).join(', ')}`);
      }
      line();
    });
  }

  sep();
  line('EVIDENCE LOG  (chronological, append-only)');
  sep();
  line('Each entry carries a SHA-256 integrity hash computed at logging time.');
  line('A matching hash demonstrates the record is unaltered since collection.');
  line();
  if (!evidence.length) {
    line('No evidence entries recorded.');
  } else {
    evidence.forEach((e, i) => {
      const ok = e.content_hash ? e.content_hash === evidenceHash(e) : null;
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
      if (e.notes) { line('  Notes:'); wrap(e.notes).forEach((l) => line('    ' + l)); }
      line();
    });
  }

  sep();
  line('WHERE TO SUBMIT THIS REPORT');
  sep();
  line('1. NCMEC CyberTipline  — REQUIRED for any child sexual exploitation,');
  line('   grooming, or CSAM. Reportable 24/7:');
  line('     https://report.cybertip.org   |   1-800-843-5678');
  line();
  line('2. FBI — online predators / child exploitation:');
  line('     https://tips.fbi.gov   |   https://www.ic3.gov');
  line();
  line('3. ICAC Task Force (find your regional unit):');
  line('     https://www.icactaskforce.org');
  line();
  line('4. Your local police department / sheriff (non-emergency line),');
  line('   or 911 if a child is in immediate danger.');
  line();
  sep();
  line('HANDLING NOTICE');
  sep();
  line('- Do NOT download, save, or forward suspected child sexual abuse');
  line('  material. Report its location to NCMEC and let trained investigators');
  line('  handle it. Possessing it — even to "prove" a case — is a crime.');
  line('- Do not contact, confront, or publicly identify the suspect.');
  line('- Preserve original messages/URLs; do not alter timestamps.');
  line();
  sep();
  line('END OF REPORT');
  sep();

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="case-${String(case_.alias).replace(/[^a-z0-9]+/gi, '_')}-report.txt"`
  );
  res.send(lines.join('\n'));
});

// Soft-wrap long text so the plain-text report stays readable.
function wrap(text, width = 72) {
  const out = [];
  String(text).split('\n').forEach((para) => {
    let cur = '';
    para.split(/\s+/).forEach((word) => {
      if ((cur + ' ' + word).trim().length > width) {
        if (cur) out.push(cur);
        cur = word;
      } else {
        cur = (cur ? cur + ' ' : '') + word;
      }
    });
    out.push(cur);
  });
  return out;
}

module.exports = router;
