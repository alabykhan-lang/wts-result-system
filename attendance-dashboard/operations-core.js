"use strict";

window.WTSOps = (() => {
  const SUPABASE_URL = "https://wuftzyeajmsxdrbwaawl.supabase.co";
  const KEY = "sb_publishable_7AKtP6jh9xg8CdrK8F53xA_q4yZskPJ";
  const STORE = "wts_attendance_admin_connection";
  const endpoints = {
    read: `${SUPABASE_URL}/rest/v1/rpc/attendance_operations_admin_read_api`,
    roster: `${SUPABASE_URL}/rest/v1/rpc/attendance_roster_admin_write_api`,
    calendar: `${SUPABASE_URL}/rest/v1/rpc/attendance_calendar_admin_write_api`,
    session: `${SUPABASE_URL}/rest/v1/rpc/attendance_session_admin_write_api`
  };

  const classes = [
    "jss1", "jss2", "jss3", "ss1-general", "ss2-arts",
    "ss2-business", "ss2-science", "ss3-arts", "ss3-science"
  ];

  const labels = {
    jss1: "JSS 1", jss2: "JSS 2", jss3: "JSS 3",
    "ss1-general": "SS 1", "ss2-arts": "SS 2 Arts",
    "ss2-business": "SS 2 Business", "ss2-science": "SS 2 Science",
    "ss3-arts": "SS 3 Arts", "ss3-science": "SS 3 Science",
    primary5: "Primary 5"
  };

  const state = { summary: null, batches: [], entries: [], calendar: [], exceptions: [] };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));

  function credentials() {
    try { return JSON.parse(localStorage.getItem(STORE) || "null"); }
    catch { return null; }
  }

  function friendlyError(message) {
    const map = {
      ADMIN_AUTH_FAILED: "Administrator code or secret is incorrect.",
      ADMIN_PERMISSION_DENIED: "This administrator account lacks the required permission.",
      ROSTER_DECISIONS_PENDING: "Resolve every roster decision before approval or application.",
      ROSTER_BATCH_NOT_APPROVED: "Approve the roster batch before applying it.",
      APPLIED_STUDENT_ROSTER_REQUIRED: "Apply the 2026/2027 student roster before enabling automatic absence.",
      ACTIVE_STUDENT_RULE_REQUIRED: "Activate the 2026/2027 student attendance rule first.",
      ACTIVE_STAFF_RULE_REQUIRED: "Activate the 2026/2027 staff attendance rule first.",
      APPROVED_SCHOOL_DEVICE_REQUIRED: "Pilot or production requires an approved school-owned scanner or terminal.",
      OPERATIONAL_DATES_REQUIRED: "Enter both operational dates.",
      END_DATE_BEFORE_START_DATE: "The end date cannot be before the start date."
    };
    return map[message] || String(message || "Request failed.");
  }

  function toast(message, type = "default") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = friendlyError(message);
    $("#toastContainer").appendChild(node);
    setTimeout(() => node.remove(), 4800);
  }

  async function rpc(endpoint, action, payload = {}) {
    const auth = credentials();
    if (!auth?.adminCode || !auth?.adminSecret) throw new Error("Administrator connection is not configured.");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: KEY },
      body: JSON.stringify({
        p_client_code: auth.adminCode,
        p_client_secret: auth.adminSecret,
        p_action: action,
        p_payload: payload
      })
    });

    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.code || "Attendance request failed.");
    return data;
  }

  const read = (action, payload = {}) => rpc(endpoints.read, action, payload);
  const rosterWrite = (action, payload = {}) => rpc(endpoints.roster, action, payload);
  const calendarWrite = (action, payload = {}) => rpc(endpoints.calendar, action, payload);
  const sessionWrite = (action, payload = {}) => rpc(endpoints.session, action, payload);

  function setTab(name) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === `tab-${name}`));
    $$(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    if (name === "calendar" && window.WTSOpsCalendar) window.WTSOpsCalendar.loadCalendar();
    if (name === "exceptions" && window.WTSOpsCalendar) window.WTSOpsCalendar.loadExceptions();
  }

  function chip(ready) {
    return `<span class="status-chip ${ready ? "present" : "inactive"}">${ready ? "Ready" : "Pending"}</span>`;
  }

  function renderSummary() {
    const summary = state.summary || {};
    const latest = summary.latest_batch || {};
    const counts = summary.counts || {};
    const config = summary.config || {};
    const portal = summary.portal_context || {};

    $("#projectedCount").textContent = latest.projected_count || 0;
    $("#activeCount").textContent = latest.active_count || 0;
    $("#graduatingCount").textContent = latest.graduating_count || 0;
    $("#pendingCount").textContent = counts.pending_decisions || 0;
    $("#appliedCount").textContent = counts.applied_roster || 0;
    $("#batchTitle").textContent = latest.id ? `${latest.preparation_mode} • ${latest.status}` : "No roster batch";

    const details = [
      ["Source session", latest.source_session || portal.promotion_source_session || "—"],
      ["Target session", latest.target_session || portal.promotion_target_session || "—"],
      ["Projected active", latest.active_count || 0],
      ["Graduating", latest.graduating_count || 0],
      ["Pending decisions", counts.pending_decisions || 0]
    ];
    $("#batchSummary").innerHTML = details.map(([label, value]) =>
      `<div class="ready-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    ).join("");

    const readiness = [
      ["Portal target is 2026/2027", portal.promotion_target_session === "2026/2027"],
      ["Final roster applied", Number(counts.applied_roster || 0) > 0],
      ["Operational dates entered", Boolean(config.operational_start_date && config.operational_end_date)],
      ["Student absence automation", config.automatic_absence_enabled === true],
      ["Staff absence automation", config.staff_automatic_absence_enabled === true]
    ];
    $("#readinessList").innerHTML = readiness.map(([label, ready]) =>
      `<div class="ready-row"><strong>${escapeHtml(label)}</strong>${chip(ready)}</div>`
    ).join("");

    $("#activationSession").value = config.operational_session || "2026/2027";
    $("#activationTerm").value = config.operational_term || "1st Term";
    $("#activationStart").value = config.operational_start_date || "";
    $("#activationEnd").value = config.operational_end_date || "";
    $("#rolloutStage").value = config.rollout_stage || "development";
    $("#studentAuto").checked = config.automatic_absence_enabled === true;
    $("#staffAuto").checked = config.staff_automatic_absence_enabled === true;
  }

  function renderBatches() {
    const select = $("#batchSelect");
    const current = select.value;
    select.innerHTML = state.batches.map((batch) =>
      `<option value="${batch.id}">${escapeHtml(batch.target_session)} • ${escapeHtml(batch.preparation_mode)} • ${escapeHtml(batch.status)} • ${batch.projected_count} records</option>`
    ).join("");
    if (current && state.batches.some((batch) => batch.id === current)) select.value = current;
  }

  async function loadOverview(showToast = true) {
    try {
      const [summary, batches] = await Promise.all([read("summary"), read("batches")]);
      state.summary = summary;
      state.batches = batches.batches || [];
      renderSummary();
      renderBatches();
      if (showToast) toast("Attendance operations loaded.", "success");
    } catch (error) { toast(error.message, "error"); }
  }

  function connect() {
    const auth = credentials();
    $("#adminCode").value = auth?.adminCode || "";
    $("#adminSecret").value = auth?.adminSecret || "";
    $("#connectionDialog").showModal();
  }

  function saveConnection(event) {
    event.preventDefault();
    const adminCode = $("#adminCode").value.trim();
    const adminSecret = $("#adminSecret").value.trim();
    if (!adminCode || !adminSecret) return toast("Administrator code and secret are required.", "error");
    localStorage.setItem(STORE, JSON.stringify({ adminCode, adminSecret }));
    $("#connectionDialog").close();
    loadOverview();
  }

  $$(".tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("#connectButton").addEventListener("click", connect);
  $("#connectionForm").addEventListener("submit", saveConnection);
  $("#refreshButton").addEventListener("click", () => loadOverview());

  return {
    $, $$, state, classes, labels, escapeHtml, credentials, toast,
    read, rosterWrite, calendarWrite, sessionWrite, loadOverview
  };
})();
