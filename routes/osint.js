const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');

const router = express.Router();

// Public OSINT lookup links for a given email address.
// We don't scrape these — we generate the direct search URLs so the investigator
// can open each one and check it themselves. This keeps results accurate
// (no false positives from parsing) and avoids hitting APIs that require keys.
function emailLinks(email) {
  const enc = encodeURIComponent(email);
  return [
    { name: 'Have I Been Pwned', description: 'Check if this email appears in known data breaches', url: `https://haveibeenpwned.com/account/${enc}` },
    { name: 'Hunter.io', description: 'Email verification and company association lookup', url: `https://hunter.io/email-verifier/${enc}` },
    { name: 'Google Search', description: 'General web search for this email', url: `https://www.google.com/search?q="${enc}"` },
    { name: 'Bing Search', description: 'Alternative search engine', url: `https://www.bing.com/search?q="${enc}"` },
    { name: 'Epieos', description: 'OSINT tool — finds accounts registered with this email', url: `https://epieos.com/?q=${enc}&t=email` },
    { name: 'GHunt (via Epieos)', description: 'If this is a Gmail — find linked Google account info', url: `https://epieos.com/?q=${enc}&t=email` },
    { name: 'Holehe (manual)', description: 'Run locally: `pip install holehe && holehe ' + email + '` — checks 120+ sites', url: null },
  ];
}

// Public OSINT lookup links for a phone number.
function phoneLinks(phone) {
  const enc = encodeURIComponent(phone);
  const digits = phone.replace(/\D/g, '');
  return [
    { name: 'Google Search', description: 'General web search for this number', url: `https://www.google.com/search?q="${enc}"` },
    { name: 'Truecaller', description: 'Caller ID / spam database', url: `https://www.truecaller.com/search/us/${digits}` },
    { name: 'NumLookup', description: 'Carrier and owner lookup', url: `https://www.numlookup.com/?number=${enc}` },
    { name: 'PhoneInfoga (manual)', description: 'Run locally: `pip install phoneinfoga && phoneinfoga scan -n ' + phone + '`', url: null },
    { name: 'Epieos', description: 'Find accounts linked to this phone number', url: `https://epieos.com/?q=${enc}&t=phone` },
  ];
}

// POST /api/osint/email  { email: "...", case_id: "..." }
router.post('/email', (req, res) => {
  const { email, case_id } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const links = emailLinks(email.trim().toLowerCase());
  const result = { email: email.trim().toLowerCase(), links, case_id: case_id || null, searched_at: new Date().toISOString() };

  // Optionally save as a lookup note in the case.
  if (case_id) {
    const db = getDb();
    const exists = db.prepare('SELECT id FROM cases WHERE id = ?').get(case_id);
    if (exists) {
      db.prepare(
        `INSERT INTO lookup_results (id, case_id, username, results, searched_at) VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), case_id, `email:${email}`, JSON.stringify(links), result.searched_at);
    }
  }

  res.json(result);
});

// POST /api/osint/phone  { phone: "...", case_id: "..." }
router.post('/phone', (req, res) => {
  const { phone, case_id } = req.body;
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone number required' });

  const links = phoneLinks(phone.trim());
  const result = { phone: phone.trim(), links, case_id: case_id || null, searched_at: new Date().toISOString() };

  if (case_id) {
    const db = getDb();
    const exists = db.prepare('SELECT id FROM cases WHERE id = ?').get(case_id);
    if (exists) {
      db.prepare(
        `INSERT INTO lookup_results (id, case_id, username, results, searched_at) VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), case_id, `phone:${phone}`, JSON.stringify(links), result.searched_at);
    }
  }

  res.json(result);
});

module.exports = router;
