"use strict";

const API_URL = "https://wuftzyeajmsxdrbwaawl.supabase.co/functions/v1/attendance-admin-read";
const STORAGE_KEY = "wts_attendance_admin_connection";

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
      { credential_type: "qr", status: "active", token_last4: "a64x", credential_label: "Private QR development test" },
      { credential_type: "nfc", status: "active", token_last4: "59dc", credential_label: "Private standalone-terminal test" },
    ],
  },
  devices: [
    {
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
};

const state = structuredClone(previewState);
let selectedStudentId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function classLabel(key) {
  return CLASS_LABELS[key] || String(key || "Unassigned").replaceAll("-", " ").toUpperCase();
}

function initials(name) {
  return String(name || "ST").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
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
  window.setTimeout(() => item.remove(), 4200);
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
}

function renderHeader() {
  $("#sessionPill").textContent = `${state.context.operational_session} • ${state.context.operational_term}`;
  $("#environmentLabel").textContent = state.live ? "Connected" : "Development";
  $("#connectionLabel").textContent = state.live ? "Live attendance data" : "Preview data";
  const dot = $(".status-dot");
  dot.classList.toggle("online", state.live);
  dot.classList.toggle("warning", !state.live);
  $("#developmentBanner").hidden = state.live;
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
    const present = state.live && entry.present ? entry.present : 0;
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
    card.innerHTML = `
      <div>
        <h4>${escapeHtml(String(credential.credential_type || "credential").toUpperCase())}</h4>
        <p>${escapeHtml(credential.credential_label || "Attendance credential")} • ending ${escapeHtml(credential.token_last4 || "----")}</p>
      </div>
      <span class="status-chip ${credential.status === "active" ? "present" : "inactive"}">${escapeHtml(credential.status)}</span>
    `;
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
    const card = document.createElement("article");
    card.className = "device-card";
    card.innerHTML = `
      <div class="device-card-head">
        <div><p class="eyebrow">${escapeHtml(device.device_code)}</p><h3>${escapeHtml(device.device_name)}</h3></div>
        <span class="status-chip ${status}">${escapeHtml(device.computed_status || "unknown")}</span>
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
    container.appendChild(card);
  });
}

function renderModalities() {
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
      <input type="checkbox" checked data-modality="${key}">
      <span><strong>${title}</strong><small>${description}</small></span>
    </label>
  `).join("");
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
}

function getConnection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}

async function api(action, payload = {}) {
  const connection = getConnection();
  if (!connection?.deviceCode || !connection?.deviceSecret) throw new Error("Development connection is not configured.");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wts-device-code": connection.deviceCode,
      "x-wts-device-secret": connection.deviceSecret,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  let data;
  try { data = await response.json(); } catch { throw new Error("Attendance service returned an invalid response."); }
  if (!response.ok || data.ok === false) throw new Error(data.code || "Attendance service request failed.");
  return data;
}

async function connectLiveData() {
  try {
    const [context, snapshot, devices] = await Promise.all([
      api("context"),
      api("snapshot"),
      api("devices"),
    ]);
    state.live = true;
    if (context.config) state.context = context.config;
    if (snapshot) state.snapshot = { ...state.snapshot, ...snapshot };
    if (Array.isArray(devices.devices)) state.devices = devices.devices;
    await searchStudents();
    renderAll();
    toast("Live attendance data connected.", "success");
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
    const data = await api("students", { search: $("#studentSearch").value.trim(), classKey: $("#classFilter").value });
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
    const data = await api("credentials", { studentId });
    state.credentials[studentId] = data.credentials || [];
    renderCredentials(studentId);
  } catch (error) {
    toast(error.message, "error");
  }
}

function configureConnection(event) {
  event.preventDefault();
  const deviceCode = $("#deviceCodeInput").value.trim();
  const deviceSecret = $("#deviceSecretInput").value.trim();
  if (!deviceCode || !deviceSecret) {
    toast("Both development credentials are required.", "error");
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ deviceCode, deviceSecret }));
  $("#connectionDialog").close();
  connectLiveData();
}

function restrictedAction(message = "This management action will activate when the secure write service is connected.") {
  toast(message, "error");
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
    $("#deviceCodeInput").value = connection?.deviceCode || "";
    $("#deviceSecretInput").value = connection?.deviceSecret || "";
    $("#connectionDialog").showModal();
  });
  $("#connectionForm").addEventListener("submit", configureConnection);
  $("#refreshButton").addEventListener("click", () => state.live ? connectLiveData() : toast("Dashboard is showing development preview data."));
  $("#studentSearchButton").addEventListener("click", searchStudents);
  $("#studentSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") searchStudents(); });
  $("#classFilter").addEventListener("change", searchStudents);
  $$(".restricted-action").forEach((button) => button.addEventListener("click", () => restrictedAction()));
  $$('[data-credential-type]').forEach((button) => button.addEventListener("click", () => restrictedAction(`${button.dataset.credentialType.toUpperCase()} credential issuance will activate with the secured management service.`)));
}

initializeDates();
bindEvents();
renderAll();

if (getConnection()) connectLiveData();
