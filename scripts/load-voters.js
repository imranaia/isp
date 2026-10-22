// Loads the Adamawa voter register into the voters table, so the Verify page can look up a VIN.
//
//   node scripts/load-voters.js voters.tsv            load into the database in TURSO_DATABASE_URL (or data/isp.db)
//   node scripts/load-voters.js voters.tsv --dry-run  only check the file and how its areas match ours
//
// voters.tsv has one voter per line, tab separated: lga, ward, polling unit, S/N, full name, birth year, gender, VIN
// (made from the ward voter-list PDFs). It holds people's personal details: keep it out of this repo.
// Running it again replaces the voters already loaded, so it is safe to repeat.

const fs = require("node:fs");
const readline = require("node:readline");
const adamawaWards = require("../adamawa-wards");
const adamawaUnits = require("../adamawa-pus");

const [file, flag] = process.argv.slice(2);
const dryRun = flag === "--dry-run";
if (!file) {
  console.error("Usage: node scripts/load-voters.js voters.tsv [--dry-run]");
  process.exit(1);
}

const key = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const LGA_ALIASES = { GUYUK: "Gayuk" };
// Wards our list spells differently from the register (register spelling -> ours).
const WARD_ALIASES = { KARLAHI: "Harlahi", KILANGEFUNA: "Kilange Fung", DILLI: "Dili" };

// Our local governments, each with its wards and their polling units, to match the register's names against.
const lgas = new Map();
Object.keys(adamawaWards).forEach((lga, i) => {
  const lgaCode = String(i + 1).padStart(2, "0");
  const units = new Map(); // unit name -> [{ ward, code }]
  const wards = new Map(); // ward name -> ward
  for (const [wardCode, wardName] of adamawaWards[lga]) {
    wards.set(key(wardName), wardName);
    (adamawaUnits[`${lgaCode}-${wardCode}`] || []).forEach((name, n) => {
      const unit = { ward: wardName, name, code: `02/${lgaCode}/${wardCode}/${String(n + 1).padStart(3, "0")}` };
      const k = key(name.replace(/ \(\d+\)$/, ""));
      units.set(k, [...(units.get(k) || []), unit]);
    });
  }
  lgas.set(key(lga), { name: lga, units, wards });
});
for (const [alias, name] of Object.entries(LGA_ALIASES)) lgas.set(alias, lgas.get(key(name)));

// Finds our name and code for the register's polling unit; the ward name decides between units with the same name.
// Where INEC gives two units in a ward the same name, the register lists them one after the other:
// occurrence says which of them this is (1 for the first).
const areaCache = new Map();
function matchArea(lgaText, wardText, puText, occurrence) {
  const cacheKey = `${lgaText}|${wardText}|${puText}|${occurrence}`;
  if (areaCache.has(cacheKey)) return areaCache.get(cacheKey);
  const lga = lgas.get(key(lgaText));
  let area = { lga: lga ? lga.name : lgaText, ward: wardText, polling_unit: puText, polling_unit_code: "", matched: false };
  if (lga) {
    const k = key(puText);
    let candidates = lga.units.get(k) || [];
    // The register often cuts long unit names short: then match on the start of the name.
    if (!candidates.length && k.length >= 8) {
      candidates = [...lga.units].filter(([name]) => name.startsWith(k) || k.startsWith(name)).flatMap(([, units]) => units);
    }
    const wardKey = key(WARD_ALIASES[key(wardText)] || wardText);
    const sameWard = candidates.filter((u) => key(u.ward) === wardKey);
    const choices = sameWard.length ? sameWard : candidates;
    const oneWard = new Set(choices.map((u) => u.ward)).size === 1;
    const unit = choices.length === 1 ? choices[0] : oneWard ? choices[occurrence - 1] : null;
    if (unit) area = { lga: lga.name, ward: unit.ward, polling_unit: unit.name, polling_unit_code: unit.code, matched: true };
    else if (lga.wards.has(wardKey)) area.ward = lga.wards.get(wardKey);
  }
  areaCache.set(cacheKey, area);
  return area;
}

// Some lists print a 19-character VIN with "00" in front; the card itself has the 19 characters.
// INC VINs are kept at exactly 20 characters, as the site's VIN check expects (see cleanVin in server.js).
function normalVin(vin) {
  if (vin.length === 21 && vin.startsWith("00")) return vin.slice(2);
  // An INC VIN is INC, the year (21, 22 …) and a 15-digit serial padded with zeros. Typed with a zero
  // too many or too few, it is rebuilt with exactly 15 digits (no two VINs in the register clash this way).
  const inc = /^INC(\d{2})0*(\d{1,15})$/.exec(vin);
  if (inc && vin.length !== 20) return `INC${inc[1]}${inc[2].padStart(15, "0")}`;
  return vin;
}

async function main() {
  const voters = new Map();
  let lines = 0;
  let skipped = 0;
  const unmatched = new Map();
  const sections = new Map(); // "lga|ward|unit" -> how many times a list for it has started (S/N 1)
  const input = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    lines++;
    const [lga, ward, pu, serial, fullName, birthYear, gender, rawVin] = line.split("\t");
    const sectionKey = `${lga}|${ward}|${pu}`;
    if (serial === "1" || !sections.has(sectionKey)) sections.set(sectionKey, (sections.get(sectionKey) || 0) + 1);
    const vin = normalVin(String(rawVin || "").trim().toUpperCase());
    if (!/^[A-Z0-9]{18,21}$/.test(vin) || !fullName) {
      skipped++;
      continue;
    }
    if (voters.has(vin)) continue;
    const area = matchArea(lga, ward, pu, sections.get(sectionKey));
    if (!area.matched) unmatched.set(`${area.lga} / ${ward} / ${pu}`, (unmatched.get(`${area.lga} / ${ward} / ${pu}`) || 0) + 1);
    voters.set(vin, [vin, fullName.trim(), gender === "F" ? "Female" : gender === "M" ? "Male" : "", birthYear || "", area.lga, area.ward, area.polling_unit, area.polling_unit_code]);
  }

  const notMatched = [...unmatched.values()].reduce((a, b) => a + b, 0);
  console.log(`${lines.toLocaleString()} lines, ${voters.size.toLocaleString()} voters, ${(lines - voters.size - skipped).toLocaleString()} repeats, ${skipped} skipped (bad VIN)`);
  console.log(`${notMatched.toLocaleString()} voters in ${unmatched.size} polling units that don't match our list (kept with the register's names, no PU code)`);
  [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([name, n]) => console.log(`  ${n}\t${name}`));
  if (dryRun) return;

  // Only the voters table is needed here, so the site's own start-up (admins and so on) is left alone.
  const { db, VOTERS_TABLE } = require("../db");
  await db.prepare(VOTERS_TABLE).run();
  const rows = [...voters.values()];
  const perStatement = 500;
  const perRequest = 10;
  const started = Date.now();
  for (let i = 0; i < rows.length; i += perStatement * perRequest) {
    const statements = [];
    for (let j = i; j < Math.min(i + perStatement * perRequest, rows.length); j += perStatement) {
      const chunk = rows.slice(j, j + perStatement);
      statements.push([
        `INSERT OR REPLACE INTO voters (vin, full_name, gender, birth_year, lga, ward, polling_unit, polling_unit_code) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?)").join(",")}`,
        chunk.flat(),
      ]);
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await db.batch(statements);
        break;
      } catch (err) {
        if (attempt === 5) throw err;
        console.log(`  retrying after: ${err.message}`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    const done = Math.min(i + perStatement * perRequest, rows.length);
    if (done % 100_000 < perStatement * perRequest || done === rows.length) {
      console.log(`  ${done.toLocaleString()} / ${rows.length.toLocaleString()} loaded (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM voters").get();
  console.log(`Done. The voters table now has ${n.toLocaleString()} voters.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
