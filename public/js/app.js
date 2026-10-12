// ISP dashboard: one page, each sidebar item swaps the view.

const ROLE_LABEL = {
  super_admin: "Super Admin",
  lga_agent: "LGA Agent",
  ward_agent: "Ward Agent",
  pu_agent: "Polling Unit Agent",
  supporter: "Supporter",
};
const AGENT_ROLES = ["lga_agent", "ward_agent", "pu_agent"];

const state = { user: null, canAdd: [], lgas: [], locations: [] };
const view = document.getElementById("view");

// ---------- small helpers ----------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.replace("/login?expired=1");
    throw new Error("Please sign in.");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

function ask({ title, text, okText = "OK", danger = false, input = null }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const yes = document.getElementById("confirmYes");
    const no = document.getElementById("confirmNo");
    const field = document.getElementById("confirmInput");
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmText").textContent = text;
    yes.textContent = okText;
    yes.style.background = danger ? "#b42318" : "";
    field.hidden = !input;
    field.value = "";
    if (input) Object.assign(field, input);
    modal.hidden = false;
    if (input) field.focus();
    const done = (ok) => {
      modal.hidden = true;
      yes.onclick = no.onclick = null;
      resolve(ok ? (input ? field.value : true) : false);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
  });
}

function setHeader(title, sub = "", actions = "") {
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSub").textContent = sub;
  document.getElementById("topActions").innerHTML = actions;
  document.title = `${title} · Independent Structure Platform (ISP)`;
}

function areaText(p) {
  return [p.assign_lga, p.assign_ward, p.assign_pu].filter(Boolean).join(" › ");
}

function scopeText(user) {
  if (user.role === "super_admin") return "All of Adamawa State";
  return areaText(user);
}

// ---------- navigation ----------

const NAV = [
  { group: "Overview" },
  { id: "dashboard", label: "Dashboard", icon: "◧" },
  { id: "verify", label: "Verify Voter's Card", icon: "✓" },
  { group: "Structure" },
  { id: "lga_agent", label: "LGA Agents", icon: "▣", needs: "lga_agent" },
  { id: "ward_agent", label: "Ward Agents", icon: "▤", needs: "ward_agent" },
  { id: "pu_agent", label: "Polling Unit Agents", icon: "▥", needs: "pu_agent" },
  { id: "supporter", label: "Supporters", icon: "☺", needs: "supporter" },
  { group: "Data" },
  { id: "all", label: "All Records", icon: "☰", hideFor: ["pu_agent"] },
  { id: "import", label: "Import from Excel", icon: "⇪", needs: "supporter" },
  { id: "uploads", label: "Uploads", icon: "⇅" },
  { id: "locations", label: "Locations", icon: "⌖", only: "super_admin" },
  { group: "Website", only: "super_admin" },
  { id: "landing", label: "Edit Landing Page", icon: "✎", only: "super_admin" },
  { group: "Account" },
  { id: "account", label: "My Account", icon: "⚙" },
];

function visibleNav() {
  const role = state.user.role;
  return NAV.filter((item) => {
    if (item.only && item.only !== role) return false;
    if (item.needs && !state.canAdd.includes(item.needs)) return false;
    if (item.hideFor && item.hideFor.includes(role)) return false;
    return true;
  });
}

function renderNav() {
  const items = visibleNav();
  document.getElementById("sideNav").innerHTML = items
    .map((item) =>
      item.group
        ? `<div class="side-group">${esc(item.group)}</div>`
        : `<a href="#${item.id}" data-view="${item.id}"><span class="ico">${item.icon}</span>${esc(item.label)}</a>`
    )
    .join("");
}

function route() {
  const id = location.hash.slice(1) || "dashboard";
  const allowed = visibleNav().some((item) => item.id === id);
  const target = allowed ? id : "dashboard";
  document.querySelectorAll("#sideNav a").forEach((a) => a.classList.toggle("active", a.dataset.view === target));
  document.getElementById("sidebar").classList.remove("open");
  const views = {
    dashboard: showDashboard,
    verify: showVerify,
    all: () => showPeople("all"),
    import: showImport,
    uploads: showUploads,
    locations: showLocations,
    landing: showLanding,
    account: showAccount,
  };
  (views[target] || (() => showPeople(target)))();
  scrollTo(0, 0);
}

// ---------- dashboard ----------

// Each role gets its own dashboard: a welcome banner with their area and shortcuts,
// the counts that matter at their level, and their people broken down by the level below.
const DASHBOARD_INTRO = {
  super_admin: "You control the whole platform: the landing page, locations, every agent and every record.",
  lga_agent: "You are in charge of this local government. Add ward agents, polling unit agents and supporters.",
  ward_agent: "You are in charge of this ward. Add polling unit agents and supporters.",
  pu_agent: "You are in charge of this polling unit. Add the people who will vote for Haske.",
};

async function showDashboard() {
  const me = state.user;
  const role = me.role;
  setHeader("Dashboard", `${ROLE_LABEL[role]} · ${scopeText(me)}`);
  view.innerHTML = `<div class="empty">Loading…</div>`;
  const s = await api("/api/stats");

  const cards = {
    super_admin: [
      { label: "Total Agents", value: s.totalAgents, note: "All agent levels", feature: true },
      { label: "LGA Agents", value: s.lgaAgents, note: "In charge of a local government" },
      { label: "Ward Agents", value: s.wardAgents, note: "In charge of a ward" },
      { label: "Polling Unit Agents", value: s.puAgents, note: "In charge of a polling unit" },
      { label: "Supporters", value: s.supporters, note: "People who will vote" },
      { label: "Verified Cards", value: s.verified, note: "Checked against the voter register" },
    ],
    lga_agent: [
      { label: "Agents under you", value: s.totalAgents, note: `In ${me.assign_lga}`, feature: true },
      { label: "Ward Agents", value: s.wardAgents, note: "In charge of a ward" },
      { label: "Polling Unit Agents", value: s.puAgents, note: "In charge of a polling unit" },
      { label: "Supporters", value: s.supporters, note: `Across ${me.assign_lga}` },
      { label: "Added this week", value: s.thisWeek, note: "New supporters, last 7 days" },
      { label: "Verified Cards", value: s.verified, note: "Checked against the voter register" },
    ],
    ward_agent: [
      { label: "Polling Unit Agents", value: s.puAgents, note: `In ${me.assign_ward}`, feature: true },
      { label: "Supporters", value: s.supporters, note: `Across ${me.assign_ward}` },
      { label: "Added this week", value: s.thisWeek, note: "New supporters, last 7 days" },
      { label: "Verified Cards", value: s.verified, note: "Checked against the voter register" },
    ],
    pu_agent: [
      { label: "My Supporters", value: s.supporters, note: me.assign_pu, feature: true },
      { label: "Added this week", value: s.thisWeek, note: "New supporters, last 7 days" },
      { label: "Verified Cards", value: s.verified, note: "Checked against the voter register" },
    ],
  }[role];

  const quick = [
    `<a class="btn btn-gold" href="#verify">✓ Verify a voter's card</a>`,
    state.canAdd.includes("supporter") ? `<button class="btn btn-outline" data-quick-add="supporter">+ Add supporter</button>` : "",
    role === "super_admin" ? `<a class="btn btn-outline" href="#locations">⌖ Locations</a>` : "",
    role !== "super_admin" ? `<button class="btn btn-outline" id="myTemplate">⬇ My Excel template</button>` : "",
  ].join("");

  const max = Math.max(1, ...s.breakdown.map((r) => r.n));
  const breakdownCard =
    role === "pu_agent"
      ? ""
      : `<div class="card">
          <div class="card-head"><h2>People by ${esc(s.breakdownLabel)}</h2></div>
          ${
            s.breakdown.length
              ? `<div class="bars">${s.breakdown
                  .map(
                    (r) =>
                      `<div class="bar-row"><span title="${esc(r.name)}">${esc(r.name)}</span><div class="bar-track"><div class="bar-fill" style="width:0" data-w="${(r.n / max) * 100}"></div></div><b>${r.n}</b></div>`
                  )
                  .join("")}</div>`
              : `<div class="empty">No one has been added yet.</div>`
          }
        </div>`;

  view.innerHTML = `
    <div class="welcome">
      <div>
        <small>${ROLE_LABEL[role]}</small>
        <h2>Welcome, ${esc(me.full_name)}</h2>
        <p>${esc(scopeText(me))} · ${esc(DASHBOARD_INTRO[role])}</p>
      </div>
      <div class="quick">${quick}</div>
    </div>
    <div class="stats">
      ${cards
        .map((c) => `<div class="stat ${c.feature ? "feature" : ""}"><span>${c.label}</span><strong data-count="${c.value}">0</strong><small>${esc(c.note || "")}</small></div>`)
        .join("")}
    </div>
    <div class="${role === "pu_agent" ? "" : "two-col"}">
      ${breakdownCard}
      <div class="card">
        <div class="card-head"><h2>${role === "pu_agent" ? "My latest supporters" : "Recently added"}</h2><a class="btn btn-outline btn-small" href="#${role === "pu_agent" ? "supporter" : "all"}">View all</a></div>
        ${
          s.recent.length
            ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>${role === "pu_agent" ? "Polling unit" : "Area"}</th><th>Added</th></tr></thead><tbody>${s.recent
                .map(
                  (p) =>
                    `<tr><td>${esc(p.full_name)}</td><td><span class="pill pill-${p.role}">${ROLE_LABEL[p.role]}</span></td><td>${esc(areaText(p) || p.lga || "—")}</td><td>${esc((p.created_at || "").slice(0, 10))}</td></tr>`
                )
                .join("")}</tbody></table></div>`
            : `<div class="empty">${role === "pu_agent" ? "Add your first supporter to get started." : "Start by adding agents or verifying a voter's card."}</div>`
        }
      </div>
    </div>`;

  view.querySelector("[data-quick-add]")?.addEventListener("click", () => openPersonModal("supporter"));
  document.getElementById("myTemplate")?.addEventListener("click", () => downloadTemplateFor(me.id));

  // Count-up numbers and grow the bars.
  view.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / 700, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  requestAnimationFrame(() => view.querySelectorAll(".bar-fill").forEach((b) => (b.style.width = `${b.dataset.w}%`)));
}

// ---------- verify VIN ----------

const DETAIL_FIELDS = [
  ["vin", "VIN"],
  ["gender", "Gender"],
  ["date_of_birth", "Date of birth"],
  ["occupation", "Occupation"],
  ["phone", "Phone"],
  ["address", "Address"],
  ["state", "State"],
  ["lga", "Local government"],
  ["ward", "Ward"],
  ["polling_unit", "Polling unit"],
  ["polling_unit_code", "Polling unit code"],
  ["registered_on", "Registered on"],
];

function showVerify() {
  setHeader("Verify Voter's Card", "Enter a VIN to see the voter's registration details.");
  view.innerHTML = `
    <div class="card verify-box">
      <form id="verifyForm">
        <label for="vvin" style="font-weight:700;display:block;margin-bottom:8px">Voter Identification Number (VIN)</label>
        <div class="vin-row">
          <input id="vvin" maxlength="23" placeholder="e.g. 90F5B1407E296460333" autocomplete="off" autofocus>
          <button class="btn btn-primary" id="vbtn">Verify</button>
        </div>
        <p class="hint">19 letters and numbers, printed on the voter's card.</p>
      </form>
      <div id="vresult"></div>
    </div>`;
  document.getElementById("verifyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("vresult");
    const btn = document.getElementById("vbtn");
    const vin = document.getElementById("vvin").value.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{19}$/.test(vin)) {
      out.innerHTML = `<div class="alert alert-error">A VIN is 19 letters and numbers. Check the number on the voter's card.</div>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Checking…";
    out.innerHTML = "";
    try {
      const { voter, alreadyRegistered } = await api("/api/verify-vin", { method: "POST", body: { vin } });
      const card = { ...voter, vin };
      const addButtons = state.canAdd
        .map((role) => `<button class="btn ${role === "supporter" ? "btn-primary" : "btn-outline"}" data-add="${role}">Add as ${ROLE_LABEL[role]}</button>`)
        .join("");
      out.innerHTML = `
        <div class="voter-card">
          <div class="voter-card-head"><h3>${esc(voter.full_name || "Name not provided")}</h3><span class="pill">Record found</span></div>
          <dl class="details">${DETAIL_FIELDS.filter(([k]) => card[k])
            .map(([k, label]) => `<dt>${label}</dt><dd>${esc(card[k])}</dd>`)
            .join("")}</dl>
          ${
            alreadyRegistered
              ? `<div class="voter-card-foot"><div class="alert alert-warn" style="margin:0">Already in the system as ${esc(ROLE_LABEL[alreadyRegistered.role])}: ${esc(alreadyRegistered.full_name)}.</div></div>`
              : `<div class="voter-card-foot">${addButtons}</div>`
          }
        </div>`;
      out.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => openPersonModal(b.dataset.add, card)));
    } catch (err) {
      out.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Verify";
    }
  });
}

// ---------- people tables ----------

const PEOPLE_VIEWS = {
  lga_agent: { title: "LGA Agents", sub: "People in charge of a whole local government." },
  ward_agent: { title: "Ward Agents", sub: "People in charge of a ward." },
  pu_agent: { title: "Polling Unit Agents", sub: "People in charge of a polling unit." },
  supporter: { title: "Supporters", sub: "People who have said they will vote for Haske." },
  all: { title: "All Records", sub: "Everyone in your structure." },
};

const tableState = { role: null, q: "", lga: "", page: 1, filterRole: "" };

function showPeople(role) {
  const cfg = PEOPLE_VIEWS[role];
  if (!cfg) return showDashboard();
  if (tableState.role !== role) Object.assign(tableState, { role, q: "", lga: "", page: 1, filterRole: "" });
  const canAddThis = role !== "all" && state.canAdd.includes(role);
  setHeader(
    cfg.title,
    `${cfg.sub} Area: ${scopeText(state.user)}`,
    `<button class="btn btn-outline" id="printBtn">🖨 Print</button><button class="btn btn-outline" id="exportBtn">Export Excel</button>${canAddThis ? `<button class="btn btn-gold" id="addBtn">+ Add ${ROLE_LABEL[role]}</button>` : ""}`
  );
  view.innerHTML = `
    <div class="card">
      <div class="filters">
        <input id="fq" placeholder="Search name, VIN, phone, ward or polling unit" value="${esc(tableState.q)}">
        <select id="flga"><option value="">All local governments</option>${state.lgas.map((l) => `<option ${l === tableState.lga ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        ${
          role === "all"
            ? `<select id="frole"><option value="">Everyone</option>${["lga_agent", "ward_agent", "pu_agent", "supporter"]
                .filter((r) => r === "supporter" || state.canAdd.includes(r))
                .map((r) => `<option value="${r}" ${r === tableState.filterRole ? "selected" : ""}>${ROLE_LABEL[r]}s</option>`)
                .join("")}</select>`
            : ""
        }
      </div>
      <div id="tableBox"><div class="empty">Loading…</div></div>
    </div>`;

  let timer;
  document.getElementById("fq").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      tableState.q = e.target.value;
      tableState.page = 1;
      loadTable();
    }, 300);
  });
  document.getElementById("flga").addEventListener("change", (e) => {
    tableState.lga = e.target.value;
    tableState.page = 1;
    loadTable();
  });
  document.getElementById("frole")?.addEventListener("change", (e) => {
    tableState.filterRole = e.target.value;
    tableState.page = 1;
    loadTable();
  });
  document.getElementById("addBtn")?.addEventListener("click", () => openPersonModal(role));
  document.getElementById("exportBtn").addEventListener("click", exportTable);
  document.getElementById("printBtn").addEventListener("click", printTable);
  loadTable();
}

function tableQuery(extra = {}) {
  const role = tableState.role === "all" ? tableState.filterRole : tableState.role;
  const params = new URLSearchParams({ page: tableState.page, size: 25, ...extra });
  if (role) params.set("role", role);
  if (tableState.q) params.set("q", tableState.q);
  if (tableState.lga) params.set("lga", tableState.lga);
  return `/api/people?${params}`;
}

async function loadTable() {
  const box = document.getElementById("tableBox");
  if (!box) return;
  try {
    const data = await api(tableQuery());
    const isAgents = AGENT_ROLES.includes(tableState.role);
    const showRole = tableState.role === "all";
    if (!data.rows.length) {
      box.innerHTML = `<div class="empty">No records found.</div>`;
      return;
    }
    box.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Name</th>${showRole ? "<th>Role</th>" : ""}${isAgents ? "<th>In charge of</th><th>Login</th>" : ""}
          <th>VIN</th><th>Gender</th><th>LGA</th><th>Ward</th><th>Polling unit</th><th>PU code</th><th>Phone</th><th>Verified</th><th>Added by</th><th>Date</th><th></th>
        </tr></thead>
        <tbody>${data.rows
          .map(
            (p) => `<tr>
              <td><strong>${esc(p.full_name)}</strong></td>
              ${showRole ? `<td><span class="pill pill-${p.role}">${ROLE_LABEL[p.role]}</span></td>` : ""}
              ${isAgents ? `<td>${esc(areaText(p))}</td><td class="mono">${esc(p.login)}</td>` : ""}
              <td class="mono">${esc(p.vin || "—")}</td>
              <td>${esc(p.gender)}</td>
              <td>${esc(p.lga)}</td>
              <td>${esc(p.ward)}</td>
              <td class="wrap">${esc(p.polling_unit)}</td>
              <td class="mono">${esc(p.polling_unit_code)}</td>
              <td>${esc(p.phone)}</td>
              <td><span class="pill ${p.verified ? "pill-yes" : "pill-no"}">${p.verified ? "Yes" : "No"}</span></td>
              <td>${esc(p.added_by_name)}</td>
              <td>${esc((p.created_at || "").slice(0, 10))}</td>
              <td>
                ${AGENT_ROLES.includes(p.role) ? `<button class="btn btn-outline btn-small" data-template="${p.id}">Excel template</button> <button class="btn btn-outline btn-small" data-print-agent="${p.id}">Print list</button> <button class="btn btn-outline btn-small" data-reset="${p.id}" data-name="${esc(p.full_name)}">Reset password</button>` : ""}
                <button class="btn btn-danger" data-del="${p.id}" data-name="${esc(p.full_name)}" data-role="${p.role}">Remove</button>
              </td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>
      <div class="pager">
        <span>Showing ${(data.page - 1) * data.pageSize + 1}–${(data.page - 1) * data.pageSize + data.rows.length} of ${data.total.toLocaleString()}</span>
        <div>
          <button class="btn btn-outline btn-small" id="prevPage" ${data.page <= 1 ? "disabled" : ""}>← Previous</button>
          <button class="btn btn-outline btn-small" id="nextPage" ${data.page * data.pageSize >= data.total ? "disabled" : ""}>Next →</button>
        </div>
      </div>`;
    document.getElementById("prevPage").onclick = () => {
      tableState.page--;
      loadTable();
    };
    document.getElementById("nextPage").onclick = () => {
      tableState.page++;
      loadTable();
    };
    box.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const agentNote = AGENT_ROLES.includes(b.dataset.role) ? " Anyone they added will move up to the person above them." : "";
        const ok = await ask({ title: `Remove ${b.dataset.name}?`, text: `This deletes their record.${agentNote}`, okText: "Remove", danger: true });
        if (!ok) return;
        try {
          await api(`/api/people/${b.dataset.del}`, { method: "DELETE" });
          toast(`${b.dataset.name} removed`);
          loadTable();
        } catch (err) {
          toast(err.message);
        }
      })
    );
    box.querySelectorAll("[data-template]").forEach((b) => b.addEventListener("click", () => downloadTemplateFor(Number(b.dataset.template))));
    box.querySelectorAll("[data-print-agent]").forEach((b) => b.addEventListener("click", () => printAgentList(Number(b.dataset.printAgent))));
    box.querySelectorAll("[data-reset]").forEach((b) =>
      b.addEventListener("click", async () => {
        const password = await ask({
          title: `New password for ${b.dataset.name}`,
          text: "At least 4 characters. Give it to the agent.",
          okText: "Set password",
          input: { type: "text", placeholder: "New password" },
        });
        if (!password) return;
        try {
          await api(`/api/people/${b.dataset.reset}/password`, { method: "PUT", body: { password } });
          toast("Password changed");
        } catch (err) {
          toast(err.message);
        }
      })
    );
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

const EXPORT_COLUMNS = [
  ["full_name", "Full Name"],
  ["role", "Role"],
  ["vin", "VIN"],
  ["gender", "Gender"],
  ["date_of_birth", "Date of Birth"],
  ["phone", "Phone"],
  ["occupation", "Occupation"],
  ["address", "Address"],
  ["lga", "LGA"],
  ["ward", "Ward"],
  ["polling_unit", "Polling Unit"],
  ["polling_unit_code", "Polling Unit Code"],
  ["assign_lga", "In Charge Of (LGA)"],
  ["assign_ward", "In Charge Of (Ward)"],
  ["assign_pu", "In Charge Of (Polling Unit)"],
  ["verified", "Verified"],
  ["added_by_name", "Added By"],
  ["created_at", "Date Added"],
];

async function exportTable() {
  if (!window.XLSX) return toast("The Excel tool is still loading. Try again in a moment.");
  toast("Preparing Excel file…");
  const data = await api(tableQuery({ page: 1, size: 5000 }));
  const rows = data.rows.map((p) =>
    Object.fromEntries(EXPORT_COLUMNS.map(([k, label]) => [label, k === "role" ? ROLE_LABEL[p.role] : k === "verified" ? (p.verified ? "Yes" : "No") : p[k] ?? ""]))
  );
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Records");
  XLSX.writeFile(book, `ISP-${PEOPLE_VIEWS[tableState.role].title.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- add person modal ----------

const personModal = document.getElementById("personModal");
const personForm = document.getElementById("personForm");
let personRole = null;

function openPersonModal(role, card = null) {
  personRole = role;
  personForm.reset();
  document.getElementById("personError").hidden = true;
  document.getElementById("personTitle").textContent = `Add ${ROLE_LABEL[role]}`;
  document.getElementById("vinHint").textContent = "Enter the VIN and click Fetch details to fill the form from the voter's card.";

  const isAgent = AGENT_ROLES.includes(role);
  document.getElementById("assignBox").hidden = !isAgent;
  document.getElementById("loginBox").hidden = !isAgent;
  document.getElementById("assignWardWrap").hidden = role === "lga_agent";
  document.getElementById("assignPuWrap").hidden = role !== "pu_agent";

  const me = state.user;
  const lgaSelect = document.getElementById("assignLga");
  const wardSelect = document.getElementById("assignWard");
  lgaSelect.innerHTML = `<option value="">Choose local government…</option>` + state.lgas.map((l) => `<option>${esc(l)}</option>`).join("");
  lgaSelect.disabled = wardSelect.disabled = false;
  if (me.role === "lga_agent" || me.role === "ward_agent") {
    lgaSelect.value = me.assign_lga;
    lgaSelect.disabled = true;
  }
  fillWardOptions();
  if (me.role === "ward_agent") {
    wardSelect.value = me.assign_ward;
    wardSelect.disabled = true;
  }
  fillUnitOptions();
  if (card) fillFromCard(card);
  personModal.hidden = false;
  setTimeout(() => document.getElementById("pVin").focus(), 50);
}

function fillFromCard(card) {
  for (const [key, value] of Object.entries(card)) {
    const input = personForm.elements[key];
    if (input && value && key !== "assign_lga") input.value = value;
  }
  document.getElementById("vinHint").textContent = "✓ Details filled from the voter's card.";
  // Suggest the agent's area from their own card, if it isn't already fixed.
  const lgaSelect = document.getElementById("assignLga");
  if (!lgaSelect.disabled && !lgaSelect.value) {
    const match = state.lgas.find((l) => l.toLowerCase() === String(card.lga || "").toLowerCase());
    if (match) lgaSelect.value = match;
  }
  fillWardOptions();
  const ward = document.getElementById("assignWard");
  if (!ward.disabled && !ward.value && card.ward) {
    const match = [...ward.options].find((o) => o.value && o.value.toLowerCase() === String(card.ward).toLowerCase());
    if (match) ward.value = match.value;
  }
  fillUnitOptions();
  const pu = document.getElementById("assignPu");
  if (!pu.value && (card.polling_unit_code || card.polling_unit)) {
    const match = [...pu.options].find(
      (o) => o.value && (o.dataset.code === card.polling_unit_code || o.value.toLowerCase() === String(card.polling_unit).toLowerCase())
    );
    if (match) pu.value = match.value;
  }
}

function lgaTree(name) {
  return state.locations.find((l) => l.name === name);
}

function fillWardOptions() {
  const lga = document.getElementById("assignLga").value;
  const select = document.getElementById("assignWard");
  if (select.disabled) return;
  const keep = select.value;
  const wards = lgaTree(lga)?.wards || [];
  select.innerHTML =
    `<option value="">${lga ? (wards.length ? "Choose ward…" : "No wards yet") : "Choose a local government first"}</option>` +
    wards.map((w) => `<option>${esc(w.name)}</option>`).join("");
  if (wards.some((w) => w.name === keep)) select.value = keep;
  updateAssignHint();
}

function fillUnitOptions() {
  const lga = document.getElementById("assignLga").value;
  const ward = document.getElementById("assignWard").value;
  const select = document.getElementById("assignPu");
  const keep = select.value;
  const units = lgaTree(lga)?.wards.find((w) => w.name === ward)?.units || [];
  select.innerHTML =
    `<option value="">${ward ? (units.length ? "Choose polling unit…" : "No polling units yet") : "Choose a ward first"}</option>` +
    units.map((u) => `<option value="${esc(u.name)}" data-code="${esc(u.code)}">${esc(u.code ? `${u.code} — ${u.name}` : u.name)}</option>`).join("");
  if (units.some((u) => u.name === keep)) select.value = keep;
  updateAssignHint();
}

function updateAssignHint() {
  const hint = document.getElementById("assignHint");
  const lga = document.getElementById("assignLga").value;
  const ward = document.getElementById("assignWard").value;
  const tree = lgaTree(lga);
  let text = "";
  if (personRole !== "lga_agent" && lga && tree && !tree.wards.length) text = `${lga} has no wards yet.`;
  else if (personRole === "pu_agent" && ward && !tree?.wards.find((w) => w.name === ward)?.units.length) text = `${ward} has no polling units yet.`;
  if (text) text += state.user.role === "super_admin" ? " Add them on the Locations page first." : " Ask the super admin to add them on the Locations page.";
  hint.textContent = text;
}

document.getElementById("assignLga").addEventListener("change", () => {
  fillWardOptions();
  fillUnitOptions();
});
document.getElementById("assignWard").addEventListener("change", fillUnitOptions);

document.getElementById("fetchVin").addEventListener("click", async () => {
  const btn = document.getElementById("fetchVin");
  const hint = document.getElementById("vinHint");
  const vin = document.getElementById("pVin").value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{19}$/.test(vin)) {
    hint.textContent = "A VIN is 19 letters and numbers.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Fetching…";
  try {
    const { voter, alreadyRegistered } = await api("/api/verify-vin", { method: "POST", body: { vin } });
    fillFromCard({ ...voter, vin });
    if (alreadyRegistered) hint.textContent = `⚠ Already registered as ${ROLE_LABEL[alreadyRegistered.role]}: ${alreadyRegistered.full_name}.`;
  } catch (err) {
    hint.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Fetch details";
  }
});

personModal.addEventListener("click", (e) => {
  if (e.target === personModal || e.target.closest("[data-close]")) personModal.hidden = true;
});

personForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("personError");
  errorBox.hidden = true;
  const body = { role: personRole };
  for (const el of personForm.elements) {
    if (el.name) body[el.name] = el.value;
  }
  const btn = document.getElementById("personSubmit");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const { person } = await api("/api/people", { method: "POST", body });
    personModal.hidden = true;
    toast(`${person.full_name} added as ${ROLE_LABEL[person.role]}`);
    if (location.hash.slice(1) === personRole) loadTable();
    else location.hash = personRole;
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
});

// ---------- Excel import ----------

const TEMPLATE_COLUMNS = ["Full Name", "VIN", "Gender", "Date of Birth", "Phone", "Occupation", "Address", "LGA", "Ward", "Polling Unit", "Polling Unit Code"];
const HEADER_MAP = {
  fullname: "full_name", name: "full_name", names: "full_name",
  vin: "vin", votersidentificationnumber: "vin", voteridentificationnumber: "vin", voterscardnumber: "vin", votercardnumber: "vin", pvc: "vin",
  gender: "gender", sex: "gender",
  dateofbirth: "date_of_birth", dob: "date_of_birth",
  phone: "phone", phonenumber: "phone", mobile: "phone", gsm: "phone",
  occupation: "occupation",
  address: "address",
  lga: "lga", localgovernment: "lga", localgovernmentarea: "lga",
  ward: "ward", registrationarea: "ward",
  pollingunit: "polling_unit", pu: "polling_unit",
  pollingunitcode: "polling_unit_code", pucode: "polling_unit_code",
};

function downloadTemplate() {
  return downloadTemplateFor(state.user.id);
}

function showImport() {
  setHeader("Import from Excel", "Upload many supporters at once using the ISP template.");
  view.innerHTML = `
    <div class="steps">
      <div class="step">
        <span class="step-num">1</span>
        <h3>Download your template</h3>
        <p>An Excel file made for you: it carries your name, role and area, so every upload is credited to you. Agents' own templates are on their rows in the agent tables.</p>
        <button class="btn btn-outline" id="tplBtn">⬇ Download my template</button>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <h3>Fill it in</h3>
        <p>One supporter per row: name, VIN, gender, phone, LGA, ward, polling unit and so on.</p>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <h3>Upload it</h3>
        <p>Everyone in the file is added as a supporter under the agent named in the file. You can upload your own file or one for an agent under you.</p>
        <label class="drop" id="drop"><input type="file" id="fileInput" accept=".xlsx,.xls,.csv">Click to choose a file, or drop it here</label>
      </div>
    </div>
    <div id="importOut"></div>`;
  document.getElementById("tplBtn").addEventListener("click", downloadTemplate);
  const drop = document.getElementById("drop");
  const input = document.getElementById("fileInput");
  input.addEventListener("change", () => input.files[0] && readImportFile(input.files[0]));
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer.files[0]) readImportFile(e.dataTransfer.files[0]);
  });
}

// Builds an agent's own template: their details at the top, then the columns to fill.
// The "Agent ID" line tells the system whose people these are when the file comes back.
async function downloadTemplateFor(agentId) {
  if (!window.XLSX) return toast("The Excel tool is still loading. Try again in a moment.");
  let agent;
  try {
    agent = agentId === state.user.id ? state.user : (await api(`/api/template/${agentId}`)).person;
  } catch (err) {
    return toast(err.message);
  }
  const header = [
    ["INDEPENDENT STRUCTURE PLATFORM (ISP) · HASKE 2027"],
    ["Supporters list"],
    ["Agent Name", agent.full_name],
    ["Role", ROLE_LABEL[agent.role]],
    ["Local Government", agent.assign_lga || (agent.role === "super_admin" ? "All of Adamawa State" : "")],
    ["Ward", agent.assign_ward || ""],
    ["Polling Unit", agent.assign_pu || ""],
    ["Agent ID", `ISP-${agent.id}`],
    ["Date Issued", new Date().toISOString().slice(0, 10)],
    [],
    TEMPLATE_COLUMNS,
  ];
  const sheet = XLSX.utils.aoa_to_sheet(header);
  sheet["!cols"] = TEMPLATE_COLUMNS.map((c, i) => ({ wch: i === 0 ? 28 : Math.max(16, c.length + 4) }));
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Supporters");
  const help = XLSX.utils.aoa_to_sheet([
    ["How to fill this template"],
    [""],
    [`1. This file belongs to ${agent.full_name} (${ROLE_LABEL[agent.role]}). Do not change the details at the top.`],
    ["2. Add one supporter per row under the column names. Full Name is required."],
    ["3. VIN must be 19 letters and numbers if given. A VIN already in the system will be skipped."],
    ["4. Leave LGA, Ward or Polling Unit blank to use the agent's own area."],
    ["5. Save the file and upload it on the Import from Excel page."],
    [""],
    ["Adamawa local governments:"],
    ...state.lgas.map((l) => [l]),
  ]);
  help["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(book, help, "Instructions");
  const safeName = agent.full_name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  XLSX.writeFile(book, `ISP-template-${safeName}.xlsx`);
}

function normalizeHeader(text) {
  return String(text).toLowerCase().replace(/[^a-z]/g, "");
}

// Reads either an agent template (details block on top) or a plain sheet whose first row is the column names.
function parseSheet(sheet) {
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  let headerRow = grid.findIndex((row) => row.some((cell) => HEADER_MAP[normalizeHeader(cell)] === "full_name"));
  if (headerRow < 0) headerRow = 0;
  let ownerId = null;
  for (const row of grid.slice(0, headerRow)) {
    if (normalizeHeader(row[0]) === "agentid") {
      const match = /(\d+)/.exec(String(row[1]));
      if (match) ownerId = Number(match[1]);
    }
  }
  const keys = grid[headerRow].map((h) => HEADER_MAP[normalizeHeader(h)]);
  const rows = [];
  grid.slice(headerRow + 1).forEach((cells, i) => {
    const row = { __row: headerRow + i + 2 };
    keys.forEach((key, c) => {
      if (key) row[key] = String(cells[c] ?? "").trim();
    });
    if (keys.some((key) => key && row[key])) rows.push(row);
  });
  return { rows, ownerId };
}

async function readImportFile(file) {
  const out = document.getElementById("importOut");
  if (!window.XLSX) return toast("The Excel tool is still loading. Try again in a moment.");
  let parsed;
  try {
    const book = XLSX.read(await file.arrayBuffer());
    parsed = parseSheet(book.Sheets[book.SheetNames[0]]);
  } catch {
    out.innerHTML = `<div class="card" style="margin-top:20px"><div class="alert alert-error">Could not read that file. Use the .xlsx template.</div></div>`;
    return;
  }
  const { rows } = parsed;
  if (!rows.length) {
    out.innerHTML = `<div class="card" style="margin-top:20px"><div class="alert alert-error">No people found. Make sure the column names row is still there and people are listed under it.</div></div>`;
    return;
  }

  let owner = state.user;
  if (parsed.ownerId && parsed.ownerId !== state.user.id) {
    try {
      owner = (await api(`/api/template/${parsed.ownerId}`)).person;
    } catch {
      out.innerHTML = `<div class="card" style="margin-top:20px"><div class="alert alert-error">This template belongs to an agent outside your area (ISP-${parsed.ownerId}). Ask that agent or the super admin to upload it.</div></div>`;
      return;
    }
  }

  const cols = ["full_name", "vin", "gender", "phone", "lga", "ward", "polling_unit", "polling_unit_code"];
  out.innerHTML = `
    <div class="card" style="margin-top:20px">
      <div class="owner-banner">
        <div><small>This file belongs to</small><strong>${esc(owner.full_name)}</strong><span>${ROLE_LABEL[owner.role]} · ${esc(scopeText(owner))}</span></div>
        <button class="btn btn-gold" id="doImport">Import ${rows.length.toLocaleString()} supporters</button>
      </div>
      <p class="muted">${rows.length.toLocaleString()} people found in ${esc(file.name)}. Preview of the first ${Math.min(rows.length, 10)}:</p>
      <div class="table-wrap"><table><thead><tr>${["Name", "VIN", "Gender", "Phone", "LGA", "Ward", "Polling unit", "PU code"].map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .slice(0, 10)
        .map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] || "")}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>
      <div id="importResult"></div>
    </div>`;
  document.getElementById("doImport").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Importing…";
    const result = document.getElementById("importResult");
    try {
      const data = await api("/api/people/import", { method: "POST", body: { rows, ownerId: owner.id, fileName: file.name } });
      result.innerHTML = `
        <div class="alert alert-ok">${data.added.toLocaleString()} supporters added under ${esc(data.owner)}.${data.skipped ? ` ${data.skipped} rows skipped.` : ""}
          ${state.user.role === "super_admin" ? "" : " The super admin will see this upload on the Uploads page."}</div>
        ${data.errors.length ? `<div class="alert alert-warn"><strong>Skipped rows:</strong><br>${data.errors.map((er) => `Row ${er.row}: ${esc(er.message)}`).join("<br>")}</div>` : ""}
        <p><a class="btn btn-outline btn-small" href="#uploads">Go to Uploads</a></p>`;
      btn.textContent = "Done";
    } catch (err) {
      result.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = "Try again";
    }
  });
}

// ---------- landing editor ----------

function showLanding() {
  setHeader(
    "Edit Landing Page",
    "This is the live page. Click any text to change it, click a picture to replace it, then press Save changes.",
    `<a class="btn btn-outline" href="/?edit=1" target="_blank" rel="noopener">Open full screen</a><a class="btn btn-outline" href="/" target="_blank" rel="noopener">View live page</a>`
  );
  view.innerHTML = `<iframe class="editor-frame" src="/?edit=1" title="Landing page editor"></iframe>`;
}

// ---------- account ----------

function showAccount() {
  const me = state.user;
  setHeader("My Account");
  view.innerHTML = `
    <div class="card" style="max-width:640px">
      <dl class="details" style="padding:0 0 10px">
        <dt>Name</dt><dd>${esc(me.full_name)}</dd>
        <dt>Role</dt><dd>${ROLE_LABEL[me.role]}</dd>
        <dt>Area</dt><dd>${esc(scopeText(me))}</dd>
        <dt>Login</dt><dd class="mono">${esc(me.login)}</dd>
      </dl>
    </div>
    <form class="card" style="max-width:640px" id="pwForm">
      <div class="card-head"><h2>Change password</h2></div>
      <div class="grid-2">
        <label class="span-2">Current password<input type="password" id="pw0" autocomplete="current-password" required></label>
        <label>New password<input type="password" id="pw1" minlength="6" autocomplete="new-password" required></label>
        <label>Repeat new password<input type="password" id="pw2" minlength="6" autocomplete="new-password" required></label>
      </div>
      <button class="btn btn-primary" style="margin-top:16px">Save password</button>
      <div id="pwMsg"></div>
    </form>`;
  document.getElementById("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("pwMsg");
    const p1 = document.getElementById("pw1").value;
    if (p1 !== document.getElementById("pw2").value) {
      msg.innerHTML = `<div class="alert alert-error">The two passwords don't match.</div>`;
      return;
    }
    try {
      await api(`/api/people/${me.id}/password`, { method: "PUT", body: { password: p1, currentPassword: document.getElementById("pw0").value } });
      msg.innerHTML = `<div class="alert alert-ok">Password changed. Any other device signed in to this account has been signed out.</div>`;
      e.target.reset();
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  });
}

// ---------- locations data ----------

async function loadLocations() {
  try {
    state.locations = (await api("/api/locations")).lgas;
  } catch {
    state.locations = [];
  }
}

// ---------- printing ----------

const PRINT_COLUMNS = [
  ["full_name", "Name"],
  ["vin", "VIN"],
  ["gender", "Gender"],
  ["phone", "Phone"],
  ["lga", "LGA"],
  ["ward", "Ward"],
  ["polling_unit", "Polling unit"],
  ["polling_unit_code", "PU code"],
  ["verified", "Verified", (p) => (p.verified ? "Yes" : "No")],
];

// Fills the hidden print sheet and opens the browser's print window.
// owner: the agent the list belongs to (their name and area go on top, with signature lines).
function printReport({ title, owner = state.user, columns, rows, note = "" }) {
  const area = scopeText(owner);
  const apmLogo = "/img/apm-logo.jpg";
  document.getElementById("printArea").innerHTML = `
    <div class="print-sheet">
      <header class="print-head">
        <div class="print-brand">
          <span class="print-isp">${window.ispLogoSVG ? window.ispLogoSVG("print") : ""}</span>
          <div><strong>INDEPENDENT STRUCTURE PLATFORM (ISP)</strong><span>Haske 2027 · Allied Peoples Movement (APM) · Adamawa State</span></div>
        </div>
        <img src="${apmLogo}" alt="APM" class="print-apm">
      </header>
      <h1 class="print-title">${esc(title)}</h1>
      <table class="print-meta">
        <tr><th>Agent name</th><td>${esc(owner.full_name)}</td><th>Role</th><td>${esc(ROLE_LABEL[owner.role])}</td></tr>
        <tr><th>Local government</th><td>${esc(owner.assign_lga || (owner.role === "super_admin" ? "All" : "—"))}</td><th>Ward</th><td>${esc(owner.assign_ward || "—")}</td></tr>
        <tr><th>Polling unit</th><td>${esc(owner.assign_pu || "—")}</td><th>Total records</th><td>${rows.length.toLocaleString()}</td></tr>
        <tr><th>Printed by</th><td>${esc(state.user.full_name)}</td><th>Date printed</th><td>${new Date().toLocaleString()}</td></tr>
      </table>
      ${note ? `<p class="print-note">${esc(note)}</p>` : ""}
      <table class="print-table">
        <thead><tr><th>#</th>${columns.map(([, label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead>
        <tbody>${
          rows.length
            ? rows.map((r, i) => `<tr><td>${i + 1}</td>${columns.map(([key, , fn]) => `<td>${esc(fn ? fn(r) : r[key] ?? "")}</td>`).join("")}</tr>`).join("")
            : `<tr><td colspan="${columns.length + 1}">No records.</td></tr>`
        }</tbody>
      </table>
      <footer class="print-sign">
        <div><span></span>Agent's signature · ${esc(owner.full_name)}</div>
        <div><span></span>Date</div>
        <div><span class="print-box">☐</span>Checked and approved by Super Admin<br><span></span>Signature</div>
      </footer>
      <p class="print-foot">Area: ${esc(area)} · Generated by ISP</p>
    </div>`;
  // Wait for the logo image so it appears on the printout.
  const img = document.querySelector("#printArea .print-apm");
  const go = () => setTimeout(() => window.print(), 50);
  if (img.complete) go();
  else {
    img.onload = go;
    img.onerror = go;
  }
}

function peopleColumns(role) {
  const cols = [...PRINT_COLUMNS];
  if (!role || role === "all") cols.splice(1, 0, ["role", "Role", (p) => ROLE_LABEL[p.role]]);
  if (AGENT_ROLES.includes(role)) cols.splice(1, 0, ["area", "In charge of", (p) => areaText(p)], ["login", "Login"]);
  return cols;
}

async function printTable() {
  toast("Preparing printout…");
  const data = await api(tableQuery({ page: 1, size: 5000 }));
  const role = tableState.role === "all" ? tableState.filterRole : tableState.role;
  const filters = [tableState.lga && `LGA: ${tableState.lga}`, tableState.q && `Search: "${tableState.q}"`].filter(Boolean).join(" · ");
  printReport({
    title: PEOPLE_VIEWS[tableState.role].title,
    columns: peopleColumns(role || "all"),
    rows: data.rows,
    note: filters ? `Filtered by ${filters}` : "",
  });
}

async function printAgentList(agentId) {
  toast("Preparing printout…");
  try {
    const { person } = await api(`/api/template/${agentId}`);
    const data = await api(`/api/people?under=${agentId}&size=5000`);
    printReport({ title: `People under ${person.full_name}`, owner: person, columns: peopleColumns("all"), rows: data.rows });
  } catch (err) {
    toast(err.message);
  }
}

// ---------- uploads ----------

async function showUploads() {
  const isAdmin = state.user.role === "super_admin";
  setHeader("Uploads", isAdmin ? "Every Excel upload, with whose list it is. Approve each one after checking it." : "Excel files uploaded for you and the agents under you.");
  view.innerHTML = `<div class="empty">Loading…</div>`;
  const { rows } = await api("/api/imports");
  if (!rows.length) {
    view.innerHTML = `<div class="card"><div class="empty">No uploads yet. Use Import from Excel to upload a template.</div></div>`;
    return;
  }
  view.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>List belongs to</th><th>Area</th><th>Uploaded by</th><th>File</th><th>Added</th><th>Skipped</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (u) => `<tr>
              <td>${esc(u.created_at.slice(0, 16))}</td>
              <td><strong>${esc(u.owner_name)}</strong><br><span class="pill pill-${u.owner_role}">${ROLE_LABEL[u.owner_role]}</span></td>
              <td class="wrap">${esc(u.area || "All of Adamawa State")}</td>
              <td>${esc(u.uploaded_by_name || "—")}</td>
              <td class="wrap">${esc(u.file_name)}</td>
              <td><b>${u.rows_added}</b></td>
              <td>${u.rows_skipped}</td>
              <td><span class="pill pill-status-${u.status}">${u.status === "approved" ? "✓ Approved" : u.status === "rejected" ? "Rejected" : "Waiting for approval"}</span></td>
              <td>
                <button class="btn btn-outline btn-small" data-print-upload="${u.id}">🖨 Print</button>
                ${isAdmin && u.status !== "approved" ? `<button class="btn btn-primary btn-small" data-approve="${u.id}">✓ Approve</button>` : ""}
                ${isAdmin && u.status === "pending" ? `<button class="btn btn-danger" data-reject="${u.id}">Reject</button>` : ""}
              </td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>
    </div>`;
  view.querySelectorAll("[data-print-upload]").forEach((b) =>
    b.addEventListener("click", async () => {
      const upload = rows.find((u) => u.id === Number(b.dataset.printUpload));
      const data = await api(`/api/people?import=${upload.id}&size=5000`);
      let owner = { full_name: upload.owner_name, role: upload.owner_role, assign_lga: "", assign_ward: "", assign_pu: "" };
      if (upload.owner_id) {
        try {
          owner = upload.owner_id === state.user.id ? state.user : (await api(`/api/template/${upload.owner_id}`)).person;
        } catch {
          // Agent no longer under this user; print with the saved name.
        }
      }
      printReport({
        title: `Upload of ${upload.created_at.slice(0, 10)} · ${upload.file_name}`,
        owner,
        columns: PRINT_COLUMNS,
        rows: data.rows,
        note: `Status: ${upload.status}. Uploaded by ${upload.uploaded_by_name || "—"}. ${upload.rows_skipped} rows were skipped.`,
      });
    })
  );
  const setStatus = async (id, action) => {
    try {
      await api(`/api/imports/${id}/${action}`, { method: "POST" });
      toast(action === "approve" ? "Upload approved" : "Upload rejected");
      showUploads();
    } catch (err) {
      toast(err.message);
    }
  };
  view.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => setStatus(b.dataset.approve, "approve")));
  view.querySelectorAll("[data-reject]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (await ask({ title: "Reject this upload?", text: "The people stay in the system, but the upload is marked rejected.", okText: "Reject", danger: true })) {
        setStatus(b.dataset.reject, "reject");
      }
    })
  );
}

// ---------- locations (super admin) ----------

const locState = { lga: null, openWard: null };

async function showLocations() {
  setHeader("Locations", "All 21 local governments of Adamawa State. Add the wards under each one, and the polling units under each ward.");
  await loadLocations();
  if (!locState.lga) locState.lga = state.locations[0]?.name;
  renderLocations();
}

function renderLocations() {
  const lga = lgaTree(locState.lga);
  const totals = state.locations.reduce(
    (t, l) => ({ wards: t.wards + l.wards.length, units: t.units + l.wards.reduce((n, w) => n + w.units.length, 0) }),
    { wards: 0, units: 0 }
  );
  view.innerHTML = `
    <div class="stats">
      <div class="stat feature"><span>Local governments</span><strong>${state.locations.length}</strong><small>Adamawa State</small></div>
      <div class="stat"><span>Wards</span><strong>${totals.wards.toLocaleString()}</strong><small>Added so far</small></div>
      <div class="stat"><span>Polling units</span><strong>${totals.units.toLocaleString()}</strong><small>Added so far</small></div>
    </div>
    <div class="loc-layout">
      <nav class="card loc-list" aria-label="Local governments">
        ${state.locations
          .map((l) => {
            const units = l.wards.reduce((n, w) => n + w.units.length, 0);
            return `<button class="loc-item ${l.name === locState.lga ? "active" : ""}" data-lga="${esc(l.name)}">
              <strong>${esc(l.name)}</strong><small>${l.wards.length} wards · ${units} PUs · ${l.agents} LGA agent${l.agents === 1 ? "" : "s"}</small>
            </button>`;
          })
          .join("")}
      </nav>
      <section>
        <div class="card">
          <div class="card-head">
            <div><h2 style="font-size:22px;font-family:var(--display)">${esc(lga.name)} LGA</h2>
            <p class="muted" style="margin:4px 0 0">${lga.wards.length} wards · ${lga.wards.reduce((n, w) => n + w.units.length, 0)} polling units · ${lga.agents} LGA agent(s)</p></div>
            <button class="btn btn-outline" id="printLga">🖨 Print</button>
          </div>
          <form id="wardForm" class="add-form">
            <label for="wardNames"><strong>Add wards to ${esc(lga.name)}</strong> <span class="muted">(one per line, you can paste a list)</span></label>
            <textarea id="wardNames" rows="3" placeholder="e.g.&#10;Doubeli&#10;Jambutu&#10;Karewa"></textarea>
            <button class="btn btn-primary">+ Add wards</button>
          </form>
        </div>
        ${
          lga.wards.length
            ? lga.wards
                .map(
                  (w) => `
          <div class="card ward-card">
            <div class="ward-head">
              <button class="ward-toggle" data-ward="${w.id}" aria-expanded="${locState.openWard === w.id}">
                <span class="chev">${locState.openWard === w.id ? "▾" : "▸"}</span>
                <strong>${esc(w.name)}</strong>
                <small>${w.units.length} polling unit${w.units.length === 1 ? "" : "s"} · ${w.agents} ward agent${w.agents === 1 ? "" : "s"}</small>
              </button>
              <button class="btn btn-danger" data-del-ward="${w.id}" data-name="${esc(w.name)}">Delete</button>
            </div>
            ${
              locState.openWard === w.id
                ? `<div class="ward-body">
                ${
                  w.units.length
                    ? `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Polling unit</th><th>PU agents</th><th></th></tr></thead><tbody>
                    ${w.units
                      .map(
                        (u) => `<tr><td class="mono">${esc(u.code || "—")}</td><td class="wrap">${esc(u.name)}</td><td>${u.agents}</td>
                        <td><button class="btn btn-danger" data-del-unit="${u.id}" data-name="${esc(u.name)}">Delete</button></td></tr>`
                      )
                      .join("")}</tbody></table></div>`
                    : `<p class="muted">No polling units in this ward yet.</p>`
                }
                <form class="add-form" data-unit-form="${w.id}">
                  <label><strong>Add polling units to ${esc(w.name)}</strong> <span class="muted">(one per line: code, name. The code is optional.)</span></label>
                  <textarea rows="3" placeholder="e.g.&#10;02/20/05/001, Doubeli Primary School&#10;02/20/05/002, Doubeli Market"></textarea>
                  <button class="btn btn-primary">+ Add polling units</button>
                </form>
              </div>`
                : ""
            }
          </div>`
                )
                .join("")
            : `<div class="card"><div class="empty">No wards yet. Add the wards of ${esc(lga.name)} above.</div></div>`
        }
      </section>
    </div>`;

  view.querySelectorAll("[data-lga]").forEach((b) =>
    b.addEventListener("click", () => {
      locState.lga = b.dataset.lga;
      locState.openWard = null;
      renderLocations();
    })
  );
  view.querySelectorAll("[data-ward]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = Number(b.dataset.ward);
      locState.openWard = locState.openWard === id ? null : id;
      renderLocations();
    })
  );
  document.getElementById("wardForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const names = document.getElementById("wardNames").value.split("\n").map((n) => n.trim()).filter(Boolean);
    try {
      const r = await api("/api/wards", { method: "POST", body: { lga: lga.name, names } });
      toast(`${r.added} ward(s) added${r.skipped ? `, ${r.skipped} already existed` : ""}`);
      await loadLocations();
      renderLocations();
    } catch (err) {
      toast(err.message);
    }
  });
  view.querySelectorAll("[data-unit-form]").forEach((form) =>
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const units = form
        .querySelector("textarea")
        .value.split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const comma = line.indexOf(",");
          return comma > 0 ? { code: line.slice(0, comma).trim(), name: line.slice(comma + 1).trim() } : { code: "", name: line };
        });
      try {
        const r = await api("/api/units", { method: "POST", body: { wardId: Number(form.dataset.unitForm), units } });
        toast(`${r.added} polling unit(s) added${r.skipped ? `, ${r.skipped} already existed` : ""}`);
        await loadLocations();
        renderLocations();
      } catch (err) {
        toast(err.message);
      }
    })
  );
  const remove = async (kind, id, name) => {
    if (!(await ask({ title: `Delete ${name}?`, text: kind === "wards" ? "Its polling units are deleted too." : "This removes the polling unit from the list.", okText: "Delete", danger: true }))) return;
    try {
      await api(`/api/${kind}/${id}`, { method: "DELETE" });
      toast(`${name} deleted`);
      await loadLocations();
      renderLocations();
    } catch (err) {
      toast(err.message);
    }
  };
  view.querySelectorAll("[data-del-ward]").forEach((b) => b.addEventListener("click", () => remove("wards", b.dataset.delWard, b.dataset.name)));
  view.querySelectorAll("[data-del-unit]").forEach((b) => b.addEventListener("click", () => remove("units", b.dataset.delUnit, b.dataset.name)));
  document.getElementById("printLga").addEventListener("click", () => {
    const rows = lga.wards.flatMap((w) =>
      w.units.length ? w.units.map((u) => ({ ward: w.name, code: u.code, unit: u.name, agents: u.agents })) : [{ ward: w.name, code: "", unit: "(no polling units yet)", agents: "" }]
    );
    printReport({
      title: `${lga.name} LGA · Wards and polling units`,
      columns: [
        ["ward", "Ward"],
        ["code", "PU code"],
        ["unit", "Polling unit"],
        ["agents", "PU agents"],
      ],
      rows,
      note: `${lga.wards.length} wards, ${lga.wards.reduce((n, w) => n + w.units.length, 0)} polling units.`,
    });
  });
}

// ---------- start ----------

document.getElementById("menuBtn").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
for (const id of ["logout", "logoutTop"]) {
  document.getElementById(id).addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    location.replace("/login");
  });
}

(async function init() {
  try {
    const data = await api("/api/me");
    Object.assign(state, { user: data.user, canAdd: data.canAdd, lgas: data.lgas });
  } catch {
    return;
  }
  document.querySelectorAll("[data-isp-logo]").forEach((el, i) => (el.innerHTML = window.ispLogoSVG ? window.ispLogoSVG(`side${i}`) : "ISP"));
  await loadLocations();
  document.getElementById("userName").textContent = state.user.full_name;
  document.getElementById("userRole").textContent = ROLE_LABEL[state.user.role];
  renderNav();
  addEventListener("hashchange", route);
  route();
  watchIdle();
})();

// Signs out after 10 minutes without a click, key press or touch, so an unattended screen doesn't stay open.
// While someone is active (even just typing in a form), the server is told now and then to keep the session going.
function watchIdle() {
  const IDLE_MS = 10 * 60 * 1000;
  let lastActive = Date.now();
  let lastPing = Date.now();
  const onActivity = () => {
    lastActive = Date.now();
    if (lastActive - lastPing > 2 * 60 * 1000) {
      lastPing = lastActive;
      api("/api/me").catch(() => {});
    }
  };
  const listen = (win) => {
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) win.addEventListener(type, onActivity, { passive: true });
  };
  listen(window);
  // Work inside the landing page editor (an iframe) counts as activity too.
  document.addEventListener("load", (e) => e.target.tagName === "IFRAME" && listen(e.target.contentWindow), true);
  setInterval(async () => {
    if (Date.now() - lastActive < IDLE_MS) return;
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    location.replace("/login?expired=1");
  }, 15_000);
}
