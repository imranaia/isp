// Database setup for ISP. Uses Node's built-in SQLite, so there is nothing to install.

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const defaultContent = require("./content-default");

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "isp.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

// One table for everybody: the super admin, every agent and every supporter.
// lga/ward/polling_unit come from the person's voter's card.
// assign_* is the area an agent is in charge of (empty for supporters).
// path is the chain of who added whom ("/1/4/9/"), used to show each agent only their own people.
db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('super_admin','lga_agent','ward_agent','pu_agent','supporter')),
    full_name TEXT NOT NULL,
    vin TEXT UNIQUE,
    gender TEXT,
    date_of_birth TEXT,
    phone TEXT,
    occupation TEXT,
    address TEXT,
    lga TEXT,
    ward TEXT,
    polling_unit TEXT,
    polling_unit_code TEXT,
    assign_lga TEXT,
    assign_ward TEXT,
    assign_pu TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    login TEXT UNIQUE,
    password_hash TEXT,
    added_by INTEGER REFERENCES people(id),
    path TEXT NOT NULL DEFAULT '/',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS people_path ON people(path);
  CREATE INDEX IF NOT EXISTS people_role ON people(role);

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- Wards and polling units, set up by the super admin under each local government.
  CREATE TABLE IF NOT EXISTS wards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lga TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (lga, name)
  );
  CREATE TABLE IF NOT EXISTS polling_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    UNIQUE (ward_id, name)
  );

  -- Each Excel upload: whose template it was, who uploaded it, and whether the super admin approved it.
  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    uploaded_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
    owner_name TEXT NOT NULL,
    owner_role TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    rows_added INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Columns added after the first version.
const peopleColumns = db.prepare("PRAGMA table_info(people)").all().map((c) => c.name);
if (!peopleColumns.includes("import_id")) db.exec("ALTER TABLE people ADD COLUMN import_id INTEGER");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

function ensureSuperAdmin(login, password) {
  const existing = db.prepare("SELECT id FROM people WHERE role = 'super_admin' LIMIT 1").get();
  if (existing) return;
  const result = db
    .prepare("INSERT INTO people (role, full_name, login, password_hash, verified, path) VALUES ('super_admin', 'Super Admin', ?, ?, 1, '/')")
    .run(login.toLowerCase(), hashPassword(password));
  db.prepare("UPDATE people SET path = ? WHERE id = ?").run(`/${result.lastInsertRowid}/`, result.lastInsertRowid);
  console.log(`Created super admin login: ${login}`);
}

function getContent() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'landing'").get();
  if (!row) return defaultContent;
  // Merge section by section, so fields added in later versions still appear for older saved content.
  const saved = JSON.parse(row.value);
  const merged = { ...defaultContent };
  for (const [key, value] of Object.entries(saved)) {
    const base = defaultContent[key];
    merged[key] = base && typeof base === "object" && !Array.isArray(base) ? { ...base, ...value } : value;
  }
  return merged;
}

function saveContent(content) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('landing', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(content)
  );
}

module.exports = { db, hashPassword, checkPassword, ensureSuperAdmin, getContent, saveContent };
