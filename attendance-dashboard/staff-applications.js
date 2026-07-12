"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = { applications: [], profiles: [] };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));

  function toast(message, type = "default") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = String(message || "Request failed.");
    $("#toastContainer").appendChild(node);
    setTimeout(() => node.remove(), 4500);
  }

  async function config() {
    return window.WTSDashboardConfigReady;
  }

  async function auth() {
    const cfg = await config();
    const sessionRaw = sessionStorage.getItem(cfg.storageKey);
    const legacyRaw = localStorage.getItem(cfg.storageKey);
    if (!sessionRaw && legacyRaw) {
      sessionStorage.setItem(cfg.storageKey, legacyRaw);
      localStorage.removeItem(cfg.storageKey);
    }
    try { return JSON.parse(sessionStorage.getItem(cfg.storageKey) || "null"); }
    catch { return null; }
  }

  async function rpc(functionName, action, payload = {}) {
    const cfg = await config();
    const credentials = await auth();
    if (!credentials?.adminCode || !credentials?.adminSecret) {
      throw new Error("Administrator session is not configured.");
    }
    const response = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.publishableKey },
      body: JSON.stringify({
        p_client_code: credentials.adminCode,
        p_client_secret: credentials.adminSecret,
        p_action: action,
        p_payload: payload
      })
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.code || "Staff management request failed.");
    return data;
  }

  const read = (action, payload = {}) => rpc("staff_application_admin_read_api", action, payload);
  const write = (action, payload = {}) => rpc("staff_application_admin_write_api", action, payload);

  function switchTab(name) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === `tab-${name}`));
    $$(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    if (name === "directory") loadProfiles();
  }

  function statusBadge(status) {
    const safe = escapeHtml(status || "pending");
    return `<span class="badge ${safe}">${safe.replaceAll("_", " ")}</span>`;
  }

  async function loadSummary() {
    const data = await read("summary");
    $("#pendingCount").textContent = data.pending || 0;
    $("#activeCount").textContent = data.active || 0;
    $("#rejectedCount").textContent = data.rejected || 0;
    $("#suspendedCount").textContent = data.suspended || 0;
    $("#manualCount").textContent = data.manual_profiles || 0;
  }

  function renderApplications() {
    const list = $("#applicationList");
    if (!state.applications.length) {
      list.innerHTML = '<div class="empty"><h3>No matching applications</h3><p>New staff self-registrations will appear here.</p></div>';
      return;
    }
    list.innerHTML = state.applications.map((app) => {
      const pending = app.application_status === "pending";
      const suggested = app.suggested_staff_profile_id
        ? `<small>Possible existing profile match found by email.</small>` : "";
      const photo = app.photo_path ? "Private photograph uploaded" : "No photograph uploaded";
      return `<article class="application">
        <div class="application-head"><div><strong>${escapeHtml(app.full_name)}</strong><span>${escapeHtml(app.email || "No email")} • ${escapeHtml(app.phone || "No phone")}</span>${suggested}</div>${statusBadge(app.application_status)}</div>
        <div class="application-meta">
          <div><label>Requested category</label><b>${escapeHtml(app.requested_category || "—")}</b></div>
          <div><label>Department</label><b>${escapeHtml(app.requested_department || "—")}</b></div>
          <div><label>Designation</label><b>${escapeHtml(app.requested_designation || "—")}</b></div>
          <div><label>Photograph</label><b>${photo}</b></div>
          <div><label>Submitted</label><b>${new Date(app.submitted_at).toLocaleString("en-NG")}</b></div>
          <div><label>Existing profile</label><b>${app.suggested_staff_profile_id ? "Suggested match" : "Create new"}</b></div>
        </div>
        ${app.rejection_reason ? `<div class="notice">Reason: ${escapeHtml(app.rejection_reason)}</div>` : ""}
        ${pending ? `<div class="inline" style="margin-top:12px"><button class="primary-button approve" data-id="${app.auth_user_id}">Approve</button><button class="secondary-button reject" data-id="${app.auth_user_id}">Reject</button></div>` : ""}
      </article>`;
    }).join("");
    $$(".approve").forEach((button) => button.addEventListener("click", () => approveApplication(button.dataset.id)));
    $$(".reject").forEach((button) => button.addEventListener("click", () => rejectApplication(button.dataset.id)));
  }

  async function loadApplications() {
    try {
      const data = await read("applications", {
        status: $("#applicationStatus").value,
        search: $("#applicationSearch").value.trim()
      });
      state.applications = data.applications || [];
      renderApplications();
    } catch (error) { toast(error.message, "error"); }
  }

  async function approveApplication(authUserId) {
    const app = state.applications.find((item) => item.auth_user_id === authUserId);
    if (!app) return;
    const staffNumber = prompt("Staff number (leave blank to generate automatically):", "");
    if (staffNumber === null) return;
    const category = prompt("Approved category:", app.requested_category || "teaching");
    if (category === null) return;
    const designation = prompt("Approved designation:", app.requested_designation || "Staff");
    if (designation === null) return;
    const department = prompt("Approved department:", app.requested_department || "");
    if (department === null) return;
    const useExisting = app.suggested_staff_profile_id
      ? confirm("An existing imported staff profile matches this email. Link this account to that profile?") : false;
    if (!confirm(`Approve ${app.full_name} for the attendance platform?`)) return;
    try {
      const result = await write("approveApplication", {
        authUserId,
        existingStaffId: useExisting ? app.suggested_staff_profile_id : "",
        staffNumber: staffNumber.trim(),
        category: category.trim(),
        designation: designation.trim(),
        department: department.trim()
      });
      toast(`Staff application approved: ${result.staff_number}.`, "success");
      await Promise.all([loadSummary(), loadApplications()]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function rejectApplication(authUserId) {
    const app = state.applications.find((item) => item.auth_user_id === authUserId);
    const reason = prompt(`Reason for rejecting ${app?.full_name || "this application"}:`, "Incomplete or unverified staff information");
    if (!reason?.trim()) return;
    try {
      await write("rejectApplication", { authUserId, reason: reason.trim() });
      toast("Staff application rejected with a recorded reason.", "success");
      await Promise.all([loadSummary(), loadApplications()]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function manualEnroll(event) {
    event.preventDefault();
    try {
      const result = await write("manualEnroll", {
        fullName: $("#manualName").value.trim(),
        email: $("#manualEmail").value.trim(),
        phone: $("#manualPhone").value.trim(),
        staffNumber: $("#manualNumber").value.trim(),
        category: $("#manualCategory").value,
        department: $("#manualDepartment").value.trim(),
        designation: $("#manualDesignation").value.trim(),
        address: $("#manualAddress").value.trim(),
        attendanceRequired: $("#manualAttendance").checked
      });
      toast(`Staff enrolled: ${result.staff_number}.`, "success");
      $("#manualForm").reset();
      $("#manualAttendance").checked = true;
      await loadSummary();
    } catch (error) { toast(error.message, "error"); }
  }

  function renderProfiles() {
    const list = $("#profileList");
    if (!state.profiles.length) {
      list.innerHTML = '<div class="empty"><h3>No staff profiles found</h3></div>';
      return;
    }
    list.innerHTML = state.profiles.map((profile) => {
      const active = profile.registration_status === "active" && profile.employment_status === "active";
      const actions = active
        ? `<button class="secondary-button suspend-profile" data-id="${profile.id}">Suspend</button><button class="secondary-button archive-profile" data-id="${profile.id}">Archive</button>`
        : `<button class="primary-button reactivate-profile" data-id="${profile.id}">Reactivate</button>`;
      return `<article class="profile-row"><div><strong>${escapeHtml(profile.full_name)}</strong><span>${escapeHtml(profile.staff_number || "Number pending")} • ${escapeHtml(profile.designation || profile.staff_category || "Staff")}</span><small>${escapeHtml(profile.email || "No email")} • ${escapeHtml(profile.registration_source)} • ${escapeHtml(profile.employment_status)}</small></div><div class="inline">${statusBadge(profile.registration_status)}${actions}</div></article>`;
    }).join("");
    $$(".suspend-profile").forEach((button) => button.addEventListener("click", () => suspendProfile(button.dataset.id)));
    $$(".archive-profile").forEach((button) => button.addEventListener("click", () => archiveProfile(button.dataset.id)));
    $$(".reactivate-profile").forEach((button) => button.addEventListener("click", () => reactivateProfile(button.dataset.id)));
  }

  async function loadProfiles() {
    try {
      const data = await read("profiles", { search: $("#profileSearch").value.trim() });
      state.profiles = data.profiles || [];
      renderProfiles();
    } catch (error) { toast(error.message, "error"); }
  }

  async function suspendProfile(staffId) {
    const reason = prompt("Suspension reason:", "Temporary suspension by school management");
    if (!reason?.trim()) return;
    try {
      await write("suspendStaff", { staffId, reason: reason.trim() });
      toast("Staff profile and active attendance credentials suspended.", "success");
      await Promise.all([loadSummary(), loadProfiles()]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function archiveProfile(staffId) {
    const reason = prompt("Archiving reason:", "Staff exited the school");
    if (!reason?.trim() || !confirm("Archive this staff member? Attendance history will be preserved.")) return;
    try {
      await write("archiveStaff", { staffId, reason: reason.trim() });
      toast("Staff profile archived; historical attendance was preserved.", "success");
      await Promise.all([loadSummary(), loadProfiles()]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function reactivateProfile(staffId) {
    if (!confirm("Reactivate this staff member and require attendance?")) return;
    try {
      await write("reactivateStaff", { staffId, attendanceRequired: true });
      toast("Staff profile reactivated. A new credential can now be issued.", "success");
      await Promise.all([loadSummary(), loadProfiles()]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function openConnection() {
    const credentials = await auth();
    $("#adminCode").value = credentials?.adminCode || "";
    $("#adminSecret").value = credentials?.adminSecret || "";
    $("#connectionDialog").showModal();
  }

  async function saveConnection(event) {
    event.preventDefault();
    const cfg = await config();
    sessionStorage.setItem(cfg.storageKey, JSON.stringify({
      adminCode: $("#adminCode").value.trim(),
      adminSecret: $("#adminSecret").value
    }));
    localStorage.removeItem(cfg.storageKey);
    $("#connectionDialog").close();
    try {
      await Promise.all([loadSummary(), loadApplications()]);
      toast("Staff management connected securely for this browser tab.", "success");
    } catch (error) { toast(error.message, "error"); }
  }

  $$(".tabs button").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("#connectButton").addEventListener("click", openConnection);
  $("#connectionForm").addEventListener("submit", saveConnection);
  $("#refreshApplications").addEventListener("click", loadApplications);
  $("#applicationStatus").addEventListener("change", loadApplications);
  $("#applicationSearch").addEventListener("input", () => { clearTimeout(window.staffApplicationSearchTimer); window.staffApplicationSearchTimer = setTimeout(loadApplications, 300); });
  $("#manualForm").addEventListener("submit", manualEnroll);
  $("#refreshProfiles").addEventListener("click", loadProfiles);
  $("#profileSearch").addEventListener("input", () => { clearTimeout(window.staffProfileSearchTimer); window.staffProfileSearchTimer = setTimeout(loadProfiles, 300); });

  auth().then((credentials) => {
    if (credentials) Promise.all([loadSummary(), loadApplications()]).catch((error) => toast(error.message, "error"));
  });
})();
