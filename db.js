// Database for ISP. Uses Turso (libSQL, which is SQLite) online, and the local file data/isp.db
// on your own computer. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to use Turso.

const { createClient } = require("@libsql/client");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const defaultContent = require("./content-default");
const adamawaWards = require("./adamawa-wards");

function makeClient() {
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (url && !url.startsWith("file:")) {
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN });
  }
  const dir = path.join(__dirname, "data");
  fs.mkdirSync(dir, { recursive: true });
  return createClient({ url: url || `file:${path.join(dir, "isp.db").replace(/\\/g, "/")}` });
}

const client = makeClient();

function toObjects(result) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((col, i) => [col, row[i]])));
}

// Same shape as before (db.prepare(sql).get/all/run), but every call returns a promise.
const db = {
  prepare(sql) {
    return {
      async get(...args) {
        return toObjects(await client.execute({ sql, args }))[0];
      },
      async all(...args) {
        return toObjects(await client.execute({ sql, args }));
      },
      async run(...args) {
        const r = await client.execute({ sql, args });
        return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid === undefined ? undefined : Number(r.lastInsertRowid) };
      },
    };
  },
  // Runs several statements as one all-or-nothing step.
  async batch(statements) {
    return client.batch(statements.map(([sql, args = []]) => ({ sql, args })), "write");
  },
};

// One table for everybody: the super admin, every agent and every supporter.
// lga/ward/polling_unit come from the person's voter's card.
// assign_* is the area an agent is in charge of.
// path is the chain of who added whom ("/1/4/9/"), used to show each agent only their own people.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS people (
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
    import_id INTEGER,
    path TEXT NOT NULL DEFAULT '/',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS people_path ON people(path)`,
  `CREATE INDEX IF NOT EXISTS people_role ON people(role)`,
  // Fills in path automatically from the person who added them.
  `CREATE TRIGGER IF NOT EXISTS people_set_path AFTER INSERT ON people WHEN NEW.path = '/'
   BEGIN
     UPDATE people SET path = COALESCE((SELECT path FROM people WHERE id = NEW.added_by), '/') || NEW.id || '/' WHERE id = NEW.id;
   END`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  // Wards and polling units, set up by the super admin under each local government.
  `CREATE TABLE IF NOT EXISTS wards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lga TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (lga, name)
  )`,
  `CREATE TABLE IF NOT EXISTS polling_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ward_id INTEGER NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    UNIQUE (ward_id, name)
  )`,
  // Each Excel upload: whose template it was, who uploaded it, and whether the super admin approved it.
  `CREATE TABLE IF NOT EXISTS imports (
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
  )`,
  // Wrong-password count per login, for locking a login after too many tries.
  `CREATE TABLE IF NOT EXISTS login_failures (
    login TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

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

// One-off reset of the super admin: when ADMIN_RESET_PASSWORD is set (on Vercel, never in the code),
// the super admin signs in as "admin" with that password and is signed out everywhere.
// It runs once per ADMIN_RESET_ID (remembered in settings), so later password changes from My Account stick.
// Only the super admin's own row has role super_admin; nobody can add another, so there is one admin.
async function resetAdminOnce() {
  const password = process.env.ADMIN_RESET_PASSWORD;
  if (!password) return;
  const key = `admin_reset_${process.env.ADMIN_RESET_ID || "1"}`;
  if (await db.prepare("SELECT 1 AS done FROM settings WHERE key = ?").get(key)) return;
  const admin = await db.prepare("SELECT id, login FROM people WHERE role = 'super_admin' ORDER BY id LIMIT 1").get();
  if (!admin) return;
  // If someone else already has the login "admin", move them aside so the super admin can take it.
  const clash = await db.prepare("SELECT id FROM people WHERE login = 'admin' AND id != ?").get(admin.id);
  await db.batch([
    ...(clash ? [["UPDATE people SET login = ? WHERE id = ?", [`admin_${clash.id}`, clash.id]]] : []),
    ["UPDATE people SET login = 'admin', password_hash = ? WHERE id = ?", [hashPassword(password), admin.id]],
    ["DELETE FROM sessions WHERE person_id = ?", [admin.id]],
    ["DELETE FROM login_failures WHERE login IN ('admin', ?)", [admin.login || ""]],
    ["INSERT INTO settings (key, value) VALUES (?, ?)", [key, new Date().toISOString()]],
  ]);
  console.log("Super admin login reset to: admin");
}

// Adds the 226 wards of Adamawa State (with their codes and number of polling units) the first time.
// A ward already there with the same name only gets its code and polling unit count filled in,
// so wards the super admin typed in by hand are never duplicated or removed.
async function addWardsOnce() {
  const key = "wards_added_v1";
  if (await db.prepare("SELECT 1 AS done FROM settings WHERE key = ?").get(key)) return;
  const statements = [];
  for (const [lga, wards] of Object.entries(adamawaWards)) {
    for (const [code, name, pus] of wards) {
      // Names are matched ignoring capitals, so "BILLE" typed by hand counts as "Bille".
      statements.push(
        ["UPDATE wards SET code = ?, expected_pus = ? WHERE lga = ? AND name = ? COLLATE NOCASE", [code, pus, lga, name]],
        [
          "INSERT INTO wards (lga, name, code, expected_pus) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM wards WHERE lga = ? AND name = ? COLLATE NOCASE)",
          [lga, name, code, pus, lga, name],
        ]
      );
    }
  }
  // OR IGNORE: if two servers start at once, the second one's batch still succeeds.
  statements.push(["INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, new Date().toISOString()]]);
  await db.batch(statements);
  console.log("Added the wards of Adamawa State");
}

// Creates the tables and the super admin the first time. Runs once per server start.
let readyPromise = null;
function ready(adminLogin, adminPassword) {
  readyPromise ||= (async () => {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.batch(SCHEMA, "write");
    // Column added after the first version, for databases made before it existed.
    const columns = toObjects(await client.execute("PRAGMA table_info(people)")).map((c) => c.name);
    if (!columns.includes("import_id")) await client.execute("ALTER TABLE people ADD COLUMN import_id INTEGER");
    const wardColumns = toObjects(await client.execute("PRAGMA table_info(wards)")).map((c) => c.name);
    if (!wardColumns.includes("code")) await client.execute("ALTER TABLE wards ADD COLUMN code TEXT NOT NULL DEFAULT ''");
    if (!wardColumns.includes("expected_pus")) await client.execute("ALTER TABLE wards ADD COLUMN expected_pus INTEGER");
    await addWardsOnce();
    // Ends the old 7-day sessions, which were stored unhashed and last longer than 10 minutes.
    await client.execute({ sql: "DELETE FROM sessions WHERE expires_at > ?", args: [Date.now() + 11 * 60 * 1000] });
    const admin = await db.prepare("SELECT id FROM people WHERE role = 'super_admin' LIMIT 1").get();
    if (!admin) {
      await db
        .prepare("INSERT INTO people (role, full_name, login, password_hash, verified) VALUES ('super_admin', 'Super Admin', ?, ?, 1)")
        .run(adminLogin.toLowerCase(), hashPassword(adminPassword));
      console.log(`Created super admin login: ${adminLogin}`);
    }
    await resetAdminOnce();
  })().catch((err) => {
    readyPromise = null;
    throw err;
  });
  return readyPromise;
}

async function getContent() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'landing'").get();
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

async function saveContent(content) {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('landing', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(content));
}

module.exports = { db, ready, hashPassword, checkPassword, getContent, saveContent };
