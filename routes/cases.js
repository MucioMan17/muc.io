const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');

const router = express.Router();

const ATTACH_DIR = path.join(__dirname, '../data/attachments');
const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20 MB per file

// Canonical hash of an evidence record. Any later alteration of the type,
// platform, content, or timestamp changes this hash, so tampering is
// detectable when the report is reviewed. This is the chain-of-custody anchor.
function evidenceHash({ type, platform, content, timestamp, added_at }) {
  const canonical = [type, platform || '', content, timestamp, added_at].join(' ');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const parseSuspect = (s) => ({
  ...s,
  known_usernames: JSON.parse(s.known_usernames),
  known_emails: JSON.parse(s.known_emails),
  known_phones: JSON.parse(s.known_phones),
  platform_profiles: JSON.parse(s.platform_profiles),
});

const safeName = (name) =>
  String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'file';

// Load a complete case (suspects, evidence + attachments + integrity, lookups).
// Shared by the case detail endpoint and the report/bundle generators.
function loadFullCase(id) {
  const db = getDb();
  const case_ = db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
  if (!case_) return null;

  const suspects = db.prepare('SELECT * FROM suspects WHERE case_id = ?').all(id).map(parseSuspect);
  const lookups = db
    .prepare('SELECT * FROM lookup_results WHERE case_id = ? ORDER BY searched_at DESC')
    .all(id)
    .map((l) => ({ ...l, results: JSON.parse(l.results) }));

  const attachStmt = db.prepare('SELECT * FROM attachments WHERE evidence_id = ?');
  const evidence = db
    .prepare('SELECT * FROM evidence WHERE case_id = ? ORDER BY timestamp DESC')
    .all(id)
    .map((e) => ({
      ...e,
      integrity_ok: e.content_hash ? e.content_hash === evidenceHash(e) : null,
      attachments: attachStmt.all(e.id).map((a) => ({
        id: a.id, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256, added_at: a.added_at,
      })),
    }));

  return { case_, suspects, evidence, lookups };
}

// GET /api/cases — list all cases
router.get('/', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM cases ORDER BY updated_at DESC').all());
});

// POST /api/cases — create new case
router.post('/', (req, res) => {
  const { alias, notes, lead_investigator } = req.body;
  if (!alias || !alias.trim()) return res.status(400).json({ error: 'Case alias is required' });

  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO cases (id, alias, created_at, updated_at, status, lead_investigator, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, alias.trim(), now, now, 'active', lead_investigator || '', notes || '');

  res.status(201).json({ id, alias: alias.trim(), created_at: now, status: 'active' });
});

// GET /api/cases/:id — full case
router.get('/:id', (req, res) => {
  const full = loadFullCase(req.params.id);
  if (!full) return res.status(404).json({ error: 'Case not found' });
  res.json({ ...full.case_, suspects: full.suspects, evidence: full.evidence, lookups: full.lookups });
});

// PATCH /api/cases/:id — update case metadata (not evidence)
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Case not found' });

  const { alias, status, notes, lead_investigator } = req.body;
  db.prepare(
    'UPDATE cases SET alias=?, status=?, notes=?, lead_investigator=?, updated_at=? WHERE id=?'
  ).run(
    alias ?? existing.alias,
    status ?? existing.status,
    notes ?? existing.notes,
    lead_investigator ?? existing.lead_investigator,
    new Date().toISOString(),
    req.params.id
  );
  res.json({ success: true });
});

// DELETE /api/cases/:id — remove a case and all related records + files
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Case not found' });

  const id = req.params.id;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM attachments WHERE case_id = ?').run(id);
    db.prepare('DELETE FROM evidence WHERE case_id = ?').run(id);
    db.prepare('DELETE FROM suspects WHERE case_id = ?').run(id);
    db.prepare('DELETE FROM lookup_results WHERE case_id = ?').run(id);
    db.prepare('DELETE FROM cases WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  fs.rmSync(path.join(ATTACH_DIR, req.params.id), { recursive: true, force: true });
  res.json({ success: true });
});

// POST /api/cases/:id/suspects — add suspect profile
router.post('/:id/suspects', (req, res) => {
  const db = getDb();
  if (!db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const { display_name, known_usernames, known_emails, known_phones, platform_profiles, notes } = req.body;
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

// DELETE /api/cases/:id/suspects/:sid — remove a suspect
router.delete('/:id/suspects/:sid', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM suspects WHERE id = ? AND case_id = ?').get(req.params.sid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Suspect not found' });
  db.prepare('DELETE FROM suspects WHERE id = ?').run(req.params.sid);
  db.prepare('UPDATE cases SET updated_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
  res.json({ success: true });
});

// POST /api/cases/:id/evidence — append an immutable, hashed evidence record.
// Evidence is append-only by design: there is no edit/delete endpoint, which
// preserves the integrity of the chain of custody. An optional `attachments`
// array carries files (screenshots etc.) as base64; each is hashed and stored.
router.post('/:id/evidence', (req, res) => {
  const db = getDb();
  if (!db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const { suspect_id, type, platform, content, timestamp, investigator, notes, attachments } = req.body;
  if (!type || !content) return res.status(400).json({ error: 'Type and content are required' });

  const id = uuidv4();
  const now = new Date().toISOString();
  const record = { type, platform: platform || '', content, timestamp: timestamp || now, added_at: now };
  const hash = evidenceHash(record);

  // Decode and validate attachments before touching the database.
  const toStore = [];
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (!a || !a.data_base64) continue;
      const buf = Buffer.from(a.data_base64, 'base64');
      if (buf.length === 0) continue;
      if (buf.length > MAX_ATTACH_BYTES) {
        return res.status(413).json({ error: `Attachment "${a.filename}" exceeds 20MB.` });
      }
      toStore.push({
        id: uuidv4(),
        filename: safeName(a.filename),
        mime: String(a.mime || 'application/octet-stream').slice(0, 100),
        buf,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    }
  }

  const insertEvidence = db.prepare(
    `INSERT INTO evidence
       (id, case_id, suspect_id, type, platform, content, timestamp, added_at, investigator, content_hash, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAttach = db.prepare(
    `INSERT INTO attachments (id, evidence_id, case_id, filename, mime, size, sha256, stored_path, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const caseDir = path.join(ATTACH_DIR, req.params.id);
  fs.mkdirSync(caseDir, { recursive: true });

  db.exec('BEGIN');
  try {
    insertEvidence.run(
      id, req.params.id, suspect_id || null, type, platform || '',
      content, record.timestamp, now, investigator || '', hash, notes || ''
    );
    for (const a of toStore) {
      const diskName = `${a.id}-${a.filename}`;
      fs.writeFileSync(path.join(caseDir, diskName), a.buf);
      insertAttach.run(a.id, id, req.params.id, a.filename, a.mime, a.buf.length, a.sha256, diskName, now);
    }
    db.prepare('UPDATE cases SET updated_at=? WHERE id=?').run(now, req.params.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  res.status(201).json({
    id,
    content_hash: hash,
    attachments: toStore.map((a) => ({ id: a.id, filename: a.filename, sha256: a.sha256, size: a.buf.length })),
  });
});

// GET /api/cases/:id/attachments/:aid — stream a stored attachment file.
router.get('/:id/attachments/:aid', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND case_id = ?').get(req.params.aid, req.params.id);
  if (!a) return res.status(404).json({ error: 'Attachment not found' });

  const filePath = path.join(ATTACH_DIR, req.params.id, a.stored_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });

  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  const disposition = /^image\//.test(a.mime) ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${a.filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

module.exports = { router, evidenceHash, loadFullCase, ATTACH_DIR };
