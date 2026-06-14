const express = require('express');
const { getDb } = require('../utils/db');

const router = express.Router();

// GET /api/reports/:case_id — generate a plain-text law enforcement referral report
router.get('/:case_id', (req, res) => {
  const db = getDb();
  const case_ = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.case_id);
  if (!case_) return res.status(404).json({ error: 'Case not found' });

  const suspects = db.prepare('SELECT * FROM suspects WHERE case_id = ?').all(req.params.case_id);
  const evidence = db.prepare('SELECT * FROM evidence WHERE case_id = ? ORDER BY timestamp ASC').all(req.params.case_id);
  const lookups = db.prepare('SELECT * FROM lookup_results WHERE case_id = ? ORDER BY searched_at ASC').all(req.params.case_id);

  const parsedSuspects = suspects.map((s) => ({
    ...s,
    known_usernames: JSON.parse(s.known_usernames),
    known_emails: JSON.parse(s.known_emails),
    known_phones: JSON.parse(s.known_phones),
    platform_profiles: JSON.parse(s.platform_profiles),
  }));

  const parsedLookups = lookups.map((l) => ({ ...l, results: JSON.parse(l.results) }));

  const format = req.query.format || 'text';

  if (format === 'json') {
    return res.json({ case_, suspects: parsedSuspects, evidence, lookups: parsedLookups });
  }

  // Build plain text report
  const lines = [];
  const line = (s = '') => lines.push(s);
  const sep = (c = '=', n = 60) => lines.push(c.repeat(n));

  sep();
  line('ONLINE PREDATOR INVESTIGATION REPORT');
  sep();
  line(`Generated:      ${new Date().toISOString()}`);
  line(`Case Alias:     ${case_.alias}`);
  line(`Case ID:        ${case_.id}`);
  line(`Case Status:    ${case_.status.toUpperCase()}`);
  line(`Date Opened:    ${case_.created_at}`);
  line(`Last Updated:   ${case_.updated_at}`);
  if (case_.notes) { line(); line('Case Notes:'); line(case_.notes); }
  line();

  sep();
  line('SUSPECT INFORMATION');
  sep();
  if (parsedSuspects.length === 0) {
    line('No suspect profiles recorded.');
  } else {
    parsedSuspects.forEach((s, i) => {
      line(`[Suspect ${i + 1}] ${s.display_name}`);
      if (s.known_usernames.length) line(`  Usernames:   ${s.known_usernames.join(', ')}`);
      if (s.known_emails.length)    line(`  Emails:      ${s.known_emails.join(', ')}`);
      if (s.known_phones.length)    line(`  Phone #s:    ${s.known_phones.join(', ')}`);
      if (s.platform_profiles.length) {
        line('  Platform Profiles:');
        s.platform_profiles.forEach((p) => line(`    - ${p}`));
      }
      if (s.notes) { line(`  Notes: ${s.notes}`); }
      line();
    });
  }

  sep();
  line('USERNAME LOOKUP RESULTS');
  sep();
  if (parsedLookups.length === 0) {
    line('No username lookups recorded for this case.');
  } else {
    parsedLookups.forEach((l) => {
      line(`Username: @${l.username}  (searched ${l.searched_at})`);
      const found = l.results.filter((r) => r.found);
      if (found.length === 0) {
        line('  No active profiles found on checked platforms.');
      } else {
        found.forEach((r) => line(`  [FOUND] ${r.platform}: ${r.url}`));
      }
      const notFound = l.results.filter((r) => !r.found && r.status === 'NOT FOUND');
      line(`  Not found on: ${notFound.map((r) => r.platform).join(', ')}`);
      line();
    });
  }

  sep();
  line('EVIDENCE LOG');
  sep();
  if (evidence.length === 0) {
    line('No evidence entries recorded.');
  } else {
    evidence.forEach((e, i) => {
      line(`[Evidence ${i + 1}]`);
      line(`  Type:      ${e.type}`);
      if (e.platform) line(`  Platform:  ${e.platform}`);
      line(`  Timestamp: ${e.timestamp}`);
      line(`  Logged:    ${e.added_at}`);
      line(`  Content:`);
      e.content.split('\n').forEach((ln) => line(`    ${ln}`));
      if (e.notes) line(`  Notes: ${e.notes}`);
      line();
    });
  }

  sep();
  line('REPORTING RESOURCES');
  sep();
  line('Submit this report to one or more of the following agencies:');
  line();
  line('1. NCMEC CyberTipline (mandatory for CSAM/grooming):');
  line('   https://www.missingkids.org/gethelpnow/cybertipline');
  line();
  line('2. FBI Internet Crime Complaint Center (IC3):');
  line('   https://www.ic3.gov');
  line();
  line('3. FBI Tips (online predator / child exploitation):');
  line('   https://tips.fbi.gov');
  line();
  line('4. Your local law enforcement agency');
  line();
  line('5. Internet Crimes Against Children (ICAC) Task Force:');
  line('   https://www.icactaskforce.org');
  line();
  sep();
  line('END OF REPORT');
  sep();

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="case-${case_.alias.replace(/\s+/g, '_')}-report.txt"`);
  res.send(lines.join('\n'));
});

module.exports = router;
