"use strict";
window.WTSC = (() => {
  const $ = (query) => document.querySelector(query);
  const $$ = (query) => [...document.querySelectorAll(query)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
  const state = {
    summary: null,
    people: { students: [], staff: [] },
    manual: [], corrections: [], guardians: [], notifications: [],
    roles: [], clients: [], backups: [], readiness: []
  };

  async function config() {
    return window.WTSDashboardConfigReady;
  }

  async function credentials() {
    const cfg = await config();
    try { return JSON.parse(localStorage.getItem(cfg.storageKey) || "null"); }
    catch { return null; }
  }

  function toast(message, type = "default") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = String(message || "Request failed.");
    $("#toastContainer").appendChild(node);
    setTimeout(() => node.remove(), 4500);
  }

  async function rpc(kind, action, payload = {}) {
    const cfg = await config();
    const auth = await credentials();
    if (!auth?.adminCode || !auth?.adminSecret) {
      throw new Error("Administrator connection is not configured.");
    }
    const functionName = kind === "read"
      ? "attendance_controls_admin_read_api"
      : "attendance_controls_admin_write_api";
    const response = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.publishableKey },
      body: JSON.stringify({
        p_client_code: auth.adminCode,
        p_client_secret: auth.adminSecret,
        p_action: action,
        p_payload: payload
      })
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.code || "Attendance controls request failed.");
    return data;
  }

  const read = (action, payload = {}) => rpc("read", action, payload);
  const write = (action, payload = {}) => rpc("write", action, payload);

  function renderSummary() {
    const counts = state.summary?.counts || {};
    const readiness = state.summary?.latest_readiness || {};
    $("#pendingCorrections").textContent = counts.pending_corrections || 0;
    $("#pendingManual").textContent = counts.pending_manual_entries || 0;
    $("#guardianCount").textContent = counts.active_guardians || 0;
    $("#draftNotifications").textContent = counts.draft_notifications || 0;
    $("#adminCount").textContent = counts.admin_clients || 0;
    $("#readinessStatus").textContent = (readiness.overall_status || "—").toUpperCase();

    const cfg = state.summary?.config || {};
    $("#notificationsEnabled").value = String(cfg.parent_notifications_enabled === true);
    const channels = cfg.notification_channels || [];
    $("#notifySms").checked = channels.includes("sms");
    $("#notifyWhatsapp").checked = channels.includes("whatsapp");
    $("#notifyEmail").checked = channels.includes("email");
  }

  async function loadSummary(showToast = true) {
    try {
      state.summary = await read("summary");
      renderSummary();
      if (showToast) toast("Attendance controls loaded.", "success");
    } catch (error) { toast(error.message, "error"); }
  }

  function setTab(name) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === `tab-${name}`));
    $$(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    if (name === "manual") window.WTSCAttendance?.loadManual();
    if (name === "corrections") window.WTSCAttendance?.loadCorrections();
    if (name === "guardians") window.WTSCCommunication?.loadAll();
    if (name === "access") window.WTSCAdmin?.loadRoles();
    if (name === "readiness") window.WTSCAdmin?.loadBackups();
  }

  async function openConnection() {
    const auth = await credentials();
    $("#adminCode").value = auth?.adminCode || "";
    $("#adminSecret").value = auth?.adminSecret || "";
    $("#connectionDialog").showModal();
  }

  async function saveConnection(event) {
    event.preventDefault();
    const cfg = await config();
    localStorage.setItem(cfg.storageKey, JSON.stringify({
      adminCode: $("#adminCode").value.trim(),
      adminSecret: $("#adminSecret").value.trim()
    }));
    $("#connectionDialog").close();
    loadSummary();
  }

  function localDateTime(date, time) {
    if (!date || !time) return "";
    return new Date(`${date}T${time}:00`).toISOString();
  }

  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);
  $("#manualDate").value = today;
  $("#manualTime").value = "08:00";
  $("#backupTo").value = today;
  $("#backupFrom").value = new Date(monthAgo.getTime() - monthAgo.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  $$(".tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("#connectButton").addEventListener("click", openConnection);
  $("#connectionForm").addEventListener("submit", saveConnection);

  credentials().then((auth) => { if (auth) loadSummary(); });

  return { $, $$, escapeHtml, state, toast, read, write, loadSummary, localDateTime };
})();
