const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');

const router = express.Router();

// GET /api/cases — list all cases
router.get('/', (req, res) => {
  const db = getDb();
  const cases = db.prepare('SELECT * FROM cases ORDER BY updated_at DESC').all();
  res.json(cases);
});

// POST /api/cases — create new case
router.post('/', (req, res) => {
  const { alias, notes } = req.body;
  if (!alias) return res.status(400).json({ error: 'Case alias is required' });

  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO cases (id, alias, created_at, updated_at, status, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, alias, now, now, 'active', notes || '');

  res.status(201).json({ id, alias, created_at: now, status: 'active' });
});

// GET /api/cases/:id — get single case with suspects and evidence
router.get('/:id', (req, res) => {
  const db = getDb();
  const case_ = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!case_) return res.status(404).json({ error: 'Case not found' });

  const suspects = db.prepare('SELECT * FROM suspects WHERE case_id = ?').all(req.params.id);
  const evidence = db.prepare('SELECT * FROM evidence WHERE case_id = ? ORDER BY timestamp DESC').all(req.params.id);
  const lookups = db.prepare('SELECT * FROM lookup_results WHERE case_id = ? ORDER BY searched_at DESC').all(req.params.id);

  res.json({
    ...case_,
    suspects: suspects.map((s) => ({
      ...s,
      known_usernames: JSON.parse(s.known_usernames),
      known_emails: JSON.parse(s.known_emails),
      known_phones: JSON.parse(s.known_phones),
      platform_profiles: JSON.parse(s.platform_profiles),
    })),
    evidence,
    lookups: lookups.map((l) => ({ ...l, results: JSON.parse(l.results) })),
  });
});

// PATCH /api/cases/:id — update case
router.patch('/:id', (req, res) => {
  const db = getDb();
  const { alias, status, notes } = req.body;
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Case not found' });

  db.prepare('UPDATE cases SET alias=?, status=?, notes=?, updated_at=? WHERE id=?').run(
    alias ?? existing.alias,
    status ?? existing.status,
    notes ?? existing.notes,
    now,
    req.params.id
  );
  res.json({ success: true });
});

// POST /api/cases/:id/suspects — add suspect to case
router.post('/:id/suspects', (req, res) => {
  const { display_name, known_usernames, known_emails, known_phones, platform_profiles, notes } = req.body;
  const db = getDb();
  const id = uuidv4();

  db.prepare(
    `INSERT INTO suspects (id, case_id, display_name, known_usernames, known_emails, known_phones, platform_profiles, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.params.id,
    display_name || 'Unknown',
    JSON.stringify(known_usernames || []),
    JSON.stringify(known_emails || []),
    JSON.stringify(known_phones || []),
    JSON.stringify(platform_profiles || []),
    notes || ''
  );

  db.prepare('UPDATE cases SET updated_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
  res.status(201).json({ id });
});

// PATCH /api/cases/:id/suspects/:sid — update suspect
router.patch('/:id/suspects/:sid', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM suspects WHERE id = ? AND case_id = ?').get(req.params.sid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Suspect not found' });

  const { display_name, known_usernames, known_emails, known_phones, platform_profiles, notes } = req.body;
  db.prepare(
    `UPDATE suspects SET display_name=?, known_usernames=?, known_emails=?, known_phones=?, platform_profiles=?, notes=? WHERE id=?`
  ).run(
    display_name ?? existing.display_name,
    JSON.stringify(known_usernames ?? JSON.parse(existing.known_usernames)),
    JSON.stringify(known_emails ?? JSON.parse(existing.known_emails)),
    JSON.stringify(known_phones ?? JSON.parse(existing.known_phones)),
    JSON.stringify(platform_profiles ?? JSON.parse(existing.platform_profiles)),
    notes ?? existing.notes,
    req.params.sid
  );

  db.prepare('UPDATE cases SET updated_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
  res.json({ success: true });
});

// POST /api/cases/:id/evidence — add evidence entry
router.post('/:id/evidence', (req, res) => {
  const { suspect_id, type, platform, content, timestamp, notes } = req.body;
  if (!type || !content) return res.status(400).json({ error: 'Type and content are required' });

  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO evidence (id, case_id, suspect_id, type, platform, content, timestamp, added_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.params.id, suspect_id || null, type, platform || '', content, timestamp || now, now, notes || '');

  db.prepare('UPDATE cases SET updated_at=? WHERE id=?').run(now, req.params.id);
  res.status(201).json({ id });
});

module.exports = router;
