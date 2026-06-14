const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'cases.db');
let db;

function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      lead_investigator TEXT DEFAULT '',
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
      investigator TEXT DEFAULT '',
      content_hash TEXT DEFAULT '',
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

  migrate();

  console.log('Database ready at', DB_PATH);
  return db;
}

// Add columns to databases created by earlier versions, so upgrades don't
// lose existing case data.
function migrate() {
  const ensureColumn = (table, column, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  };

  ensureColumn('cases', 'lead_investigator', "TEXT DEFAULT ''");
  ensureColumn('evidence', 'investigator', "TEXT DEFAULT ''");
  ensureColumn('evidence', 'content_hash', "TEXT DEFAULT ''");
}

function getDb() {
  if (!db) initDb();
  return db;
}

module.exports = { initDb, getDb };
