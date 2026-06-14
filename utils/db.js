const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/cases.db');
let db;

function initDb() {
  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS suspects (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      display_name TEXT,
      known_usernames TEXT DEFAULT '[]',
      known_emails TEXT DEFAULT '[]',
      known_phones TEXT DEFAULT '[]',
      platform_profiles TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      FOREIGN KEY(case_id) REFERENCES cases(id)
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      suspect_id TEXT,
      type TEXT NOT NULL,
      platform TEXT,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      added_at TEXT NOT NULL,
      notes TEXT DEFAULT '',
      FOREIGN KEY(case_id) REFERENCES cases(id)
    );

    CREATE TABLE IF NOT EXISTS lookup_results (
      id TEXT PRIMARY KEY,
      case_id TEXT,
      username TEXT NOT NULL,
      results TEXT NOT NULL,
      searched_at TEXT NOT NULL
    );
  `);

  console.log('Database initialized at', DB_PATH);
  return db;
}

function getDb() {
  if (!db) initDb();
  return db;
}

module.exports = { initDb, getDb };
