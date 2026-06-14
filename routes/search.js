const express = require('express');
const { getDb } = require('../utils/db');

const router = express.Router();

// GET /api/search?q=term — search across cases, suspects, and evidence.
// Returns lightweight hits, each pointing back to its case so the UI can open it.
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, hits: [] });

  const db = getDb();
  const like = `%${q}%`;
  const hits = [];

  db.prepare(
    `SELECT id, alias, status FROM cases
     WHERE alias LIKE ? OR notes LIKE ? OR lead_investigator LIKE ?`
  )
    .all(like, like, like)
    .forEach((c) =>
      hits.push({ type: 'case', case_id: c.id, case_alias: c.alias, label: c.alias, sub: `case · ${c.status}` })
    );

  db.prepare(
    `SELECT s.id, s.case_id, s.display_name, s.known_usernames, s.known_emails, s.known_phones, c.alias AS case_alias
     FROM suspects s JOIN cases c ON c.id = s.case_id
     WHERE s.display_name LIKE ? OR s.known_usernames LIKE ? OR s.known_emails LIKE ?
        OR s.known_phones LIKE ? OR s.platform_profiles LIKE ?`
  )
    .all(like, like, like, like, like)
    .forEach((s) =>
      hits.push({
        type: 'suspect',
        case_id: s.case_id,
        case_alias: s.case_alias,
        label: s.display_name,
        sub: `suspect · ${s.case_alias}`,
      })
    );

  db.prepare(
    `SELECT e.id, e.case_id, e.type, e.platform, e.content, c.alias AS case_alias
     FROM evidence e JOIN cases c ON c.id = e.case_id
     WHERE e.content LIKE ? OR e.platform LIKE ? OR e.notes LIKE ?`
  )
    .all(like, like, like)
    .forEach((e) =>
      hits.push({
        type: 'evidence',
        case_id: e.case_id,
        case_alias: e.case_alias,
        label: snippet(e.content, q),
        sub: `evidence · ${e.type}${e.platform ? ' · ' + e.platform : ''} · ${e.case_alias}`,
      })
    );

  db.prepare(`SELECT case_id, username FROM lookup_results WHERE username LIKE ? AND case_id IS NOT NULL`)
    .all(like)
    .forEach((l) =>
      hits.push({ type: 'lookup', case_id: l.case_id, label: '@' + l.username, sub: 'username lookup' })
    );

  res.json({ query: q, hits: hits.slice(0, 100) });
});

// Return a short window of text around the first match of q.
function snippet(text, q) {
  const s = String(text || '');
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return s.slice(0, 80);
  const start = Math.max(0, i - 30);
  return (start > 0 ? '…' : '') + s.slice(start, start + 90) + (start + 90 < s.length ? '…' : '');
}

module.exports = router;
