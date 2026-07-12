"use strict";

const SUPABASE_URL = "https://wuftzyeajmsxdrbwaawl.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_7AKtP6jh9xg8CdrK8F53xA_q4yZskPJ";
const READ_RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/attendance_admin_read_api`;
const WRITE_RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/attendance_admin_write_api`;
const STORAGE_KEY = "wts_attendance_admin_connection";
const QR_PRINT_KEY = "wts_qr_print_payload";

const CLASS_LABELS = {
  jss1: "JSS 1",
  jss2: "JSS 2",
  jss3: "JSS 3",
  "ss1-general": "SS 1",
  "ss2-arts": "SS 2 Arts",
  "ss2-business": "SS 2 Business",
  "ss2-science": "SS 2 Science",
  "ss3-arts": "SS 3 Arts",
  "ss3-science": "SS 3 Science",
};

const previewState = {
  live: false,
  context: {
    environment: "development",
    operational_session: "2026/2027",
    operational_term: "1st Term",
    rollout_stage: "multi_modality_foundation",
  },
  snapshot: {
    expected: 267,
    present: 0,
    late: 0,
    absent: 0,
    waiting: 267,
    checked_out: 0,
    latest_events: [],
  },
  classes: [
    { key: "jss1", count: 62 },
    { key: "jss2", count: 54 },
    { key: "jss3", count: 62 },
    { key: "ss1-general", count: 42 },
    { key: "ss2-arts", count: 11 },
    { key: "ss2-business", count: 2 },
    { key: "ss2-science", count: 11 },
    { key: "ss3-arts", count: 5 },
    { key: "ss3-science", count: 18 },
  ],
  students: [
    {
      id: "0079a385-cee1-4a83-9570-dd31c5cb8c41",
      name: "AZEEZ WARITH OLAIDE",
      class_key: "ss3-arts",
      admno: "",
      photo: "",
      gender: "",
    },
  ],
  credentials: {
    "0079a385-cee1-4a83-9570-dd31c5cb8c41": [
      { credential_id: "preview-qr", credential_type: "qr", status: "active", token_last4: "a64x", credential_label: "Private QR development test" },
      { credential_id: "preview-nfc", credential_type: "nfc", status: "active", token_last4: "59dc", credential_label: "Private standalone-terminal test" },
    ],
  },
  devices: [
    {
      id: "preview-phone",
      device_code: "WTS-DEV-ANDROID-01",
      device_name: "Private Development Phone",
      device_type: "android_scanner",
      assigned_gate: "Development",
      supported_sources: ["qr", "nfc"],
      connection_type: "wifi",
      offline_enabled: false,
      computed_status: "online",
      firmware_version: "0.1.0",
      last_seen_at: null,
    },
    {
      id: "preview-gate",
      device_code: "WTS-SIM-GATE-01",
      device_name: "Gate Terminal Test",
      device_type: "simulator",
      assigned_gate: "Main Gate",
      supported_sources: ["standalone_terminal"],
      connection_type: "wifi",
      offline_enabled: true,
      computed_status: "never_seen",
      firmware_version: "simulation",
      last_seen_at: null,
    },
  ],
  audit: [],
};

const state = structuredClone(previewState);
let selectedStudentId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function classLabel(key) {
  return CLASS_LABELS[key] || String(key || "Unassigned").replaceAll("-", " ").toUpperCase();
}

function initials(name) {
  return String(name || "ST")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

function toast(message, type = "default") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  $("#toastContainer").appendChild(item);
  window.setTimeout(() => item.remove(), 4800);
}

function setView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  const titles = {
    overview: "Attendance Overview",
    credentials: "Credential Management",
    devices: "Device Management",
    reports: "Attendance Reports",
    settings: "Attendance Settings",
    audit: "Administrative Audit Trail",
  };
  $("#pageTitle").textContent = titles[name] || "Attendance Administration";
  $("#sidebar").classList.remove("open");
  if (name === "audit" && state.live) loadAudit();
}

function renderHeader() {
  $("#sessionPill").textContent = `${state.context.operational_session} • ${state.context.operational_term}`;
  $("#environmentLabel").textContent = state.live ? "Connected" : "Development";
  $("#connectionLabel").textContent = state.live ? "Secure live data" : "Preview data";
  const dot = $(".status-dot");
  dot.classList.toggle("online", state.live);
  dot.classList.toggle("warning", !state.live);
  $("#developmentBanner").hidden = state.live;
  $("#connectButton").textContent = state.live ? "Manage connection" : "Connect live data";
}

function renderMetrics() {
  const snapshot = state.snapshot;
  $("#metricExpected").textContent = snapshot.expected ?? 0;
  $("#metricPresent").textContent = snapshot.present ?? 0;
  $("#metricLate").textContent = snapshot.late ?? 0;
  $("#metricAbsent").textContent = snapshot.absent ?? 0;
  $("#metricWaiting").textContent = snapshot.waiting ?? 0;
  $("#metricCheckout").textContent = snapshot.checked_out ?? 0;
  const percentage = snapshot.expected ? Math.round((snapshot.present / snapshot.expected) * 100) : 0;
  $("#presentPercent").textContent = `${percentage}% recorded`;
}

function renderArrivals() {
  const list = $("#arrivalList");
  const empty = $("#latestEventsEmpty");
  const events = state.snapshot.latest_events || [];
  list.innerHTML = "";
  empty.hidden = events.length > 0;

  events.forEach((event) => {
    const row = document.createElement("div");
    const status = event.attendance_status === "late" ? "late" : "present";
    row.className = "arrival-item";
    row.innerHTML = `
      <div class="avatar">${escapeHtml(initials(event.name))}</div>
      <div><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(classLabel(event.class_key))} • ${escapeHtml(event.source || "scan")}</small></div>
      <span class="status-chip ${status}">${escapeHtml(event.attendance_status || "present")}</span>
    `;
    list.appendChild(row);
  });
}

function renderClassProgress() {
  const container = $("#classProgressList");
  container.innerHTML = "";
  state.classes.forEach((entry) => {
    const present = Number(entry.present || 0);
    const percentage = entry.count ? Math.round((present / entry.count) * 100) : 0;
    const row = document.createElement("div");
    row.className = "class-progress-row";
    row.innerHTML = `
      <strong>${escapeHtml(classLabel(entry.key))}</strong>
      <div class="progress-track"><i style="width:${Math.max(0, Math.min(100, percentage))}%"></i></div>
      <span>${present}/${entry.count}</span>
    `;
    container.appendChild(row);
  });
}

function populateClassFilter() {
  const select = $("#classFilter");
  const current = select.value;
  select.innerHTML = '<option value="">All secondary classes</option>';
  state.classes.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.key;
    option.textContent = `${classLabel(entry.key)} (${entry.count})`;
    select.appendChild(option);
  });
  select.value = current;
}

function renderStudentList() {
  const container = $("#studentList");
  container.innerHTML = "";
  $("#studentCountLabel").textContent = `${state.students.length} record${state.students.length === 1 ? "" : "s"} loaded`;

  if (!state.students.length) {
    container.innerHTML = '<div class="empty-state"><h4>No students found</h4><p>Adjust the search or class filter.</p></div>';
    return;
  }

  state.students.forEach((student) => {
    const button = document.createElement("button");
    button.className = `student-row${selectedStudentId === student.id ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <div class="avatar">${escapeHtml(initials(student.name))}</div>
      <div><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(classLabel(student.class_key))}${student.admno ? ` • ${escapeHtml(student.admno)}` : ""}</small></div>
    `;
    button.addEventListener("click", () => selectStudent(student.id));
    container.appendChild(button);
  });
}

function selectStudent(studentId) {
  selectedStudentId = studentId;
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return;

  $("#studentEmptyState").classList.add("hidden");
  $("#studentDetail").classList.remove("hidden");
  $("#studentName").textContent = student.name;
  $("#studentClass").textContent = classLabel(student.class_key);
  $("#studentAdmno").textContent = student.admno || "Admission number not supplied";
  $("#studentAvatar").textContent = initials(student.name);
  renderStudentList();
  renderCredentials(studentId);
  if (state.live) loadCredentials(studentId);
}

function renderCredentials(studentId) {
  const credentials = state.credentials[studentId] || [];
  const container = $("#credentialList");
  container.innerHTML = "";

  if (!credentials.length) {
    container.innerHTML = '<div class="empty-state"><h4>No credentials issued</h4><p>This student does not yet have a QR, NFC or RFID credential.</p></div>';
    return;
  }

  credentials.forEach((credential) => {
    const card = document.createElement("div");
    card.className = "credential-card";
    const credentialId = credential.credential_id || credential.id;
    const suspendButton = state.live && credential.status === "active" && credentialId
      ? `<button class="text-button suspend-credential" data-id="${escapeHtml(credentialId)}">Suspend</button>`
      : "";
    card.innerHTML = `
      <div>
        <h4>${escapeHtml(String(credential.credential_type || "credential").toUpperCase())}</h4>
        <p>${escapeHtml(credential.credential_label || "Attendance credential")} • ending ${escapeHtml(credential.token_last4 || "----")}</p>
      </div>
      <div><span class="status-chip ${credential.status === "active" ? "present" : "inactive"}">${escapeHtml(credential.status)}</span>${suspendButton}</div>
    `;
    const suspend = card.querySelector(".suspend-credential");
    if (suspend) suspend.addEventListener("click", () => suspendCredential(credentialId));
    container.appendChild(card);
  });
}

function renderDevices() {
  const container = $("#deviceGrid");
  container.innerHTML = "";
  const online = state.devices.filter((device) => device.computed_status === "online").length;
  const offline = state.devices.filter((device) => device.computed_status === "offline").length;
  $("#deviceTotal").textContent = state.devices.length;
  $("#deviceOnline").textContent = online;
  $("#deviceOffline").textContent = offline;
  $("#deviceDevelopment").textContent = state.devices.length;

  state.devices.forEach((device) => {
    const status = device.computed_status === "online" ? "present" : "inactive";
    const rotateButton = state.live && device.id
      ? `<button class="text-button rotate-device-secret" data-id="${escapeHtml(device.id)}">Rotate secret</button>`
      : "";
    const card = document.createElement("article");
    card.className = "device-card";
    card.innerHTML = `
      <div class="device-card-head">
        <div><p class="eyebrow">${escapeHtml(device.device_code)}</p><h3>${escapeHtml(device.device_name)}</h3></div>
        <div><span class="status-chip ${status}">${escapeHtml(device.computed_status || "unknown")}</span>${rotateButton}</div>
      </div>
      <div class="device-meta">
        <div><span>Type</span><strong>${escapeHtml(String(device.device_type || "").replaceAll("_", " "))}</strong></div>
        <div><span>Location</span><strong>${escapeHtml(device.assigned_gate || "Unassigned")}</strong></div>
        <div><span>Connection</span><strong>${escapeHtml(device.connection_type || "Unknown")}</strong></div>
        <div><span>Offline queue</span><strong>${device.offline_enabled ? "Enabled" : "Disabled"}</strong></div>
        <div><span>Sources</span><strong>${escapeHtml((device.supported_sources || []).join(", "))}</strong></div>
        <div><span>Firmware</span><strong>${escapeHtml(device.firmware_version || "Not reported")}</strong></div>
      </div>
    `;
    const rotate = card.querySelector(".rotate-device-secret");
    if (rotate) rotate.addEventListener("click", () => rotateDeviceSecret(device.id, device.device_name));
    container.appendChild(card);
  });
}

function renderModalities() {
  const enabled = new Set(state.context.enabled_modalities || ["qr", "nfc", "rfid", "usb_hid", "usb_ccid", "standalone_terminal"]);
  const modalities = [
    ["qr", "QR Camera", "Printed cards and Android camera scanning"],
    ["nfc", "Phone NFC", "Tap cards on NFC-enabled Android devices"],
    ["rfid", "RFID", "Compatible 13.56 MHz card readers"],
    ["usb_hid", "USB HID", "Keyboard-style desktop or tablet readers"],
    ["usb_ccid", "USB CCID", "Professional smart-card reader integration"],
    ["standalone_terminal", "Smart Gate", "Independent Wi-Fi or cellular gate terminal"],
  ];
  $("#modalityGrid").innerHTML = modalities.map(([key, title, description]) => `
    <label class="modality-card">
      <input type="checkbox" ${enabled.has(key) ? "checked" : ""} data-modality="${key}" disabled>
      <span><strong>${title}</strong><small>${description}</small></span>
    </label>
  `).join("");
}

function renderAudit() {
  const panel = $("#view-audit .panel");
  const entries = state.audit || [];
  if (!entries.length) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon">✓</div><h4>No management actions recorded</h4><p>Credential issuance, suspension and device changes will appear here.</p></div>';
    return;
  }
  panel.innerHTML = `<div class="audit-list">${entries.map((entry) => `
    <div class="arrival-item">
      <div class="avatar">✓</div>
      <div><strong>${escapeHtml(entry.action)}</strong><small>${escapeHtml(entry.entity_type || "system")} ${escapeHtml(entry.entity_id || "")} • ${new Date(entry.created_at).toLocaleString("en-NG")}</small></div>
      <span class="status-chip present">recorded</span>
    </div>
  `).join("")}</div>`;
}

function renderAll() {
  renderHeader();
  renderMetrics();
  renderArrivals();
  renderClassProgress();
  populateClassFilter();
  renderStudentList();
  renderDevices();
  renderModalities();
  renderAudit();
}

function getConnection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}

async function rpc(url, action, payload = {}) {
  const connection = getConnection();
  if (!connection?.adminCode || !connection?.adminSecret) throw new Error("Administrator connection is not configured.");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      p_client_code: connection.adminCode,
      p_client_secret: connection.adminSecret,
      p_action: action,
      p_payload: payload,
    }),
  });

  let data;
  try { data = await response.json(); } catch { throw new Error("Attendance service returned an invalid response."); }
  if (!response.ok || data?.ok === false) throw new Error(data?.code || "Attendance service request failed.");
  return data;
}

const readApi = (action, payload = {}) => rpc(READ_RPC_URL, action, payload);
const writeApi = (action, payload = {}) => rpc(WRITE_RPC_URL, action, payload);

async function connectLiveData() {
  try {
    const [context, snapshot, devices] = await Promise.all([
      readApi("context"),
      readApi("snapshot"),
      readApi("devices"),
    ]);
    state.live = true;
    if (context.config) state.context = context.config;
    if (snapshot) state.snapshot = { ...state.snapshot, ...snapshot };
    if (Array.isArray(devices.devices)) state.devices = devices.devices;
    await searchStudents();
    renderAll();
    toast("Secure live attendance data connected.", "success");
  } catch (error) {
    state.live = false;
    renderAll();
    toast(`Live connection unavailable: ${error.message}`, "error");
  }
}

async function searchStudents() {
  if (!state.live) {
    const term = $("#studentSearch").value.trim().toLowerCase();
    const classKey = $("#classFilter").value;
    state.students = previewState.students.filter((student) => {
      const matchesTerm = !term || student.name.toLowerCase().includes(term) || String(student.admno || "").toLowerCase().includes(term);
      const matchesClass = !classKey || student.class_key === classKey;
      return matchesTerm && matchesClass;
    });
    renderStudentList();
    return;
  }

  try {
    const data = await readApi("students", {
      search: $("#studentSearch").value.trim(),
      classKey: $("#classFilter").value,
    });
    state.students = data.students || [];
    selectedStudentId = null;
    $("#studentEmptyState").classList.remove("hidden");
    $("#studentDetail").classList.add("hidden");
    renderStudentList();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadCredentials(studentId) {
  try {
    const data = await readApi("credentials", { studentId });
    state.credentials[studentId] = data.credentials || [];
    renderCredentials(studentId);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadAudit() {
  try {
    const data = await readApi("audit");
    state.audit = data.audit || [];
    renderAudit();
  } catch (error) {
    toast(error.message, "error");
  }
}

function showOneTimeSecret(title, secret, options = {}) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `
    <div class="dialog-card">
      <div class="dialog-header"><div><p class="eyebrow">DISPLAYED ONCE</p><h2>${escapeHtml(title)}</h2></div><button class="icon-button close-secret">×</button></div>
      <p class="dialog-note">Copy and store this value now. The database stores only its secure hash and cannot reconstruct it later.</p>
      <pre style="white-space:pre-wrap;word-break:break-all;background:#f0f7f4;padding:14px;border-radius:10px;border:1px solid #c8e6d8">${escapeHtml(secret)}</pre>
      <div class="dialog-actions">
        <button class="secondary-button copy-secret">Copy</button>
        ${options.onPrint ? '<button class="primary-button print-secret">Prepare QR card</button>' : ""}
        <button class="primary-button close-secret">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelectorAll(".close-secret").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.querySelector(".copy-secret").addEventListener("click", async () => {
    await navigator.clipboard.writeText(secret);
    toast("Secret copied.", "success");
  });
  const printButton = dialog.querySelector(".print-secret");
  if (printButton) printButton.addEventListener("click", () => options.onPrint());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function issueCredential(type) {
  if (!state.live) {
    toast("Connect the secure live dashboard before issuing credentials.", "error");
    return;
  }
  const student = state.students.find((item) => item.id === selectedStudentId);
  if (!student) {
    toast("Select a student first.", "error");
    return;
  }

  const current = state.credentials[student.id] || [];
  const activeSameType = current.find((credential) => credential.credential_type === type && credential.status === "active");
  if (activeSameType && !window.confirm(`This student already has an active ${type.toUpperCase()} credential. Issuing another will replace it. Continue?`)) return;

  const label = window.prompt("Credential label", `School attendance ${type.toUpperCase()} credential`);
  if (label === null) return;

  try {
    const result = await writeApi("issueCredential", {
      studentId: student.id,
      credentialType: type,
      label: label.trim(),
    });
    await loadCredentials(student.id);
    const token = result.credential?.raw_token;
    if (!token) throw new Error("Credential was issued but no one-time token was returned.");

    showOneTimeSecret(`${type.toUpperCase()} credential for ${student.name}`, token, {
      onPrint: type === "qr" ? () => {
        sessionStorage.setItem(QR_PRINT_KEY, JSON.stringify([{
          name: student.name,
          class_key: student.class_key,
          admno: student.admno || "",
          photo: student.photo || "",
          session: state.context.operational_session,
          credential_token: token,
        }]));
        window.open("./qr-print.html", "_blank", "noopener");
      } : null,
    });
    toast(`${type.toUpperCase()} credential issued successfully.`, "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function suspendCredential(credentialId) {
  const reason = window.prompt("Reason for suspension", "Lost, damaged or compromised credential");
  if (!reason?.trim()) return;
  if (!window.confirm("Suspend this credential immediately? It will stop working at every scanner and gate terminal.")) return;

  try {
    await writeApi("suspendCredential", { credentialId, reason: reason.trim() });
    await loadCredentials(selectedStudentId);
    toast("Credential suspended.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function sourceDefaults(deviceType) {
  if (deviceType === "android_scanner") return ["qr", "nfc"];
  if (deviceType === "usb_hid_reader") return ["usb_hid"];
  if (deviceType === "usb_ccid_reader") return ["usb_ccid"];
  if (deviceType === "standalone_gate_terminal") return ["standalone_terminal"];
  if (deviceType === "web_scanner") return ["qr", "usb_hid"];
  return ["qr"];
}

async function registerDevice() {
  if (!state.live) {
    toast("Connect the secure live dashboard before registering devices.", "error");
    return;
  }

  const deviceCode = window.prompt("Unique device code", `WTS-GATE-${String(state.devices.length + 1).padStart(2, "0")}`);
  if (!deviceCode) return;
  const deviceName = window.prompt("Device name", "Main Gate Attendance Terminal");
  if (!deviceName) return;
  const deviceType = window.prompt("Device type: android_scanner, usb_hid_reader, usb_ccid_reader, standalone_gate_terminal or web_scanner", "standalone_gate_terminal");
  if (!deviceType) return;
  const assignedGate = window.prompt("Location or gate", "Main Gate") || "";
  const connectionType = window.prompt("Connection type: wifi, ethernet, cellular, usb, mixed or offline", deviceType.includes("usb") ? "usb" : "wifi");
  if (!connectionType) return;
  const offlineEnabled = window.confirm("Enable offline attendance queue for this device?");

  try {
    const result = await writeApi("registerDevice", {
      deviceCode: deviceCode.trim(),
      deviceName: deviceName.trim(),
      deviceType: deviceType.trim(),
      assignedGate: assignedGate.trim(),
      supportedSources: sourceDefaults(deviceType.trim()),
      connectionType: connectionType.trim(),
      offlineEnabled,
    });
    const secret = result.device?.raw_secret;
    await refreshDevices();
    showOneTimeSecret(`Device secret for ${deviceName}`, secret || "No secret returned");
    toast("Attendance device registered.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function rotateDeviceSecret(deviceId, deviceName) {
  if (!window.confirm(`Rotate the secret for ${deviceName}? The device will stop connecting until the new secret is entered.`)) return;
  try {
    const result = await writeApi("rotateDeviceSecret", { deviceId });
    showOneTimeSecret(`New device secret for ${deviceName}`, result.raw_secret || "No secret returned");
    toast("Device secret rotated.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refreshDevices() {
  const result = await readApi("devices");
  state.devices = result.devices || [];
  renderDevices();
}

function configureConnection(event) {
  event.preventDefault();
  const adminCode = $("#deviceCodeInput").value.trim();
  const adminSecret = $("#deviceSecretInput").value.trim();
  if (!adminCode || !adminSecret) {
    toast("Administrator code and secret are required.", "error");
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ adminCode, adminSecret }));
  $("#connectionDialog").close();
  connectLiveData();
}

function initializeDates() {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#todayLabel").textContent = today.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("#reportFrom").value = local;
  $("#reportTo").value = local;
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$('[data-view-target]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewTarget)));
  $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#connectButton").addEventListener("click", () => {
    const connection = getConnection();
    $("#deviceCodeInput").value = connection?.adminCode || "";
    $("#deviceSecretInput").value = connection?.adminSecret || "";
    $("#connectionDialog").querySelector("h2").textContent = "Connect attendance administrator";
    $("#connectionDialog").querySelector(".dialog-note").textContent = "Enter the private attendance administrator code and secret. These remain on this device and are never committed to GitHub.";
    $("#deviceCodeInput").previousElementSibling.textContent = "Administrator code";
    $("#deviceSecretInput").previousElementSibling.textContent = "Administrator secret";
    $("#connectionDialog").showModal();
  });
  $("#connectionForm").addEventListener("submit", configureConnection);
  $("#refreshButton").addEventListener("click", () => state.live ? connectLiveData() : toast("Dashboard is showing development preview data."));
  $("#studentSearchButton").addEventListener("click", searchStudents);
  $("#studentSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") searchStudents(); });
  $("#classFilter").addEventListener("change", searchStudents);
  $$('[data-credential-type]').forEach((button) => button.addEventListener("click", () => issueCredential(button.dataset.credentialType)));
  $("#registerDeviceButton").addEventListener("click", registerDevice);
  $("#bulkQrButton").addEventListener("click", () => toast("Bulk class issuance will activate after the single-student issuance and printing workflow is verified."));
  $$("#view-reports .restricted-action, #view-settings .restricted-action").forEach((button) => button.addEventListener("click", () => toast("This controlled action is scheduled for the next dashboard milestone.")));
}

initializeDates();
bindEvents();
renderAll();

if (getConnection()) connectLiveData();
