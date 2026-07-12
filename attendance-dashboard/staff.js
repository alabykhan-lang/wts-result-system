"use strict";

const SUPABASE_URL = "https://wuftzyeajmsxdrbwaawl.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_7AKtP6jh9xg8CdrK8F53xA_q4yZskPJ";
const ATTENDANCE_READ_URL = `${SUPABASE_URL}/rest/v1/rpc/staff_attendance_admin_read_api`;
const ATTENDANCE_WRITE_URL = `${SUPABASE_URL}/rest/v1/rpc/staff_attendance_admin_write_api`;
const DIRECTORY_READ_URL = `${SUPABASE_URL}/rest/v1/rpc/staff_directory_admin_read_api`;
const DIRECTORY_WRITE_URL = `${SUPABASE_URL}/rest/v1/rpc/staff_directory_admin_write_api`;
const STORAGE_KEY = "wts_attendance_admin_connection";
const STAFF_PRINT_KEY = "wts_staff_qr_print_payload";

const state = {
  live: false,
  context: null,
  snapshot: {
    expected: 24,
    present: 0,
    late: 0,
    absent: 0,
    on_site: 0,
    checked_out: 0,
    waiting: 24,
    latest_events: [],
    category_summary: []
  },
  staff: [],
  credentials: {},
  rules: [],
  history: [],
  applications: [],
  directorySummary: { pending: 0, active_accounts: 0, active_staff: 24, archived_staff: 0 }
};

let selectedStaffId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[character]));

function initials(name) {
  return String(name || "ST").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join("").toUpperCase();
}

function categoryLabel(value) {
  return String(value || "staff").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toast(message, type = "default") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("#toastContainer").appendChild(node);
  setTimeout(() => node.remove(), 4800);
}

function connection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch { return null; }
}

async function rpc(url, action, payload = {}) {
  const auth = connection();
  if (!auth?.adminCode || !auth?.adminSecret) {
    throw new Error("Administrator connection is not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: PUBLISHABLE_KEY },
    body: JSON.stringify({
      p_client_code: auth.adminCode,
      p_client_secret: auth.adminSecret,
      p_action: action,
      p_payload: payload
    })
  });

  let data;
  try { data = await response.json(); }
  catch { throw new Error("Staff attendance service returned an invalid response."); }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.code || "Staff attendance request failed.");
  }
  return data;
}

const attendanceRead = (action, payload = {}) => rpc(ATTENDANCE_READ_URL, action, payload);
const attendanceWrite = (action, payload = {}) => rpc(ATTENDANCE_WRITE_URL, action, payload);
const directoryRead = (action, payload = {}) => rpc(DIRECTORY_READ_URL, action, payload);
const directoryWrite = (action, payload = {}) => rpc(DIRECTORY_WRITE_URL, action, payload);

function setTab(name) {
  $$(".staff-tab").forEach((tab) => tab.classList.toggle("active", tab.id === `staff-tab-${name}`));
  $$(".staff-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  if (name === "history" && selectedStaffId) loadHistory();
  if (name === "applications" && state.live) loadDirectoryManagement();
}

function renderMetrics() {
  const snapshot = state.snapshot;
  $("#staffExpected").textContent = snapshot.expected ?? 0;
  $("#staffPresent").textContent = snapshot.present ?? 0;
  $("#staffLate").textContent = snapshot.late ?? 0;
  $("#staffOnSite").textContent = snapshot.on_site ?? 0;
  $("#staffCheckedOut").textContent = snapshot.checked_out ?? 0;
  $("#staffAbsent").textContent = snapshot.absent ?? 0;
  $("#staffPresentPercent").textContent = `${snapshot.expected ? Math.round((snapshot.present / snapshot.expected) * 100) : 0}% recorded`;
}

function renderEvents() {
  const items = state.snapshot.latest_events || [];
  const list = $("#staffEventsList");
  list.innerHTML = "";
  $("#staffEventsEmpty").hidden = items.length > 0;

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "arrival-item";
    row.innerHTML = `
      <div class="avatar">${escapeHtml(initials(item.name))}</div>
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.designation || categoryLabel(item.category))} • ${escapeHtml((item.event_type || "movement").replaceAll("_", " "))} • ${new Date(item.event_time).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</small></div>
      <span class="status-chip ${item.attendance_status === "late" ? "late" : "present"}">${escapeHtml(item.attendance_status || "recorded")}</span>
    `;
    list.appendChild(row);
  });
}

function renderCategories() {
  const container = $("#staffCategorySummary");
  const items = state.snapshot.category_summary || [];
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><h4>No category totals yet</h4><p>Category figures will appear after live data loads.</p></div>';
    return;
  }
  items.forEach((item) => {
    const percentage = item.expected ? Math.round((item.present / item.expected) * 100) : 0;
    const row = document.createElement("div");
    row.className = "class-progress-row";
    row.innerHTML = `<strong>${escapeHtml(categoryLabel(item.category))}</strong><div class="progress-track"><i style="width:${percentage}%"></i></div><span>${item.present}/${item.expected}</span>`;
    container.appendChild(row);
  });
}

function selectedStaff() {
  return state.staff.find((item) => item.id === selectedStaffId);
}

function applyAvatar(node, person) {
  node.innerHTML = "";
  if (person.photo) {
    const image = document.createElement("img");
    image.src = person.photo;
    image.className = "staff-profile-image";
    image.alt = person.full_name;
    image.onerror = () => { node.textContent = initials(person.full_name); };
    node.appendChild(image);
  } else {
    node.textContent = initials(person.full_name);
  }
}

function renderStaffList(target = "#staffList") {
  const list = $(target);
  list.innerHTML = "";
  if (target === "#staffList") {
    $("#staffCountLabel").textContent = `${state.staff.length} record${state.staff.length === 1 ? "" : "s"} loaded`;
  }
  if (!state.staff.length) {
    list.innerHTML = '<div class="empty-state"><h4>No staff found</h4><p>Adjust the search or category filter.</p></div>';
    return;
  }

  state.staff.forEach((person) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `student-row${selectedStaffId === person.id ? " active" : ""}`;
    const status = person.employment_status === "exited" ? " • ARCHIVED" : "";
    button.innerHTML = `<div class="avatar">${escapeHtml(initials(person.full_name))}</div><div><strong>${escapeHtml(person.full_name)}</strong><small>${escapeHtml(person.designation || categoryLabel(person.staff_category))}${person.staff_number ? ` • ${escapeHtml(person.staff_number)}` : ""}${status}</small></div>`;
    button.addEventListener("click", () => target === "#staffList" ? selectProfile(person.id) : selectCredentialHolder(person.id));
    list.appendChild(button);
  });
}

function selectProfile(id) {
  selectedStaffId = id;
  const person = selectedStaff();
  if (!person) return;
  $("#staffProfileEmpty").classList.add("hidden");
  $("#staffProfileForm").classList.remove("hidden");
  applyAvatar($("#staffAvatar"), person);
  $("#staffCategoryLabel").textContent = categoryLabel(person.staff_category);
  $("#staffName").textContent = person.full_name;
  $("#staffEmail").textContent = person.email || "Email not supplied";
  $("#staffNumberInput").value = person.staff_number || "";
  $("#staffCategoryInput").value = person.staff_category;
  $("#staffDepartmentInput").value = person.department || "";
  $("#staffDesignationInput").value = person.designation || "";
  $("#staffStatusInput").value = person.employment_status;
  $("#staffAttendanceRequired").checked = person.attendance_required !== false;
  $("#archiveStaffButton").classList.toggle("hidden", person.employment_status === "exited");
  $("#restoreStaffButton").classList.toggle("hidden", person.employment_status !== "exited");
  renderStaffList();
}

function selectCredentialHolder(id) {
  selectedStaffId = id;
  const person = selectedStaff();
  if (!person) return;
  $("#staffCredentialEmpty").classList.add("hidden");
  $("#staffCredentialDetail").classList.remove("hidden");
  applyAvatar($("#credentialStaffAvatar"), person);
  $("#credentialStaffCategory").textContent = categoryLabel(person.staff_category);
  $("#credentialStaffName").textContent = person.full_name;
  $("#credentialStaffNumber").textContent = person.staff_number || person.designation || "Attendance Staff ID not assigned";
  renderStaffList("#credentialStaffList");
  loadCredentials(id);
}

async function searchStaff(mode = "directory") {
  try {
    const search = mode === "credentials" ? $("#credentialStaffSearch").value.trim() : $("#staffSearch").value.trim();
    const category = mode === "credentials" ? "" : $("#staffCategoryFilter").value;
    const data = await attendanceRead("staff", { search, category });
    state.staff = data.staff || [];
    selectedStaffId = null;
    if (mode === "credentials") {
      renderStaffList("#credentialStaffList");
      $("#staffCredentialEmpty").classList.remove("hidden");
      $("#staffCredentialDetail").classList.add("hidden");
    } else {
      renderStaffList();
      $("#staffProfileEmpty").classList.remove("hidden");
      $("#staffProfileForm").classList.add("hidden");
    }
  } catch (error) { toast(error.message, "error"); }
}

async function saveProfile(event) {
  event.preventDefault();
  if (!selectedStaffId) return toast("Select a staff member first.", "error");
  try {
    await attendanceWrite("updateProfile", {
      staffId: selectedStaffId,
      staffNumber: $("#staffNumberInput").value.trim(),
      category: $("#staffCategoryInput").value,
      department: $("#staffDepartmentInput").value.trim(),
      designation: $("#staffDesignationInput").value.trim(),
      employmentStatus: $("#staffStatusInput").value,
      attendanceRequired: $("#staffAttendanceRequired").checked
    });
    toast("Staff attendance profile updated.", "success");
    await searchStaff();
  } catch (error) { toast(error.message, "error"); }
}

async function archiveSelectedStaff() {
  const person = selectedStaff();
  if (!person) return toast("Select a staff member first.", "error");
  const reason = prompt("Reason for removing this staff member from the active roster", "Left the school");
  if (!reason?.trim()) return;
  if (!confirm(`Archive ${person.full_name}? Their credentials will stop working, but attendance history will remain.`)) return;
  try {
    await directoryWrite("archiveStaff", { staffId: person.id, reason: reason.trim() });
    toast("Staff member archived and credentials disabled.", "success");
    await Promise.all([searchStaff(), loadDirectoryManagement()]);
  } catch (error) { toast(error.message, "error"); }
}

async function restoreSelectedStaff() {
  const person = selectedStaff();
  if (!person) return;
  if (!confirm(`Restore ${person.full_name} to the active attendance roster?`)) return;
  try {
    await directoryWrite("restoreStaff", { staffId: person.id });
    toast("Staff member restored.", "success");
    await Promise.all([searchStaff(), loadDirectoryManagement()]);
  } catch (error) { toast(error.message, "error"); }
}

async function loadCredentials(id) {
  try {
    const data = await attendanceRead("credentials", { staffId: id });
    state.credentials[id] = data.credentials || [];
    renderCredentials(id);
  } catch (error) { toast(error.message, "error"); }
}

function renderCredentials(id) {
  const container = $("#staffCredentialList");
  const items = state.credentials[id] || [];
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><h4>No credentials issued</h4><p>Issue a QR, NFC, RFID or hybrid credential.</p></div>';
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "credential-card";
    card.innerHTML = `<div><h4>${escapeHtml(String(item.credential_type || "credential").toUpperCase())}</h4><p>${escapeHtml(item.credential_label || "Staff attendance credential")} • ending ${escapeHtml(item.token_last4 || "----")}</p></div><div><span class="status-chip ${item.status === "active" ? "present" : "inactive"}">${escapeHtml(item.status)}</span>${item.status === "active" ? '<button class="text-button">Suspend</button>' : ""}</div>`;
    const suspend = card.querySelector("button");
    if (suspend) suspend.addEventListener("click", () => suspendCredential(item.credential_id));
    container.appendChild(card);
  });
}

function showSecret(title, secret, onPrint) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<div class="dialog-card"><div class="dialog-header"><div><p class="eyebrow">DISPLAYED ONCE</p><h2>${escapeHtml(title)}</h2></div><button class="icon-button close">×</button></div><p class="dialog-note">Store or program this credential now. Only its secure hash remains in the database.</p><pre class="staff-secret">${escapeHtml(secret)}</pre><div class="dialog-actions"><button class="secondary-button copy">Copy</button>${onPrint ? '<button class="primary-button print">Prepare staff QR card</button>' : ""}<button class="primary-button close">Done</button></div></div>`;
  document.body.appendChild(dialog);
  dialog.querySelectorAll(".close").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.querySelector(".copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(secret);
    toast("Credential copied.", "success");
  });
  const print = dialog.querySelector(".print");
  if (print) print.addEventListener("click", onPrint);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function issueCredential(type) {
  const person = selectedStaff();
  if (!person) return toast("Select a staff member first.", "error");
  if (person.employment_status === "exited") return toast("Restore this staff member before issuing a credential.", "error");
  const active = (state.credentials[person.id] || []).find((credential) => credential.credential_type === type && credential.status === "active");
  if (active && !confirm(`This staff member already has an active ${type.toUpperCase()} credential. Replace it?`)) return;
  const label = prompt("Credential label", `Staff attendance ${type.toUpperCase()} credential`);
  if (label === null) return;

  try {
    const result = await attendanceWrite("issueCredential", { staffId: person.id, credentialType: type, label: label.trim() });
    await loadCredentials(person.id);
    const token = result.credential?.raw_token;
    if (!token) throw new Error("Credential issued but one-time token was not returned.");
    showSecret(`${type.toUpperCase()} credential for ${person.full_name}`, token, type === "qr" ? () => {
      sessionStorage.setItem(STAFF_PRINT_KEY, JSON.stringify([{
        name: person.full_name,
        staff_number: person.staff_number || "",
        category: person.staff_category,
        designation: person.designation || "",
        department: person.department || "",
        photo: person.photo || "",
        session: "2026/2027",
        credential_token: token
      }]));
      window.open("./staff-qr-print.html", "_blank", "noopener");
    } : null);
    toast(`${type.toUpperCase()} staff credential issued.`, "success");
  } catch (error) { toast(error.message, "error"); }
}

async function suspendCredential(id) {
  const reason = prompt("Reason for suspension", "Lost, damaged or compromised staff credential");
  if (!reason?.trim() || !confirm("Suspend this staff credential immediately?")) return;
  try {
    await attendanceWrite("suspendCredential", { credentialId: id, reason: reason.trim() });
    await loadCredentials(selectedStaffId);
    toast("Staff credential suspended.", "success");
  } catch (error) { toast(error.message, "error"); }
}

function renderDirectorySummary() {
  const summary = state.directorySummary;
  $("#pendingApplications").textContent = summary.pending ?? 0;
  $("#activePortalAccounts").textContent = summary.active_accounts ?? 0;
  $("#activeStaffDirectory").textContent = summary.active_staff ?? 0;
  $("#archivedStaffDirectory").textContent = summary.archived_staff ?? 0;
}

function renderApplications() {
  const list = $("#applicationList");
  list.innerHTML = "";
  $("#applicationsEmpty").hidden = state.applications.length > 0;
  state.applications.forEach((application) => {
    const row = document.createElement("div");
    row.className = "application-card";
    row.innerHTML = `
      <div class="avatar">${application.photo_url ? `<img src="${escapeHtml(application.photo_url)}" alt="">` : escapeHtml(initials(application.full_name))}</div>
      <div class="application-copy"><strong>${escapeHtml(application.full_name)}</strong><span>${escapeHtml(application.requested_designation || categoryLabel(application.requested_category))}${application.requested_department ? ` • ${escapeHtml(application.requested_department)}` : ""}</span><small>${escapeHtml(application.email)}${application.phone ? ` • ${escapeHtml(application.phone)}` : ""}</small></div>
      <div class="application-actions"><button class="primary-button approve">Approve</button><button class="secondary-button reject">Reject</button></div>
    `;
    row.querySelector(".approve").addEventListener("click", () => approveApplication(application));
    row.querySelector(".reject").addEventListener("click", () => rejectApplication(application));
    list.appendChild(row);
  });
}

async function loadDirectoryManagement() {
  try {
    const [summary, applications] = await Promise.all([
      directoryRead("summary"),
      directoryRead("applications", { status: "pending" })
    ]);
    state.directorySummary = summary;
    state.applications = applications.applications || [];
    renderDirectorySummary();
    renderApplications();
  } catch (error) { toast(error.message, "error"); }
}

async function approveApplication(application) {
  if (!confirm(`Approve ${application.full_name} for the independent staff attendance portal?`)) return;
  try {
    const result = await directoryWrite("approveApplication", {
      authUserId: application.auth_user_id,
      category: application.requested_category,
      department: application.requested_department || "",
      designation: application.requested_designation || ""
    });
    toast(`Application approved. Attendance Staff ID: ${result.staff_number}`, "success");
    await Promise.all([loadDirectoryManagement(), searchStaff()]);
  } catch (error) { toast(error.message, "error"); }
}

async function rejectApplication(application) {
  const reason = prompt(`Reason for rejecting ${application.full_name}`, "Staff identity or appointment has not been confirmed");
  if (!reason?.trim()) return;
  try {
    await directoryWrite("rejectApplication", { authUserId: application.auth_user_id, reason: reason.trim() });
    toast("Application rejected.", "success");
    await loadDirectoryManagement();
  } catch (error) { toast(error.message, "error"); }
}

async function enrollStaff(event) {
  event.preventDefault();
  try {
    const result = await directoryWrite("enrollStaff", {
      fullName: $("#enrollFullName").value.trim(),
      email: $("#enrollEmail").value.trim(),
      phone: $("#enrollPhone").value.trim(),
      address: $("#enrollAddress").value.trim(),
      category: $("#enrollCategory").value,
      department: $("#enrollDepartment").value.trim(),
      designation: $("#enrollDesignation").value.trim()
    });
    $("#enrollStaffForm").reset();
    toast(`Staff enrolled. Attendance Staff ID: ${result.staff_number}`, "success");
    await Promise.all([loadDirectoryManagement(), searchStaff()]);
  } catch (error) { toast(error.message, "error"); }
}

function renderRule() {
  const rule = state.rules.find((item) => item.is_active) || state.rules[0] || null;
  $("#staffRuleBanner").hidden = Boolean(rule?.is_active);
  const status = $("#staffRuleStatus");
  status.textContent = rule?.is_active ? "Active" : "Prepared";
  status.className = `status-chip ${rule?.is_active ? "present" : "inactive"}`;
  if (!rule) return;
  $("#staffRuleId").value = rule.id || "";
  $("#staffRuleName").value = rule.name || "Staff Standard Attendance Day";
  $("#staffCheckInOpens").value = (rule.check_in_opens || "06:40").slice(0, 5);
  $("#staffOnTimeUntil").value = (rule.on_time_until || "07:45").slice(0, 5);
  $("#staffAbsenceCutoff").value = (rule.absence_cutoff || "10:00").slice(0, 5);
  $("#staffRuleActive").checked = rule.is_active === true;
  const days = new Set(rule.work_days || [1, 2, 3, 4, 5]);
  $$("#staffWeekdays input").forEach((box) => { box.checked = days.has(Number(box.value)); });
}

async function saveRule(event) {
  event.preventDefault();
  const required = [$("#staffCheckInOpens").value, $("#staffOnTimeUntil").value, $("#staffAbsenceCutoff").value];
  if (required.some((value) => !value)) return toast("Arrival opening, late deadline and absence cutoff are required.", "error");
  const workDays = $$("#staffWeekdays input:checked").map((box) => Number(box.value));
  if (!workDays.length) return toast("Select at least one working day.", "error");

  try {
    await attendanceWrite("saveRule", {
      ruleId: $("#staffRuleId").value || null,
      name: $("#staffRuleName").value.trim(),
      timezone: "Africa/Lagos",
      workDays,
      checkInOpens: $("#staffCheckInOpens").value,
      onTimeUntil: $("#staffOnTimeUntil").value,
      absenceCutoff: $("#staffAbsenceCutoff").value,
      earliestCheckout: "",
      expectedEnd: "",
      categories: ["teaching", "non_teaching", "management", "contract", "casual"],
      modalities: ["qr", "nfc", "rfid", "usb_hid", "usb_ccid", "standalone_terminal"],
      academicSession: "2026/2027",
      termScope: "All Terms",
      isActive: $("#staffRuleActive").checked
    });
    toast("Staff arrival rule saved.", "success");
    await Promise.all([loadRules(), loadOverview()]);
  } catch (error) {
    const message = error.message.includes("STAFF_SESSION_DATES_REQUIRED")
      ? "Enter the 2026/2027 operational start and end dates before activating this rule."
      : error.message;
    toast(message, "error");
  }
}

async function loadRules() {
  const data = await attendanceRead("rules");
  state.rules = data.rules || [];
  renderRule();
}

async function loadHistory() {
  if (!selectedStaffId) return toast("Select a staff member from the directory first.", "error");
  try {
    const data = await attendanceRead("history", {
      staffId: selectedStaffId,
      from: $("#staffHistoryFrom").value,
      to: $("#staffHistoryTo").value
    });
    state.history = data.history || [];
    renderHistory();
  } catch (error) { toast(error.message, "error"); }
}

function duration(value) {
  const minutes = Number(value || 0);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function time(value) {
  return value ? new Date(value).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) : "—";
}

function renderHistory() {
  const person = selectedStaff();
  $("#historyTitle").textContent = person ? `${person.full_name} — digital time book` : "Attendance history";
  $("#staffHistoryEmpty").hidden = state.history.length > 0;
  $("#staffHistoryTableWrap").classList.toggle("hidden", !state.history.length);
  $("#staffHistoryBody").innerHTML = state.history.map((row) => `
    <tr><td>${escapeHtml(row.attendance_date)}</td><td>${time(row.first_check_in)}</td><td>${time(row.last_check_out)}</td><td>${escapeHtml(row.daily_status)}</td><td>${row.late_minutes || 0} min</td><td>${duration(row.worked_minutes)}</td></tr>
  `).join("");
}

function exportHistory() {
  if (!state.history.length) return toast("Load a staff attendance history first.", "error");
  const person = selectedStaff();
  const rows = [
    ["Date", "Arrival", "Departure", "Status", "Late minutes", "Duration minutes"],
    ...state.history.map((record) => [record.attendance_date, record.first_check_in || "", record.last_check_out || "", record.daily_status, record.late_minutes, record.worked_minutes])
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(person?.full_name || "staff").replaceAll(/\s+/g, "_")}_attendance.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadOverview() {
  const [context, snapshot] = await Promise.all([attendanceRead("context"), attendanceRead("snapshot")]);
  state.context = context;
  state.snapshot = snapshot;
  renderMetrics();
  renderEvents();
  renderCategories();
  $("#staffSessionPill").textContent = `${snapshot.academic_session || "2026/2027"} • 1st Term`;
  $("#staffRuleBanner").hidden = Boolean(context.active_rule);
}

async function connectLive() {
  try {
    await loadOverview();
    const [staff, rules] = await Promise.all([attendanceRead("staff", {}), attendanceRead("rules")]);
    state.staff = staff.staff || [];
    state.rules = rules.rules || [];
    state.live = true;
    renderStaffList();
    renderStaffList("#credentialStaffList");
    renderRule();
    await loadDirectoryManagement();
    $("#staffConnectButton").textContent = "Connected";
    toast("Live independent staff attendance connected.", "success");
  } catch (error) {
    state.live = false;
    toast(`Connection failed: ${error.message}`, "error");
  }
}

function initDates() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#staffHistoryFrom").value = `${local.slice(0, 8)}01`;
  $("#staffHistoryTo").value = local;
}

function bind() {
  $$(".staff-tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("#staffConnectButton").addEventListener("click", () => {
    const auth = connection();
    $("#staffAdminCode").value = auth?.adminCode || "";
    $("#staffAdminSecret").value = auth?.adminSecret || "";
    $("#staffConnectionDialog").showModal();
  });
  $("#staffConnectionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const adminCode = $("#staffAdminCode").value.trim();
    const adminSecret = $("#staffAdminSecret").value.trim();
    if (!adminCode || !adminSecret) return toast("Administrator code and secret are required.", "error");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ adminCode, adminSecret }));
    $("#staffConnectionDialog").close();
    connectLive();
  });

  $("#staffSearchButton").addEventListener("click", () => searchStaff("directory"));
  $("#staffCategoryFilter").addEventListener("change", () => searchStaff("directory"));
  $("#staffProfileForm").addEventListener("submit", saveProfile);
  $("#archiveStaffButton").addEventListener("click", archiveSelectedStaff);
  $("#restoreStaffButton").addEventListener("click", restoreSelectedStaff);
  $("#credentialStaffSearchButton").addEventListener("click", () => searchStaff("credentials"));
  $$('[data-staff-credential]').forEach((button) => button.addEventListener("click", () => issueCredential(button.dataset.staffCredential)));
  $("#refreshApplications").addEventListener("click", loadDirectoryManagement);
  $("#enrollStaffForm").addEventListener("submit", enrollStaff);
  $("#staffRuleForm").addEventListener("submit", saveRule);
  $("#staffHistoryButton").addEventListener("click", loadHistory);
  $("#exportStaffHistoryButton").addEventListener("click", exportHistory);
  $("#historyStaffSearch").addEventListener("change", () => {
    const text = $("#historyStaffSearch").value.trim().toLowerCase();
    const match = state.staff.find((person) => person.full_name.toLowerCase().includes(text) || String(person.staff_number || "").toLowerCase() === text);
    if (match) {
      selectedStaffId = match.id;
      toast(`${match.full_name} selected.`, "success");
    }
  });
}

initDates();
bind();
renderMetrics();
renderEvents();
renderCategories();
renderStaffList();
renderStaffList("#credentialStaffList");
renderDirectorySummary();
renderApplications();
if (connection()) connectLive();
