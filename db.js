// Database for ISP. Uses Turso (libSQL, which is SQLite) online, and the local file data/isp.db
// on your own computer. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to use Turso.

const { createClient } = require("@libsql/client");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const defaultContent = require("./content-default");

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

// Creates the tables and the super admin the first time. Runs once per server start.
let readyPromise = null;
function ready(adminLogin, adminPassword) {
  readyPromise ||= (async () => {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.batch(SCHEMA, "write");
    // Column added after the first version, for databases made before it existed.
    const columns = toObjects(await client.execute("PRAGMA table_info(people)")).map((c) => c.name);
    if (!columns.includes("import_id")) await client.execute("ALTER TABLE people ADD COLUMN import_id INTEGER");
    const admin = await db.prepare("SELECT id FROM people WHERE role = 'super_admin' LIMIT 1").get();
    if (!admin) {
      await db
        .prepare("INSERT INTO people (role, full_name, login, password_hash, verified) VALUES ('super_admin', 'Super Admin', ?, ?, 1)")
        .run(adminLogin.toLowerCase(), hashPassword(adminPassword));
      console.log(`Created super admin login: ${adminLogin}`);
    }
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
