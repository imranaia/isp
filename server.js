// Independent Structure Platform (ISP)
// Campaign landing page, agent dashboard and voter's card (VIN) verification for Haske 2027.
// Plain Node.js: built-in http server and built-in SQLite, no packages to install.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file; rely on real environment variables.
}

const { db, hashPassword, checkPassword, ensureSuperAdmin, getContent, saveContent } = require("./db");

const PORT = Number(process.env.PORT) || 3001;
const DOJAH_BASE_URL = process.env.DOJAH_BASE_URL || "https://sandbox.dojah.io";
const DOJAH_APP_ID = process.env.DOJAH_APP_ID || "";
const DOJAH_SECRET_KEY = process.env.DOJAH_SECRET_KEY || "";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
const SESSION_DAYS = 7;

ensureSuperAdmin(process.env.ADMIN_LOGIN || "admin", process.env.ADMIN_PASSWORD || "Haske2027!");

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

const VIN_PATTERN = /^[A-Z0-9]{19}$/;

const PUBLIC_FIELDS =
  "id, role, full_name, vin, gender, date_of_birth, phone, occupation, address, lga, ward, polling_unit, polling_unit_code, assign_lga, assign_ward, assign_pu, verified, login, added_by, import_id, created_at";

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 100_000) {
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

function cleanVin(value) {
  return clean(value, 40).replace(/\s+/g, "").toUpperCase();
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).isp_session;
  if (!token) return null;
  const row = db
    .prepare(`SELECT ${PUBLIC_FIELDS.split(", ").map((f) => "p." + f).join(", ")}, p.path FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = ? AND s.expires_at > ?`)
    .get(token, Date.now());
  return row || null;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user || user.role === "supporter") throw new HttpError(401, "Please sign in.");
  return user;
}

function requireSuperAdmin(req) {
  const user = requireUser(req);
  if (user.role !== "super_admin") throw new HttpError(403, "Only the super admin can do that.");
  return user;
}

// ---------- Dojah ----------

function normalizeDojah(entity) {
  return {
    full_name: entity.full_name || "",
    vin: entity.voter_identification_number || entity.vin || "",
    gender: entity.gender || "",
    date_of_birth: entity.date_of_birth || "",
    phone: entity.phone || "",
    occupation: entity.occupation || "",
    address: entity.address || "",
    state: entity.state || "",
    lga: entity.local_government || "",
    ward: entity.registration_area_ward || "",
    polling_unit: entity.polling_unit || "",
    polling_unit_code: entity.polling_unit_code || "",
    registered_on: entity.time_of_registration || "",
  };
}

// Remembers recent lookups for 30 minutes, so checking a VIN and then saving the
// person only costs one paid Dojah call.
const vinCache = new Map();
const VIN_CACHE_MS = 30 * 60 * 1000;

async function lookupVin(vin) {
  const cached = vinCache.get(vin);
  if (cached && Date.now() - cached.at < VIN_CACHE_MS) return cached.card;
  if (!DOJAH_APP_ID || !DOJAH_SECRET_KEY) {
    throw new HttpError(500, "Dojah keys are not set. Add DOJAH_APP_ID and DOJAH_SECRET_KEY to .env.");
  }
  let response;
  try {
    response = await fetch(`${DOJAH_BASE_URL}/api/v1/kyc/vin?vin=${encodeURIComponent(vin)}`, {
      headers: { AppId: DOJAH_APP_ID, Authorization: DOJAH_SECRET_KEY },
    });
  } catch (err) {
    console.error("Dojah request failed:", err.message);
    throw new HttpError(502, "Could not reach the verification service. Try again.");
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.entity) {
    throw new HttpError(response.ok || response.status === 404 ? 404 : 502, json.error || "No voter record was found for that VIN.");
  }
  const card = normalizeDojah(json.entity);
  vinCache.set(vin, { card, at: Date.now() });
  if (vinCache.size > 2000) vinCache.delete(vinCache.keys().next().value);
  return card;
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
function agentAssignment(creator, role, body) {
  let lga = clean(body.assign_lga, 80);
  let ward = clean(body.assign_ward, 120);
  let pu = clean(body.assign_pu, 200);
  if (creator.role === "lga_agent") lga = creator.assign_lga;
  if (creator.role === "ward_agent") {
    lga = creator.assign_lga;
    ward = creator.assign_ward;
  }
  if (!ADAMAWA_LGAS.includes(lga)) throw new HttpError(400, "Choose the local government this agent is in charge of.");
  if (role === "lga_agent") return { assign_lga: lga, assign_ward: "", assign_pu: "" };
  const wardRow = db.prepare("SELECT id FROM wards WHERE lga = ? AND name = ?").get(lga, ward);
  if (!wardRow) throw new HttpError(400, `Choose the ward this agent is in charge of. If it is missing, the super admin must add it under ${lga} on the Locations page.`);
  if (role === "ward_agent") return { assign_lga: lga, assign_ward: ward, assign_pu: "" };
  if (!db.prepare("SELECT 1 FROM polling_units WHERE ward_id = ? AND name = ?").get(wardRow.id, pu)) {
    throw new HttpError(400, `Choose the polling unit this agent is in charge of. If it is missing, the super admin must add it under ${ward} on the Locations page.`);
  }
  return { assign_lga: lga, assign_ward: ward, assign_pu: pu };
}

function insertPerson(creator, role, person, extra = {}) {
  if (!person.full_name) throw new HttpError(400, "Full name is required.");
  if (person.vin && !VIN_PATTERN.test(person.vin)) throw new HttpError(400, `VIN "${person.vin}" is not 19 letters and numbers.`);
  if (person.vin) {
    const existing = db.prepare("SELECT full_name FROM people WHERE vin = ?").get(person.vin);
    if (existing) throw new HttpError(409, `VIN ${person.vin} is already registered (${existing.full_name}).`);
  }
  // Supporters belong to the area of the agent who added them.
  if (role === "supporter") {
    extra = { ...extra, assign_lga: creator.assign_lga, assign_ward: creator.assign_ward, assign_pu: creator.assign_pu };
  }
  const row = {
    role,
    ...person,
    assign_lga: extra.assign_lga || "",
    assign_ward: extra.assign_ward || "",
    assign_pu: extra.assign_pu || "",
    verified: extra.verified ? 1 : 0,
    login: extra.login || null,
    password_hash: extra.password_hash || null,
    added_by: creator.id,
    import_id: extra.import_id || null,
  };
  const columns = Object.keys(row);
  const result = db
    .prepare(`INSERT INTO people (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...columns.map((c) => row[c]));
  const id = Number(result.lastInsertRowid);
  db.prepare("UPDATE people SET path = ? WHERE id = ?").run(`${creator.path}${id}/`, id);
  return id;
}

async function createPerson(req, res) {
  const user = requireUser(req);
  const body = await readBody(req);
  const role = clean(body.role, 20);
  if (!CAN_ADD[user.role].includes(role)) throw new HttpError(403, "You are not allowed to add that type of person.");

  const person = personInput(body);
  const extra = { verified: false };

  // If a VIN was given, check it with Dojah so the record is the real voter's card data.
  if (person.vin && body.verify !== false) {
    if (!VIN_PATTERN.test(person.vin)) throw new HttpError(400, "A VIN is 19 letters and numbers.");
    const card = await lookupVin(person.vin);
    for (const key of Object.keys(person)) {
      if (key !== "vin" && key !== "phone" && card[key]) person[key] = clean(card[key], 300);
    }
    extra.verified = true;
  }

  if (AGENT_ROLES.includes(role)) {
    Object.assign(extra, agentAssignment(user, role, body));
    const login = clean(body.login, 80).toLowerCase();
    const password = String(body.password || "");
    if (!login) throw new HttpError(400, "Give the agent a login (phone number or email).");
    if (password.length < 6) throw new HttpError(400, "The agent's password must be at least 6 characters.");
    if (db.prepare("SELECT 1 FROM people WHERE login = ?").get(login)) throw new HttpError(409, "That login is already taken.");
    extra.login = login;
    extra.password_hash = hashPassword(password);
  }

  try {
    const id = insertPerson(user, role, person, extra);
    sendJson(res, 201, { person: db.prepare(`SELECT ${PUBLIC_FIELDS} FROM people WHERE id = ?`).get(id) });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "That VIN or login is already registered.");
    throw err;
  }
}

// Uploads an Excel file. If the file is an agent's own template, the people go under that agent
// (the uploader must be that agent or above them). Every upload is logged for the super admin to approve.
async function importPeople(req, res) {
  const user = requireUser(req);
  const body = await readBody(req, 5_000_000);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 10_000) : [];
  if (!rows.length) throw new HttpError(400, "The file has no rows.");

  let owner = user;
  if (body.ownerId && Number(body.ownerId) !== user.id) {
    owner = db.prepare("SELECT id, role, full_name, path, assign_lga, assign_ward, assign_pu FROM people WHERE id = ?").get(Number(body.ownerId));
    if (!owner || owner.role === "supporter" || !owner.path.startsWith(user.path)) {
      throw new HttpError(403, "This template belongs to an agent outside your area. Ask that agent or the super admin to upload it.");
    }
  }

  let added = 0;
  const errors = [];
  db.exec("BEGIN");
  try {
    const batch = db
      .prepare("INSERT INTO imports (owner_id, uploaded_by, owner_name, owner_role, area, file_name, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(owner.id, user.id, owner.full_name, owner.role, areaOf(owner), clean(body.fileName, 200), user.role === "super_admin" ? "approved" : "pending");
    const importId = Number(batch.lastInsertRowid);
    rows.forEach((raw, index) => {
      try {
        const person = personInput(raw);
        // Blank area columns are filled from the agent's own area.
        person.lga ||= owner.assign_lga || "";
        person.ward ||= owner.assign_ward || "";
        person.polling_unit ||= owner.assign_pu || "";
        insertPerson(owner, "supporter", person, { import_id: importId });
        added++;
      } catch (err) {
        errors.push({ row: Number(raw.__row) || index + 2, message: err instanceof HttpError ? err.message : "Could not save this row." });
      }
    });
    db.prepare(
      "UPDATE imports SET rows_added = ?, rows_skipped = ?, approved_at = CASE WHEN status = 'approved' THEN datetime('now') END WHERE id = ?"
    ).run(added, errors.length, importId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  sendJson(res, 200, { added, skipped: errors.length, errors: errors.slice(0, 200), owner: owner.full_name });
}

function areaOf(p) {
  return [p.assign_lga, p.assign_ward, p.assign_pu].filter(Boolean).join(" › ");
}

function listImports(req, res) {
  const user = requireUser(req);
  const rows = db
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

function setImportStatus(req, res, id, status) {
  requireSuperAdmin(req);
  const result = db
    .prepare("UPDATE imports SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') END WHERE id = ?")
    .run(status, status, id);
  if (!result.changes) throw new HttpError(404, "Upload not found.");
  sendJson(res, 200, { ok: true });
}

// ---------- locations: wards and polling units ----------

function locations(req, res) {
  requireUser(req);
  const wards = db.prepare("SELECT id, lga, name FROM wards ORDER BY name").all();
  const units = db.prepare("SELECT id, ward_id, name, code FROM polling_units ORDER BY code, name").all();
  const agentCounts = db
    .prepare(
      "SELECT role, assign_lga, assign_ward, assign_pu, COUNT(*) AS n FROM people WHERE role IN ('lga_agent','ward_agent','pu_agent') GROUP BY 1, 2, 3, 4"
    )
    .all();
  const count = (role, lga, ward = "", pu = "") =>
    agentCounts
      .filter((c) => c.role === role && c.assign_lga === lga && (!ward || c.assign_ward === ward) && (!pu || c.assign_pu === pu))
      .reduce((t, c) => t + c.n, 0);
  const tree = ADAMAWA_LGAS.map((lga) => ({
    name: lga,
    agents: count("lga_agent", lga),
    wards: wards
      .filter((w) => w.lga === lga)
      .map((w) => ({
        id: w.id,
        name: w.name,
        agents: count("ward_agent", lga, w.name),
        units: units.filter((u) => u.ward_id === w.id).map((u) => ({ ...u, agents: count("pu_agent", lga, w.name, u.name) })),
      })),
  }));
  sendJson(res, 200, { lgas: tree });
}

async function addWards(req, res) {
  requireSuperAdmin(req);
  const body = await readBody(req);
  const lga = clean(body.lga, 80);
  if (!ADAMAWA_LGAS.includes(lga)) throw new HttpError(400, "Unknown local government.");
  const names = [...new Set((Array.isArray(body.names) ? body.names : []).map((n) => clean(n, 120)).filter(Boolean))];
  if (!names.length) throw new HttpError(400, "Type at least one ward name.");
  const insert = db.prepare("INSERT OR IGNORE INTO wards (lga, name) VALUES (?, ?)");
  let added = 0;
  for (const name of names) added += insert.run(lga, name).changes;
  sendJson(res, 201, { added, skipped: names.length - added });
}

async function addUnits(req, res) {
  requireSuperAdmin(req);
  const body = await readBody(req, 500_000);
  const ward = db.prepare("SELECT id FROM wards WHERE id = ?").get(Number(body.wardId));
  if (!ward) throw new HttpError(404, "Ward not found.");
  const units = (Array.isArray(body.units) ? body.units : [])
    .map((u) => ({ name: clean(u.name, 200), code: clean(u.code, 40) }))
    .filter((u) => u.name);
  if (!units.length) throw new HttpError(400, "Type at least one polling unit.");
  const insert = db.prepare("INSERT OR IGNORE INTO polling_units (ward_id, name, code) VALUES (?, ?, ?)");
  let added = 0;
  for (const u of units) added += insert.run(ward.id, u.name, u.code).changes;
  sendJson(res, 201, { added, skipped: units.length - added });
}

function deleteWard(req, res, id) {
  requireSuperAdmin(req);
  const ward = db.prepare("SELECT lga, name FROM wards WHERE id = ?").get(id);
  if (!ward) throw new HttpError(404, "Ward not found.");
  const agents = db
    .prepare("SELECT COUNT(*) AS n FROM people WHERE role IN ('ward_agent','pu_agent') AND assign_lga = ? AND assign_ward = ?")
    .get(ward.lga, ward.name).n;
  if (agents) throw new HttpError(409, `${agents} agent(s) are assigned to this ward. Remove them first.`);
  db.prepare("DELETE FROM wards WHERE id = ?").run(id);
  sendJson(res, 200, { ok: true });
}

function deleteUnit(req, res, id) {
  requireSuperAdmin(req);
  const unit = db
    .prepare("SELECT u.name, w.lga, w.name AS ward FROM polling_units u JOIN wards w ON w.id = u.ward_id WHERE u.id = ?")
    .get(id);
  if (!unit) throw new HttpError(404, "Polling unit not found.");
  const agents = db
    .prepare("SELECT COUNT(*) AS n FROM people WHERE role = 'pu_agent' AND assign_lga = ? AND assign_ward = ? AND assign_pu = ?")
    .get(unit.lga, unit.ward, unit.name).n;
  if (agents) throw new HttpError(409, `${agents} agent(s) are assigned to this polling unit. Remove them first.`);
  db.prepare("DELETE FROM polling_units WHERE id = ?").run(id);
  sendJson(res, 200, { ok: true });
}

// The agent an Excel template is made for: yourself, or someone under you.
function templateOwner(req, res, id) {
  const user = requireUser(req);
  const person = db.prepare(`SELECT ${PUBLIC_FIELDS}, path FROM people WHERE id = ?`).get(id);
  if (!person || person.role === "supporter" || (person.id !== user.id && !person.path.startsWith(user.path))) {
    throw new HttpError(404, "Agent not found.");
  }
  delete person.path;
  sendJson(res, 200, { person });
}

function listPeople(req, res, url) {
  const user = requireUser(req);
  const where = ["p.path LIKE ?", "p.id != ?"];
  const params = [`${user.path}%`, user.id];

  const role = url.searchParams.get("role");
  if (role === "agents") where.push("p.role IN ('lga_agent','ward_agent','pu_agent')");
  else if (ROLES.includes(role)) {
    where.push("p.role = ?");
    params.push(role);
  }
  const under = Number(url.searchParams.get("under"));
  if (under) {
    const agent = db.prepare("SELECT path FROM people WHERE id = ?").get(under);
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
  const total = db.prepare(`SELECT COUNT(*) AS n FROM people p WHERE ${whereSql}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT ${PUBLIC_FIELDS.split(", ").map((f) => "p." + f).join(", ")}, a.full_name AS added_by_name
       FROM people p LEFT JOIN people a ON a.id = p.added_by
       WHERE ${whereSql}
       ORDER BY p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  sendJson(res, 200, { total, page, pageSize, rows });
}

function deletePerson(req, res, id) {
  const user = requireUser(req);
  const target = db.prepare("SELECT id, path, added_by FROM people WHERE id = ?").get(id);
  if (!target || target.id === user.id || !target.path.startsWith(user.path)) throw new HttpError(404, "Person not found.");
  const parent = db.prepare("SELECT path FROM people WHERE id = ?").get(target.added_by);
  db.exec("BEGIN");
  try {
    // Anyone this person added moves up to whoever added them, so nobody is lost.
    db.prepare("UPDATE people SET added_by = ? WHERE added_by = ?").run(target.added_by, target.id);
    db.prepare("UPDATE people SET path = ? || substr(path, ?) WHERE path LIKE ? AND id != ?").run(
      parent.path,
      target.path.length + 1,
      `${target.path}%`,
      target.id
    );
    db.prepare("DELETE FROM sessions WHERE person_id = ?").run(target.id);
    db.prepare("DELETE FROM people WHERE id = ?").run(target.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  sendJson(res, 200, { ok: true });
}

async function resetPassword(req, res, id) {
  const user = requireUser(req);
  const body = await readBody(req);
  const target = db.prepare("SELECT id, path, role FROM people WHERE id = ?").get(id);
  const isSelf = target && target.id === user.id;
  if (!target || (!isSelf && !target.path.startsWith(user.path)) || target.role === "supporter") throw new HttpError(404, "Agent not found.");
  const password = String(body.password || "");
  if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters.");
  db.prepare("UPDATE people SET password_hash = ? WHERE id = ?").run(hashPassword(password), id);
  sendJson(res, 200, { ok: true });
}

function stats(req, res) {
  const user = requireUser(req);
  const scope = `${user.path}%`;
  const counts = Object.fromEntries(
    db
      .prepare("SELECT role, COUNT(*) AS n FROM people WHERE path LIKE ? AND id != ? GROUP BY role")
      .all(scope, user.id)
      .map((r) => [r.role, r.n])
  );
  const verified = db.prepare("SELECT COUNT(*) AS n FROM people WHERE path LIKE ? AND id != ? AND verified = 1").get(scope, user.id).n;
  const byLga = db
    .prepare(
      `SELECT COALESCE(NULLIF(assign_lga, ''), NULLIF(lga, ''), 'Unknown') AS lga, COUNT(*) AS n
       FROM people WHERE path LIKE ? AND id != ? GROUP BY 1 ORDER BY n DESC`
    )
    .all(scope, user.id);
  const recent = db
    .prepare(`SELECT ${PUBLIC_FIELDS} FROM people WHERE path LIKE ? AND id != ? ORDER BY id DESC LIMIT 8`)
    .all(scope, user.id);
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
    byLga,
    recent,
  });
}

// ---------- auth ----------

async function login(req, res) {
  const body = await readBody(req);
  const loginName = clean(body.login, 80).toLowerCase();
  const person = db.prepare("SELECT id, password_hash, role FROM people WHERE login = ?").get(loginName);
  if (!person || person.role === "supporter" || !checkPassword(String(body.password || ""), person.password_hash)) {
    throw new HttpError(401, "Wrong login or password.");
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token, person_id, expires_at) VALUES (?, ?, ?)").run(token, person.id, expires);
  sendJson(res, 200, { ok: true }, {
    "Set-Cookie": `isp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

function logout(req, res) {
  const token = parseCookies(req).isp_session;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  sendJson(res, 200, { ok: true }, { "Set-Cookie": "isp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
}

function me(req, res) {
  const user = requireUser(req);
  delete user.path;
  sendJson(res, 200, { user, canAdd: CAN_ADD[user.role], lgas: ADAMAWA_LGAS });
}

// ---------- landing page content ----------

async function updateContent(req, res) {
  requireSuperAdmin(req);
  const body = await readBody(req, 1_000_000);
  if (!body || typeof body.content !== "object") throw new HttpError(400, "Invalid content.");
  saveContent(body.content);
  sendJson(res, 200, { ok: true });
}

const IMAGE_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/svg+xml": ".svg" };

async function uploadImage(req, res) {
  requireSuperAdmin(req);
  const body = await readBody(req, 12_000_000);
  const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(body.dataUrl || ""));
  if (!match || !IMAGE_TYPES[match[1]]) throw new HttpError(400, "Upload a JPG, PNG, WEBP or SVG image.");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 8_000_000) throw new HttpError(413, "Images must be under 8 MB.");
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${IMAGE_TYPES[match[1]]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  sendJson(res, 201, { url: `/uploads/${name}` });
}

// ---------- static files ----------

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
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    // Uploaded SVGs are served as images only, never run as pages.
    if (pathname.startsWith("/uploads/")) headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- router ----------

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const { pathname } = url;
  const method = req.method;

  if (!pathname.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });
    return serveStatic(req, res, pathname);
  }

  if (method === "POST" && pathname === "/api/login") return login(req, res);
  if (method === "POST" && pathname === "/api/logout") return logout(req, res);
  if (method === "GET" && pathname === "/api/me") return me(req, res);
  if (method === "GET" && pathname === "/api/content") return sendJson(res, 200, { content: getContent() });
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
    if (kind === "template" && method === "GET") return templateOwner(req, res, id);
    if (kind === "imports" && method === "POST" && action) return setImportStatus(req, res, id, action === "/approve" ? "approved" : "rejected");
  }

  if (method === "POST" && pathname === "/api/verify-vin") {
    requireUser(req);
    const body = await readBody(req);
    const vin = cleanVin(body.vin);
    if (!VIN_PATTERN.test(vin)) throw new HttpError(400, "A VIN is 19 letters and numbers. Check the number on the voter's card.");
    const voter = await lookupVin(vin);
    const existing = db.prepare("SELECT full_name, role FROM people WHERE vin = ?").get(vin);
    return sendJson(res, 200, { voter, alreadyRegistered: existing || null });
  }

  const personMatch = /^\/api\/people\/(\d+)(\/password)?$/.exec(pathname);
  if (personMatch) {
    const id = Number(personMatch[1]);
    if (method === "DELETE" && !personMatch[2]) return deletePerson(req, res, id);
    if (method === "PUT" && personMatch[2]) return resetPassword(req, res, id);
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    sendJson(res, 500, { error: "Something went wrong on the server." });
  });
});

server.listen(PORT, () => {
  console.log(`ISP running at http://localhost:${PORT}`);
});
