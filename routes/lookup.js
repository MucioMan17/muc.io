const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { lookupUsername } = require('../utils/platforms');
const { getDb } = require('../utils/db');

const router = express.Router();

// POST /api/lookup — search username across all platforms
router.post('/', async (req, res) => {
  const { username, case_id } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const clean = username.trim().replace(/^@/, '');

  try {
    const results = await lookupUsername(clean);
    const found = results.filter((r) => r.found);

    const db = getDb();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO lookup_results (id, case_id, username, results, searched_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, case_id || null, clean, JSON.stringify(results), new Date().toISOString());

    res.json({ username: clean, results, found_count: found.length, lookup_id: id });
  } catch (err) {
    console.error('Lookup error:', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// GET /api/lookup/history — retrieve past lookups for a case
router.get('/history', (req, res) => {
  const { case_id } = req.query;
  const db = getDb();
  const rows = case_id
    ? db.prepare('SELECT * FROM lookup_results WHERE case_id = ? ORDER BY searched_at DESC').all(case_id)
    : db.prepare('SELECT * FROM lookup_results ORDER BY searched_at DESC LIMIT 50').all();

  res.json(rows.map((r) => ({ ...r, results: JSON.parse(r.results) })));
});

module.exports = router;
