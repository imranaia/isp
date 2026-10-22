// Independent Structure Platform (ISP)
// Campaign landing page, agent dashboard and voter's card (VIN) verification for Haske 2027.
// Runs as a normal Node server on your computer (npm start) and as a Vercel Function online (api/index.js).

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file; rely on real environment variables (as on Vercel).
}

const { db, ready, hashPassword, checkPassword, getContent, saveContent } = require("./db");

const PORT = Number(process.env.PORT) || 3001;
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
// Sessions end after 10 minutes without activity. Every request pushes the end time back.
const SESSION_IDLE_MS = 10 * 60 * 1000;
// Too many wrong passwords for one login locks that login for a while.
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 6;
const ON_VERCEL = Boolean(process.env.VERCEL);

// Starting login for the super admin, used only when the database is first created.
// The super admin can change the password at any time from My Account.
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

const ADAMAWA_LGAS = [
  "Demsa", "Fufore", "Ganye", "Gayuk", "Gombi", "Girei", "Hong", "Jada", "Lamurde", "Madagali", "Maiha",
  "Mayo Belwa", "Michika", "Mubi North", "Mubi South", "Numan", "Shelleng", "Song", "Toungo", "Yola North", "Yola South",
];

const ROLES = ["super_admin", "lga_agent", "ward_agent", "pu_agent", "supporter"];
const AGENT_ROLES = ["lga_agent", "ward_agent", "pu_agent"];

// Who is allowed to add whom.
const CAN_ADD = {
  super_admin: ["lga_agent", "ward_agent", "pu_agent", "supporter"],
  lga_agent: ["ward_agent", "pu_agent", "supporter"],
  ward_agent: ["pu_agent", "supporter"],
  pu_agent: ["supporter"],
  supporter: [],
};

// The shapes of real INEC VINs. Every one of the 2,167,529 VINs in the Adamawa register has one of them:
//   10 characters from 0-9 and A-F, then 9 digits (90F5B18CEF296209488) — nearly all;
//   the same with 8 or 11 digits at the end — a few hundred;
//   INC and 17 digits (INC21000000005573102) — newer registrations.
// A VIN of another shape is invalid. One of these shapes that is not in the register (yet) is still syncing with INEC.
const VIN_PATTERN = /^(?:[0-9A-F]{10}(?:\d{9}|\d{8}|\d{11})|INC\d{17})$/;
const INVALID_VIN = "Invalid VIN. A VIN is 19 characters (or INC and 17 numbers), as printed on the voter's card. Check the number and try again.";

const PUBLIC_FIELDS =
  "id, role, full_name, vin, gender, date_of_birth, phone, occupation, address, lga, ward, polling_unit, polling_unit_code, assign_lga, assign_ward, assign_pu, verified, login, added_by, import_id, created_at";
const PREFIXED_FIELDS = PUBLIC_FIELDS.split(", ").map((f) => "p." + f).join(", ");

const PERSON_COLUMNS = [
  "role", "full_name", "vin", "gender", "date_of_birth", "phone", "occupation", "address", "lga", "ward", "polling_unit",
  "polling_unit_code", "assign_lga", "assign_ward", "assign_pu", "verified", "login", "password_hash", "added_by", "import_id",
];
const INSERT_PERSON_SQL = `INSERT INTO people (${PERSON_COLUMNS.join(", ")}) VALUES (${PERSON_COLUMNS.map(() => "?").join(", ")})`;

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(ON_VERCEL ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 100_000) {
  // On Vercel the platform may already have read and parsed the body.
  if (ON_VERCEL && req.body !== undefined) {
    if (req.body === null || req.body === "") return Promise.resolve({});
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try {
      return Promise.resolve(JSON.parse(String(req.body)));
    } catch {
      return Promise.reject(new HttpError(400, "Invalid request."));
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "That upload is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new HttpError(400, "Invalid request."));
      }
    });
    req.on("error", reject);
  });
}

function clean(value, max = 200) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}

// Some lists print a 19-character VIN with "00" in front; the card itself has the 19 characters.
function cleanVin(value) {
  const vin = clean(value, 40).replace(/\s+/g, "").toUpperCase();
  return vin.length === 21 && vin.startsWith("00") ? vin.slice(2) : vin;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = decodeURIComponent(rest.join("="));
  }
  return out;
}

// Sessions are stored by a hash of the token, so a copy of the database can't be used to sign in.
function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function sessionCookie(value, extra = "") {
  // No Max-Age: the browser drops the cookie when it closes; the server ends the session after 10 idle minutes.
  return `isp_session=${value}; HttpOnly; SameSite=Strict; Path=/${ON_VERCEL ? "; Secure" : ""}${extra}`;
}

async function currentUser(req) {
  const token = parseCookies(req).isp_session;
  if (!token) return null;
  const hash = tokenHash(token);
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT ${PREFIXED_FIELDS}, p.path, s.expires_at AS session_expires FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(hash, now);
  if (!row) return null;
  // Activity keeps the session alive; written at most once a minute to spare the database.
  if (row.session_expires - now < SESSION_IDLE_MS - 60_000) {
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(now + SESSION_IDLE_MS, hash);
  }
  delete row.session_expires;
  row.session_token = hash;
  // There can be more than one super admin, and each sees the whole state, not only the people they added.
  if (row.role === "super_admin") row.path = "/";
  return row;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user || user.role === "supporter") throw new HttpError(401, "Please sign in.");
  return user;
}

async function requireSuperAdmin(req) {
  const user = await requireUser(req);
  if (user.role !== "super_admin") throw new HttpError(403, "Only the super admin can do that.");
  return user;
}

async function count(sql, ...args) {
  return (await db.prepare(sql).get(...args)).n;
}

// ---------- VIN verification ----------

// VINs are looked up in the Adamawa voter register (the voters table, loaded with scripts/load-voters.js).
const VOTER_FIELDS = "vin, full_name, gender, birth_year, lga, ward, polling_unit, polling_unit_code";
const STILL_SYNCING = "This VIN is in the correct format but is not in our copy of the INEC register yet: verification is still syncing with INEC. Please try again later.";

// The register lookup stays switched off until INEC approves it: set VIN_REGISTER_ENABLED=1 on Vercel
// (and redeploy) to switch it on. While it is off, every VIN check says it is awaiting INEC's approval;
// the register itself stays loaded in the voters table, ready for when it is switched on.
const REGISTER_ENABLED = ["1", "true", "yes", "on"].includes(String(process.env.VIN_REGISTER_ENABLED || "").toLowerCase());
const VERIFY_UNAVAILABLE = "Verification Failed: System integration is currently awaiting INEC's Admin Approval.";

// Each agent can look up this many VINs a day (single and bulk checks together), so nobody can copy
// the register by trying VINs in bulk. Super admins have no limit; every lookup is logged either way.
const VIN_DAILY_LIMIT = Number(process.env.VIN_DAILY_LIMIT) || 2000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Nigeria is UTC+1 all year

// Midnight in Nigeria today, in ms.
function startOfToday() {
  const lagos = new Date(Date.now() + LAGOS_OFFSET_MS);
  return Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - LAGOS_OFFSET_MS;
}

async function lookupsToday(personId) {
  const row = await db.prepare("SELECT COALESCE(SUM(vins), 0) AS n FROM vin_lookups WHERE person_id = ? AND created_at >= ?").get(personId, startOfToday());
  return Number(row.n);
}

// Stops the lookup if it would take the agent past today's limit; returns how many are left after it.
async function checkLookupLimit(user, count) {
  if (user.role === "super_admin") return null;
  const left = VIN_DAILY_LIMIT - (await lookupsToday(user.id));
  if (count > left) {
    throw new HttpError(
      429,
      left > 0
        ? `You can check ${left.toLocaleString("en-US")} more VIN${left === 1 ? "" : "s"} today (the limit is ${VIN_DAILY_LIMIT.toLocaleString("en-US")} a day). Check fewer at once, or continue tomorrow.`
        : `You have reached today's limit of ${VIN_DAILY_LIMIT.toLocaleString("en-US")} VIN checks. You can continue tomorrow.`
    );
  }
  return left - count;
}

async function logLookup(user, kind, vins, found) {
  await db.prepare("INSERT INTO vin_lookups (person_id, kind, vins, found, created_at) VALUES (?, ?, ?, ?, ?)").run(user.id, kind, vins, found, Date.now());
}

// Looks up one VIN: the voter's details from the register, and who already has it in the system.
async function verifyVin(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const vin = cleanVin(body.vin);
  if (!VIN_PATTERN.test(vin)) throw new HttpError(400, INVALID_VIN);
  if (!REGISTER_ENABLED) throw new HttpError(503, VERIFY_UNAVAILABLE);
  const remaining = await checkLookupLimit(user, 1);
  const row = await db.prepare(`SELECT ${VOTER_FIELDS} FROM voters WHERE vin = ?`).get(vin);
  await logLookup(user, "single", 1, row ? 1 : 0);
  if (!row) throw new HttpError(404, STILL_SYNCING);
  const { birth_year, ...voter } = row;
  voter.state = "Adamawa";
  if (birth_year) voter.birth_year = birth_year;
  const person = await db.prepare("SELECT full_name, role, path FROM people WHERE vin = ?").get(vin);
  // Who has the VIN is only shown for people in your own structure.
  const alreadyRegistered = person && (person.path.startsWith(user.path) ? { role: person.role, full_name: person.full_name } : { elsewhere: true });
  sendJson(res, 200, { voter, alreadyRegistered: alreadyRegistered || null, remaining });
}

// Checks a whole list of VINs at once: the format, repeats within the list, who is already in the system,
// and whether the VIN is in the voter register.
async function verifyVins(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req, 1_000_000);
  const list = (Array.isArray(body.vins) ? body.vins : []).slice(0, 5000).map(cleanVin);
  if (!list.some(Boolean)) throw new HttpError(400, "Add at least one VIN.");
  const valid = [...new Set(list.filter((v) => VIN_PATTERN.test(v)))];
  // Without the register, only the format, repeats and people already in the system are checked.
  const remaining = REGISTER_ENABLED ? await checkLookupLimit(user, valid.length) : null;
  const found = new Map();
  const voters = new Map();
  for (let i = 0; i < valid.length; i += 400) {
    const chunk = valid.slice(i, i + 400);
    const marks = chunk.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT vin, full_name, role, path FROM people WHERE vin IN (${marks})`).all(...chunk);
    for (const r of rows) found.set(r.vin, r);
    if (!REGISTER_ENABLED) continue;
    const listed = await db.prepare(`SELECT ${VOTER_FIELDS} FROM voters WHERE vin IN (${marks})`).all(...chunk);
    for (const v of listed) voters.set(v.vin, v);
  }
  const seen = new Set();
  const results = list.map((vin) => {
    if (!VIN_PATTERN.test(vin)) return { vin, status: "invalid" };
    if (seen.has(vin)) return { vin, status: "repeat" };
    seen.add(vin);
    const person = found.get(vin);
    const voter = voters.get(vin);
    const place = voter ? { voter_name: voter.full_name, lga: voter.lga, ward: voter.ward, polling_unit: voter.polling_unit, polling_unit_code: voter.polling_unit_code } : {};
    // Names are only shown for people in your own structure.
    if (person) return person.path.startsWith(user.path) ? { vin, status: "registered", role: person.role, full_name: person.full_name, ...place } : { vin, status: "registered", ...place };
    if (!REGISTER_ENABLED) return { vin, status: "awaiting" };
    return voter ? { vin, status: "found", ...place } : { vin, status: "syncing" };
  });
  if (REGISTER_ENABLED && valid.length) await logLookup(user, "bulk", valid.length, voters.size);
  sendJson(res, 200, { results, message: REGISTER_ENABLED ? STILL_SYNCING : VERIFY_UNAVAILABLE, remaining });
}

// For the super admin: how many VINs each agent has checked today, and the latest lookups.
async function listLookups(req, res) {
  await requireSuperAdmin(req);
  const who = "p.full_name, p.role, p.assign_lga, p.assign_ward, p.assign_pu";
  const today = await db
    .prepare(
      `SELECT ${who}, SUM(l.vins) AS vins, SUM(l.found) AS found, COUNT(*) AS lookups FROM vin_lookups l
       LEFT JOIN people p ON p.id = l.person_id WHERE l.created_at >= ? GROUP BY l.person_id ORDER BY vins DESC LIMIT 200`
    )
    .all(startOfToday());
  const recent = await db
    .prepare(`SELECT ${who}, l.kind, l.vins, l.found, l.created_at FROM vin_lookups l LEFT JOIN people p ON p.id = l.person_id ORDER BY l.id DESC LIMIT 200`)
    .all();
  sendJson(res, 200, { today, recent, limit: VIN_DAILY_LIMIT });
}

// ---------- people ----------

function personInput(body) {
  return {
    full_name: clean(body.full_name, 150),
    vin: cleanVin(body.vin) || null,
    gender: clean(body.gender, 20),
    date_of_birth: clean(body.date_of_birth, 30),
    phone: clean(body.phone, 30),
    occupation: clean(body.occupation, 100),
    address: clean(body.address, 300),
    lga: clean(body.lga, 80),
    ward: clean(body.ward, 120),
    polling_unit: clean(body.polling_unit, 200),
    polling_unit_code: clean(body.polling_unit_code, 40),
  };
}

// Works out the area a new agent is in charge of. An agent can never be given an area
// outside the area of the person adding them.
async function agentAssignment(creator, role, body) {
  let lga = clean(body.assign_lga, 80);
  let ward = clean(body.assign_ward, 120);
  const pu = clean(body.assign_pu, 200);
  if (creator.role === "lga_agent") lga = creator.assign_lga;
  if (creator.role === "ward_agent") {
    lga = creator.assign_lga;
    ward = creator.assign_ward;
  }
  if (!ADAMAWA_LGAS.includes(lga)) throw new HttpError(400, "Choose the local government this agent is in charge of.");
  if (role === "lga_agent") return { assign_lga: lga, assign_ward: "", assign_pu: "" };
  const wardRow = await db.prepare("SELECT id FROM wards WHERE lga = ? AND name = ?").get(lga, ward);
  if (!wardRow) throw new HttpError(400, `Choose the ward this agent is in charge of. If it is missing, the super admin must add it under ${lga} on the Locations page.`);
  if (role === "ward_agent") return { assign_lga: lga, assign_ward: ward, assign_pu: "" };
  if (!(await db.prepare("SELECT 1 AS ok FROM polling_units WHERE ward_id = ? AND name = ?").get(wardRow.id, pu))) {
    throw new HttpError(400, `Choose the polling unit this agent is in charge of. If it is missing, the super admin must add it under ${ward} on the Locations page.`);
  }
  return { assign_lga: lga, assign_ward: ward, assign_pu: pu };
}

// Turns a person into the values for INSERT_PERSON_SQL. Checks the name and VIN format only;
// duplicate VINs are checked by the callers.
function personRow(creator, role, person, extra = {}) {
  if (!person.full_name) throw new HttpError(400, "Full name is required.");
  if (person.vin && !VIN_PATTERN.test(person.vin)) throw new HttpError(400, `VIN "${person.vin}" is not a valid VIN. Check the number on the voter's card.`);
  // Supporters belong to the area of the agent who added them.
  const area = role === "supporter" ? { assign_lga: creator.assign_lga, assign_ward: creator.assign_ward, assign_pu: creator.assign_pu } : extra;
  const row = {
    role,
    ...person,
    assign_lga: area.assign_lga || "",
    assign_ward: area.assign_ward || "",
    assign_pu: area.assign_pu || "",
    verified: extra.verified ? 1 : 0,
    login: extra.login || null,
    password_hash: extra.password_hash || null,
    added_by: creator.id,
    import_id: extra.import_id || null,
  };
  return PERSON_COLUMNS.map((c) => (row[c] === undefined ? null : row[c]));
}

async function insertPerson(creator, role, person, extra = {}) {
  const values = personRow(creator, role, person, extra);
  if (person.vin) {
    const existing = await db.prepare("SELECT full_name FROM people WHERE vin = ?").get(person.vin);
    if (existing) throw new HttpError(409, `VIN ${person.vin} is already registered (${existing.full_name}).`);
  }
  // The database fills in "path" from the person who added them (see the trigger in db.js).
  const result = await db.prepare(INSERT_PERSON_SQL).run(...values);
  return result.lastInsertRowid;
}

async function createPerson(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const role = clean(body.role, 20);
  if (!CAN_ADD[user.role].includes(role)) throw new HttpError(403, "You are not allowed to add that type of person.");

  const person = personInput(body);
  // With no voter register connected, people are saved with the details typed in and marked not verified.
  const extra = { verified: false };

  if (AGENT_ROLES.includes(role)) {
    Object.assign(extra, await agentAssignment(user, role, body));
    const login = clean(body.login, 80).toLowerCase();
    const password = String(body.password || "");
    if (!login) throw new HttpError(400, "Give the agent a login (phone number or email).");
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `The agent's password must be at least ${MIN_PASSWORD} characters.`);
    if (await db.prepare("SELECT 1 AS ok FROM people WHERE login = ?").get(login)) throw new HttpError(409, "That login is already taken.");
    extra.login = login;
    extra.password_hash = hashPassword(password);
  }

  try {
    const id = await insertPerson(user, role, person, extra);
    sendJson(res, 201, { person: await db.prepare(`SELECT ${PUBLIC_FIELDS} FROM people WHERE id = ?`).get(id) });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "That VIN or login is already registered.");
    throw err;
  }
}

// Uploads an Excel file. If the file is an agent's own template, the people go under that agent
// (the uploader must be that agent or above them). Every upload is logged for the super admin to approve.
async function importPeople(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req, 5_000_000);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 10_000) : [];
  if (!rows.length) throw new HttpError(400, "The file has no rows.");

  let owner = user;
  if (body.ownerId && Number(body.ownerId) !== user.id) {
    owner = await db
      .prepare("SELECT id, role, full_name, path, assign_lga, assign_ward, assign_pu FROM people WHERE id = ?")
      .get(Number(body.ownerId));
    if (!owner || owner.role === "supporter" || !owner.path.startsWith(user.path)) {
      throw new HttpError(403, "This template belongs to an agent outside your area. Ask that agent or the super admin to upload it.");
    }
  }

  // Check every row first, so the database work is a few quick batches instead of one trip per person.
  const errors = [];
  const people = [];
  const seenVins = new Set();
  rows.forEach((raw, index) => {
    const rowNumber = Number(raw.__row) || index + 2;
    const person = personInput(raw);
    // Blank area columns are filled from the agent's own area.
    person.lga ||= owner.assign_lga || "";
    person.ward ||= owner.assign_ward || "";
    person.polling_unit ||= owner.assign_pu || "";
    if (!person.full_name) return errors.push({ row: rowNumber, message: "Full name is required." });
    if (person.vin && !VIN_PATTERN.test(person.vin)) return errors.push({ row: rowNumber, message: `VIN "${person.vin}" is not a valid VIN.` });
    if (person.vin && seenVins.has(person.vin)) return errors.push({ row: rowNumber, message: `VIN ${person.vin} appears twice in this file.` });
    if (person.vin) seenVins.add(person.vin);
    people.push({ person, rowNumber });
  });

  const vins = [...seenVins];
  const existing = new Map();
  for (let i = 0; i < vins.length; i += 400) {
    const chunk = vins.slice(i, i + 400);
    const found = await db.prepare(`SELECT vin, full_name FROM people WHERE vin IN (${chunk.map(() => "?").join(",")})`).all(...chunk);
    for (const f of found) existing.set(f.vin, f.full_name);
  }
  const toInsert = people.filter(({ person, rowNumber }) => {
    if (person.vin && existing.has(person.vin)) {
      errors.push({ row: rowNumber, message: `VIN ${person.vin} is already registered (${existing.get(person.vin)}).` });
      return false;
    }
    return true;
  });

  const batch = await db
    .prepare("INSERT INTO imports (owner_id, uploaded_by, owner_name, owner_role, area, file_name, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(owner.id, user.id, owner.full_name, owner.role, areaOf(owner), clean(body.fileName, 200), user.role === "super_admin" ? "approved" : "pending");
  const importId = batch.lastInsertRowid;

  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    await db.batch(chunk.map(({ person }) => [INSERT_PERSON_SQL, personRow(owner, "supporter", person, { import_id: importId })]));
  }
  errors.sort((a, b) => a.row - b.row);
  await db
    .prepare("UPDATE imports SET rows_added = ?, rows_skipped = ?, approved_at = CASE WHEN status = 'approved' THEN datetime('now') END WHERE id = ?")
    .run(toInsert.length, errors.length, importId);
  sendJson(res, 200, { added: toInsert.length, skipped: errors.length, errors: errors.slice(0, 200), owner: owner.full_name });
}

function areaOf(p) {
  return [p.assign_lga, p.assign_ward, p.assign_pu].filter(Boolean).join(" › ");
}

async function listImports(req, res) {
  const user = await requireUser(req);
  const rows = await db
    .prepare(
      `SELECT i.*, u.full_name AS uploaded_by_name FROM imports i
       LEFT JOIN people o ON o.id = i.owner_id
       LEFT JOIN people u ON u.id = i.uploaded_by
       WHERE o.path LIKE ? OR i.uploaded_by = ?
       ORDER BY i.id DESC LIMIT 500`
    )
    .all(`${user.path}%`, user.id);
  sendJson(res, 200, { rows });
}

async function setImportStatus(req, res, id, status) {
  await requireSuperAdmin(req);
  const result = await db
    .prepare("UPDATE imports SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') END WHERE id = ?")
    .run(status, status, id);
  if (!result.changes) throw new HttpError(404, "Upload not found.");
  sendJson(res, 200, { ok: true });
}

// ---------- locations: wards and polling units ----------

async function locations(req, res) {
  await requireUser(req);
  const [wards, units, agentCounts] = await Promise.all([
    // Wards in code order (01, 02, …); wards added by hand without a code come after, by name.
    db.prepare("SELECT id, lga, name, code, expected_pus FROM wards ORDER BY code = '', code, name").all(),
    db.prepare("SELECT id, ward_id, name, code FROM polling_units ORDER BY code, name").all(),
    db
      .prepare(
        "SELECT role, assign_lga, assign_ward, assign_pu, COUNT(*) AS n FROM people WHERE role IN ('lga_agent','ward_agent','pu_agent') GROUP BY 1, 2, 3, 4"
      )
      .all(),
  ]);
  const agents = (role, lga, ward = "", pu = "") =>
    agentCounts
      .filter((c) => c.role === role && c.assign_lga === lga && (!ward || c.assign_ward === ward) && (!pu || c.assign_pu === pu))
      .reduce((t, c) => t + c.n, 0);
  const tree = ADAMAWA_LGAS.map((lga) => ({
    name: lga,
    agents: agents("lga_agent", lga),
    wards: wards
      .filter((w) => w.lga === lga)
      .map((w) => ({
        id: w.id,
        name: w.name,
        code: w.code,
        expectedUnits: w.expected_pus,
        agents: agents("ward_agent", lga, w.name),
        units: units.filter((u) => u.ward_id === w.id).map((u) => ({ ...u, agents: agents("pu_agent", lga, w.name, u.name) })),
      })),
  }));
  sendJson(res, 200, { lgas: tree });
}

async function addWards(req, res) {
  await requireSuperAdmin(req);
  const body = await readBody(req);
  const lga = clean(body.lga, 80);
  if (!ADAMAWA_LGAS.includes(lga)) throw new HttpError(400, "Unknown local government.");
  const names = [...new Set((Array.isArray(body.names) ? body.names : []).map((n) => clean(n, 120)).filter(Boolean))];
  if (!names.length) throw new HttpError(400, "Type at least one ward name.");
  const results = await db.batch(names.map((name) => ["INSERT OR IGNORE INTO wards (lga, name) VALUES (?, ?)", [lga, name]]));
  const added = results.reduce((t, r) => t + r.rowsAffected, 0);
  sendJson(res, 201, { added, skipped: names.length - added });
}

// Renaming a polling unit also renames it on every agent in charge of it and every person registered at it,
// because people store the polling unit by name.
function renameUnitStatements(unit, name) {
  return [
    ["UPDATE polling_units SET name = ? WHERE id = ?", [name, unit.id]],
    ["UPDATE people SET assign_pu = ? WHERE assign_lga = ? AND assign_ward = ? AND assign_pu = ?", [name, unit.lga, unit.ward, unit.name]],
    ["UPDATE people SET polling_unit = ? WHERE lga = ? AND ward = ? AND polling_unit = ?", [name, unit.lga, unit.ward, unit.name]],
  ];
}

// Adds polling units to a ward. A line whose code matches a polling unit already in the ward renames
// that unit instead, so a list of real names can be pasted over the numbered ones ("PU 001", …).
async function addUnits(req, res) {
  await requireSuperAdmin(req);
  const body = await readBody(req, 500_000);
  const ward = await db.prepare("SELECT id, lga, name FROM wards WHERE id = ?").get(Number(body.wardId));
  if (!ward) throw new HttpError(404, "Ward not found.");
  const units = (Array.isArray(body.units) ? body.units : [])
    .map((u) => ({ name: clean(u.name, 200), code: clean(u.code, 40) }))
    .filter((u) => u.name);
  if (!units.length) throw new HttpError(400, "Type at least one polling unit.");
  const existing = await db.prepare("SELECT id, name, code FROM polling_units WHERE ward_id = ?").all(ward.id);
  const byCode = new Map(existing.filter((u) => u.code).map((u) => [u.code, u]));
  const names = new Set(existing.map((u) => u.name));
  const statements = [];
  let added = 0;
  let renamed = 0;
  for (const u of units) {
    const match = u.code && byCode.get(u.code);
    if (match) {
      if (match.name === u.name || names.has(u.name)) continue;
      statements.push(...renameUnitStatements({ ...match, lga: ward.lga, ward: ward.name }, u.name));
      names.delete(match.name);
      names.add(u.name);
      match.name = u.name;
      renamed++;
    } else if (!names.has(u.name)) {
      statements.push(["INSERT INTO polling_units (ward_id, name, code) VALUES (?, ?, ?)", [ward.id, u.name, u.code]]);
      names.add(u.name);
      added++;
    }
  }
  if (statements.length) await db.batch(statements);
  sendJson(res, 201, { added, renamed, skipped: units.length - added - renamed });
}

async function renameUnit(req, res, id) {
  await requireSuperAdmin(req);
  const body = await readBody(req);
  const name = clean(body.name, 200);
  if (!name) throw new HttpError(400, "Type the polling unit's name.");
  const unit = await db
    .prepare("SELECT u.id, u.ward_id, u.name, w.lga, w.name AS ward FROM polling_units u JOIN wards w ON w.id = u.ward_id WHERE u.id = ?")
    .get(id);
  if (!unit) throw new HttpError(404, "Polling unit not found.");
  if (name === unit.name) return sendJson(res, 200, { ok: true });
  if (await db.prepare("SELECT 1 AS taken FROM polling_units WHERE ward_id = ? AND name = ? AND id != ?").get(unit.ward_id, name, id)) {
    throw new HttpError(409, `${unit.ward} already has a polling unit called ${name}.`);
  }
  await db.batch(renameUnitStatements(unit, name));
  sendJson(res, 200, { ok: true });
}

async function deleteWard(req, res, id) {
  await requireSuperAdmin(req);
  const ward = await db.prepare("SELECT lga, name FROM wards WHERE id = ?").get(id);
  if (!ward) throw new HttpError(404, "Ward not found.");
  const agents = await count(
    "SELECT COUNT(*) AS n FROM people WHERE role IN ('ward_agent','pu_agent') AND assign_lga = ? AND assign_ward = ?",
    ward.lga,
    ward.name
  );
  if (agents) throw new HttpError(409, `${agents} agent(s) are assigned to this ward. Remove them first.`);
  await db.batch([
    ["DELETE FROM polling_units WHERE ward_id = ?", [id]],
    ["DELETE FROM wards WHERE id = ?", [id]],
  ]);
  sendJson(res, 200, { ok: true });
}

async function deleteUnit(req, res, id) {
  await requireSuperAdmin(req);
  const unit = await db
    .prepare("SELECT u.name, w.lga, w.name AS ward FROM polling_units u JOIN wards w ON w.id = u.ward_id WHERE u.id = ?")
    .get(id);
  if (!unit) throw new HttpError(404, "Polling unit not found.");
  const agents = await count(
    "SELECT COUNT(*) AS n FROM people WHERE role = 'pu_agent' AND assign_lga = ? AND assign_ward = ? AND assign_pu = ?",
    unit.lga,
    unit.ward,
    unit.name
  );
  if (agents) throw new HttpError(409, `${agents} agent(s) are assigned to this polling unit. Remove them first.`);
  await db.prepare("DELETE FROM polling_units WHERE id = ?").run(id);
  sendJson(res, 200, { ok: true });
}

// The agent an Excel template is made for: yourself, or someone under you.
async function templateOwner(req, res, id) {
  const user = await requireUser(req);
  const person = await db.prepare(`SELECT ${PUBLIC_FIELDS}, path FROM people WHERE id = ?`).get(id);
  if (!person || person.role === "supporter" || (person.id !== user.id && !person.path.startsWith(user.path))) {
    throw new HttpError(404, "Agent not found.");
  }
  delete person.path;
  sendJson(res, 200, { person });
}

async function listPeople(req, res, url) {
  const user = await requireUser(req);
  // Super admins run the platform; they aren't part of the structure, so they never appear in these lists.
  const where = ["p.path LIKE ?", "p.id != ?", "p.role != 'super_admin'"];
  const params = [`${user.path}%`, user.id];

  const role = url.searchParams.get("role");
  if (role === "agents") where.push("p.role IN ('lga_agent','ward_agent','pu_agent')");
  else if (ROLES.includes(role)) {
    where.push("p.role = ?");
    params.push(role);
  }
  const under = Number(url.searchParams.get("under"));
  if (under) {
    const agent = await db.prepare("SELECT path FROM people WHERE id = ?").get(under);
    where.push("p.path LIKE ?", "p.id != ?");
    params.push(agent ? `${agent.path}%` : "-", under);
  }
  const importId = Number(url.searchParams.get("import"));
  if (importId) {
    where.push("p.import_id = ?");
    params.push(importId);
  }
  const lga = url.searchParams.get("lga");
  if (lga) {
    where.push("(p.lga = ? OR p.assign_lga = ?)");
    params.push(lga, lga);
  }
  const q = clean(url.searchParams.get("q"), 100);
  if (q) {
    const fields = ["full_name", "vin", "phone", "ward", "polling_unit", "polling_unit_code", "assign_ward", "assign_pu"];
    where.push(`(${fields.map((f) => `p.${f} LIKE ?`).join(" OR ")})`);
    params.push(...fields.map(() => `%${q}%`));
  }

  const pageSize = Math.min(Number(url.searchParams.get("size")) || 25, 5000);
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
  const whereSql = where.join(" AND ");
  const [total, rows] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM people p WHERE ${whereSql}`, ...params),
    db
      .prepare(
        `SELECT ${PREFIXED_FIELDS}, a.full_name AS added_by_name
         FROM people p LEFT JOIN people a ON a.id = p.added_by
         WHERE ${whereSql}
         ORDER BY p.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize),
  ]);
  sendJson(res, 200, { total, page, pageSize, rows });
}

async function deletePerson(req, res, id) {
  const user = await requireUser(req);
  const target = await db.prepare("SELECT id, role, path, added_by FROM people WHERE id = ?").get(id);
  if (!target || target.id === user.id || !target.path.startsWith(user.path)) throw new HttpError(404, "Person not found.");
  if (target.role === "super_admin") throw new HttpError(403, "A super admin can't be removed.");
  const parent = await db.prepare("SELECT path FROM people WHERE id = ?").get(target.added_by);
  // All in one step: anyone this person added moves up to whoever added them, so nobody is lost.
  await db.batch([
    ["UPDATE people SET added_by = ? WHERE added_by = ?", [target.added_by, target.id]],
    ["UPDATE people SET path = ? || substr(path, ?) WHERE path LIKE ? AND id != ?", [parent.path, target.path.length + 1, `${target.path}%`, target.id]],
    ["UPDATE imports SET owner_id = NULL WHERE owner_id = ?", [target.id]],
    ["UPDATE imports SET uploaded_by = NULL WHERE uploaded_by = ?", [target.id]],
    ["DELETE FROM sessions WHERE person_id = ?", [target.id]],
    ["DELETE FROM people WHERE id = ?", [target.id]],
  ]);
  sendJson(res, 200, { ok: true });
}

async function resetPassword(req, res, id) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const target = await db.prepare("SELECT id, path, role, login, password_hash FROM people WHERE id = ?").get(id);
  const isSelf = target && target.id === user.id;
  if (!target || (!isSelf && !target.path.startsWith(user.path)) || target.role === "supporter") throw new HttpError(404, "Agent not found.");
  // Each super admin changes only their own password (from My Account).
  if (!isSelf && target.role === "super_admin") throw new HttpError(403, "Only that super admin can change their password.");
  // Changing your own password needs the current one, so an unattended screen can't be used to take over the account.
  if (isSelf && !checkPassword(String(body.currentPassword || ""), target.password_hash)) {
    throw new HttpError(400, "Your current password is wrong.");
  }
  const password = String(body.password || "");
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
  // A new password signs the person out everywhere else (you stay signed in on this device) and clears any lock.
  await db.batch([
    ["UPDATE people SET password_hash = ? WHERE id = ?", [hashPassword(password), id]],
    ["DELETE FROM sessions WHERE person_id = ? AND token != ?", [id, isSelf ? user.session_token : ""]],
    ["DELETE FROM login_failures WHERE login = ?", [target.login || ""]],
  ]);
  sendJson(res, 200, { ok: true });
}

async function stats(req, res) {
  const user = await requireUser(req);
  const scope = `${user.path}%`;
  // Each level sees its people broken down by the level below it:
  // super admin by local government, LGA agent by ward, ward agent by polling unit.
  const level = {
    super_admin: { label: "local government", column: "COALESCE(NULLIF(assign_lga, ''), NULLIF(lga, ''), 'Unknown')" },
    lga_agent: { label: "ward", column: "COALESCE(NULLIF(assign_ward, ''), NULLIF(ward, ''), 'Not set')" },
    ward_agent: { label: "polling unit", column: "COALESCE(NULLIF(assign_pu, ''), NULLIF(polling_unit, ''), 'Not set')" },
  }[user.role];
  const [roleCounts, verified, breakdown, thisWeek, recent] = await Promise.all([
    db.prepare("SELECT role, COUNT(*) AS n FROM people WHERE path LIKE ? AND id != ? AND role != 'super_admin' GROUP BY role").all(scope, user.id),
    count("SELECT COUNT(*) AS n FROM people WHERE path LIKE ? AND id != ? AND role != 'super_admin' AND verified = 1", scope, user.id),
    level
      ? db.prepare(`SELECT ${level.column} AS name, COUNT(*) AS n FROM people WHERE path LIKE ? AND id != ? AND role != 'super_admin' GROUP BY 1 ORDER BY n DESC`).all(scope, user.id)
      : [],
    count(
      "SELECT COUNT(*) AS n FROM people WHERE path LIKE ? AND id != ? AND role != 'super_admin' AND role = 'supporter' AND created_at >= datetime('now', '-7 days')",
      scope,
      user.id
    ),
    db.prepare(`SELECT ${PUBLIC_FIELDS} FROM people WHERE path LIKE ? AND id != ? AND role != 'super_admin' ORDER BY id DESC LIMIT 8`).all(scope, user.id),
  ]);
  const counts = Object.fromEntries(roleCounts.map((r) => [r.role, r.n]));
  const lgaAgents = counts.lga_agent || 0;
  const wardAgents = counts.ward_agent || 0;
  const puAgents = counts.pu_agent || 0;
  sendJson(res, 200, {
    totalAgents: lgaAgents + wardAgents + puAgents,
    lgaAgents,
    wardAgents,
    puAgents,
    supporters: counts.supporter || 0,
    verified,
    thisWeek,
    breakdownLabel: level ? level.label : "",
    breakdown,
    recent,
  });
}

// ---------- auth ----------

// Checked when the login doesn't exist, so a wrong login takes as long as a wrong password.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

async function login(req, res) {
  const body = await readBody(req);
  const loginName = clean(body.login, 80).toLowerCase();
  const now = Date.now();
  const failures = await db.prepare("SELECT count, locked_until FROM login_failures WHERE login = ?").get(loginName);
  if (failures && failures.locked_until > now) {
    const minutes = Math.ceil((failures.locked_until - now) / 60_000);
    throw new HttpError(429, `Too many wrong passwords. This login is locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`);
  }
  const person = await db.prepare("SELECT id, password_hash, role FROM people WHERE login = ?").get(loginName);
  const passwordOk = checkPassword(String(body.password || ""), (person && person.password_hash) || DUMMY_HASH);
  if (!person || person.role === "supporter" || !passwordOk) {
    // The count starts again once a lock has run out.
    const count = (failures && !failures.locked_until ? failures.count : 0) + 1;
    const lockedUntil = count >= MAX_LOGIN_FAILURES ? now + LOCKOUT_MS : 0;
    await db
      .prepare(
        "INSERT INTO login_failures (login, count, locked_until) VALUES (?, ?, ?) ON CONFLICT(login) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until"
      )
      .run(loginName, lockedUntil ? 0 : count, lockedUntil);
    if (lockedUntil) throw new HttpError(429, `Too many wrong passwords. This login is locked for ${LOCKOUT_MS / 60_000} minutes.`);
    throw new HttpError(401, "Wrong login or password.");
  }
  const token = crypto.randomBytes(32).toString("hex");
  await db.batch([
    ["DELETE FROM sessions WHERE expires_at < ?", [now]],
    ["DELETE FROM login_failures WHERE login = ?", [loginName]],
    ["INSERT INTO sessions (token, person_id, expires_at) VALUES (?, ?, ?)", [tokenHash(token), person.id, now + SESSION_IDLE_MS]],
  ]);
  sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token) });
}

async function logout(req, res) {
  const token = parseCookies(req).isp_session;
  if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").run(tokenHash(token));
  sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", "; Max-Age=0") });
}

async function me(req, res) {
  const user = await requireUser(req);
  delete user.path;
  delete user.session_token;
  sendJson(res, 200, { user, canAdd: CAN_ADD[user.role], lgas: ADAMAWA_LGAS });
}

// ---------- landing page content ----------

async function updateContent(req, res) {
  await requireSuperAdmin(req);
  const body = await readBody(req, 1_000_000);
  if (!body || typeof body.content !== "object") throw new HttpError(400, "Invalid content.");
  await saveContent(body.content);
  sendJson(res, 200, { ok: true });
}

const IMAGE_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/svg+xml": ".svg" };

// Pictures for the landing page. Online they go to Vercel Blob; on your computer, to public/uploads.
async function uploadImage(req, res) {
  await requireSuperAdmin(req);
  const body = await readBody(req, 12_000_000);
  const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(body.dataUrl || ""));
  if (!match || !IMAGE_TYPES[match[1]]) throw new HttpError(400, "Upload a JPG, PNG, WEBP or SVG image.");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 8_000_000) throw new HttpError(413, "Images must be under 8 MB.");
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${IMAGE_TYPES[match[1]]}`;
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    const { put } = require("@vercel/blob");
    const blob = await put(`landing/${name}`, buffer, { access: "public", contentType: match[1] });
    return sendJson(res, 201, { url: blob.url });
  }
  if (ON_VERCEL) throw new HttpError(500, "Picture storage is not connected. Connect a Vercel Blob store to this project.");
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  sendJson(res, 201, { url: `/uploads/${name}` });
}

// ---------- static files (local only; Vercel serves public/ itself) ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/login" || pathname === "/dashboard") pathname = pathname === "/login" ? "/login.html" : "/app.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: "Not found" });
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: "Not found" });
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream", ...SECURITY_HEADERS };
    // Uploaded SVGs are served as images only, never run as pages.
    if (pathname.startsWith("/uploads/")) headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- router ----------

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  // On Vercel every /api/* request is rewritten to /api?__path=...; put the original path back.
  const rewritten = url.searchParams.get("__path");
  if (url.pathname === "/api" && rewritten !== null) {
    url.pathname = `/api/${rewritten}`;
    url.searchParams.delete("__path");
  }
  const { pathname } = url;
  const method = req.method;

  if (!pathname.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });
    return serveStatic(req, res, pathname);
  }

  // Requests that change data must come from this site's own pages.
  if (method !== "GET" && method !== "HEAD" && req.headers.origin) {
    let originHost = "";
    try {
      originHost = new URL(req.headers.origin).host;
    } catch {}
    if (originHost !== (req.headers["x-forwarded-host"] || req.headers.host)) throw new HttpError(403, "Request blocked.");
  }

  await ready(ADMIN_LOGIN, ADMIN_PASSWORD);

  if (method === "POST" && pathname === "/api/login") return login(req, res);
  if (method === "POST" && pathname === "/api/logout") return logout(req, res);
  if (method === "GET" && pathname === "/api/me") return me(req, res);
  if (method === "GET" && pathname === "/api/content") return sendJson(res, 200, { content: await getContent() });
  if (method === "PUT" && pathname === "/api/content") return updateContent(req, res);
  if (method === "POST" && pathname === "/api/upload") return uploadImage(req, res);
  if (method === "GET" && pathname === "/api/stats") return stats(req, res);
  if (method === "GET" && pathname === "/api/people") return listPeople(req, res, url);
  if (method === "POST" && pathname === "/api/people") return createPerson(req, res);
  if (method === "POST" && pathname === "/api/people/import") return importPeople(req, res);
  if (method === "GET" && pathname === "/api/imports") return listImports(req, res);
  if (method === "GET" && pathname === "/api/locations") return locations(req, res);
  if (method === "POST" && pathname === "/api/wards") return addWards(req, res);
  if (method === "POST" && pathname === "/api/units") return addUnits(req, res);

  const itemMatch = /^\/api\/(wards|units|imports|template)\/(\d+)(\/approve|\/reject)?$/.exec(pathname);
  if (itemMatch) {
    const [, kind, idText, action] = itemMatch;
    const id = Number(idText);
    if (kind === "wards" && method === "DELETE") return deleteWard(req, res, id);
    if (kind === "units" && method === "DELETE") return deleteUnit(req, res, id);
    if (kind === "units" && method === "PUT" && !action) return renameUnit(req, res, id);
    if (kind === "template" && method === "GET") return templateOwner(req, res, id);
    if (kind === "imports" && method === "POST" && action) return setImportStatus(req, res, id, action === "/approve" ? "approved" : "rejected");
  }

  if (method === "POST" && pathname === "/api/verify-vin") return verifyVin(req, res);
  if (method === "POST" && pathname === "/api/verify-vins") return verifyVins(req, res);
  if (method === "GET" && pathname === "/api/vin-lookups") return listLookups(req, res);

  const personMatch = /^\/api\/people\/(\d+)(\/password)?$/.exec(pathname);
  if (personMatch) {
    const id = Number(personMatch[1]);
    if (method === "DELETE" && !personMatch[2]) return deletePerson(req, res, id);
    if (method === "PUT" && personMatch[2]) return resetPassword(req, res, id);
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handler(req, res) {
  try {
    await route(req, res);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    sendJson(res, 500, { error: "Something went wrong on the server." });
  }
}

module.exports = handler;

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`ISP running at http://localhost:${PORT}`);
  });
}
