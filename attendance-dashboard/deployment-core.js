"use strict";
window.WTSDeploy = (() => {
  const $ = (query) => document.querySelector(query);
  const $$ = (query) => [...document.querySelectorAll(query)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
  const state = { providers: [], imports: [], testRuns: [] };

  async function config() { return window.WTSDashboardConfigReady; }
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
    if (!auth?.adminCode || !auth?.adminSecret) throw new Error("Administrator connection is not configured.");
    const functionName = kind === "read"
      ? "attendance_deployment_admin_read_api"
      : "attendance_deployment_admin_write_api";
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
    if (!response.ok || data?.ok === false) throw new Error(data?.code || "Deployment request failed.");
    return data;
  }

  async function edge(functionName, payload) {
    const cfg = await config();
    const auth = await credentials();
    if (!auth?.adminCode || !auth?.adminSecret) throw new Error("Administrator connection is not configured.");
    const response = await fetch(`${cfg.supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.publishableKey,
        "x-wts-admin-code": auth.adminCode,
        "x-wts-admin-secret": auth.adminSecret
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.code || data?.error || "Edge Function request failed.");
    return data;
  }

  const read = (action, payload = {}) => rpc("read", action, payload);
  const write = (action, payload = {}) => rpc("write", action, payload);

  function setTab(name) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === `tab-${name}`));
    $$(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    if (name === "providers") window.WTSDeployProviders?.load();
    if (name === "guardians") window.WTSDeployGuardians?.loadImports();
    if (name === "tests") window.WTSDeployTests?.loadRuns();
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
    toast("Deployment tools connected.", "success");
    window.WTSDeployProviders?.load();
  }

  function download(filename, content, type = "application/json") {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const yearAgo = new Date(now.getTime() - 365 * 86400000);
  $("#exportTo").value = today;
  $("#exportFrom").value = new Date(yearAgo.getTime() - yearAgo.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  $$(".tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("#connectButton").addEventListener("click", openConnection);
  $("#connectionForm").addEventListener("submit", saveConnection);
  credentials().then((auth) => { if (auth) window.WTSDeployProviders?.load(); });

  return { $, $$, escapeHtml, state, toast, read, write, edge, download, credentials };
})();
