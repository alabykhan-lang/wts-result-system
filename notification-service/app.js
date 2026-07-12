"use strict";
(async () => {
  const cfg = await window.WTSNotificationConfigReady;
  const $ = (query) => document.querySelector(query);
  const $$ = (query) => [...document.querySelectorAll(query)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
  const state = { templates: [], messages: [], providers: [] };

  function toast(message) {
    const node = $("#toast");
    node.textContent = String(message || "Request failed.");
    node.classList.remove("hidden");
    setTimeout(() => node.classList.add("hidden"), 4200);
  }

  function credentials() {
    try { return JSON.parse(localStorage.getItem(cfg.storageKey) || "null"); }
    catch { return null; }
  }

  async function rpc(functionName, action, payload = {}) {
    const auth = credentials();
    if (!auth?.adminCode || !auth?.adminSecret) throw new Error("Administrator connection is not configured.");
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
    if (!response.ok || data?.ok === false) throw new Error(data?.code || "Notification request failed.");
    return data;
  }

  const read = (action, payload = {}) => rpc("school_notification_admin_read_api", action, payload);
  const write = (action, payload = {}) => rpc("school_notification_admin_write_api", action, payload);

  function setTab(name) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === `tab-${name}`));
    $$(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    if (name === "messages") loadMessages();
  }

  async function loadSummary() {
    try {
      const data = await read("summary");
      $("#templateCount").textContent = data.templates || 0;
      $("#draftCount").textContent = data.drafts || 0;
      $("#queuedCount").textContent = data.queued || 0;
      $("#sentCount").textContent = data.sent || 0;
      $("#failedCount").textContent = data.failed || 0;
      state.providers = data.providers || [];
      renderProviders();
    } catch (error) { toast(error.message); }
  }

  function renderTemplates() {
    $("#templateList").innerHTML = state.templates.length ? state.templates.map((item) => `
      <article class="card">
        <div><strong>${escapeHtml(item.template_name)}</strong><span>${escapeHtml(item.source_system)} • ${escapeHtml(item.channel)} • ${escapeHtml(item.status)}</span><small>${escapeHtml(item.body_template)}</small></div>
        <div><button class="button secondary edit-template" data-id="${item.id}">Edit</button></div>
      </article>`).join("") : "<p>No templates found.</p>";
    $$(".edit-template").forEach((button) => button.onclick = () => editTemplate(button.dataset.id));
  }

  async function loadTemplates() {
    try {
      const data = await read("templates");
      state.templates = data.templates || [];
      renderTemplates();
    } catch (error) { toast(error.message); }
  }

  function editTemplate(id) {
    const item = state.templates.find((template) => template.id === id);
    if (!item) return;
    $("#templateId").value = item.id;
    $("#templateCode").value = item.template_code;
    $("#templateCode").readOnly = true;
    $("#sourceSystem").value = item.source_system;
    $("#channel").value = item.channel;
    $("#templateName").value = item.template_name;
    $("#bodyTemplate").value = item.body_template;
    $("#variableKeys").value = (item.variable_keys || []).join(",");
    $("#templateStatus").value = item.status;
  }

  async function saveTemplate(event) {
    event.preventDefault();
    try {
      await write("saveTemplate", {
        templateId: $("#templateId").value,
        templateCode: $("#templateCode").value.trim(),
        sourceSystem: $("#sourceSystem").value,
        channel: $("#channel").value,
        templateName: $("#templateName").value.trim(),
        bodyTemplate: $("#bodyTemplate").value.trim(),
        variableKeys: $("#variableKeys").value.split(",").map((value) => value.trim()).filter(Boolean),
        status: $("#templateStatus").value
      });
      $("#templateForm").reset();
      $("#templateId").value = "";
      $("#templateCode").readOnly = false;
      toast("Template saved.");
      await Promise.all([loadTemplates(), loadSummary()]);
    } catch (error) { toast(error.message); }
  }

  function renderMessages() {
    $("#messageList").innerHTML = state.messages.length ? state.messages.map((item) => `
      <article class="card">
        <div><strong>${escapeHtml(item.recipient_name || item.destination || "Draft message")}</strong><span>${escapeHtml(item.source_system)} • ${escapeHtml(item.channel)} • ${escapeHtml(item.status)}</span><small>${escapeHtml(item.message)}</small></div>
        <div class="inline">${item.status === "draft" ? `<button class="button primary queue-message" data-id="${item.id}">Queue</button><button class="button secondary cancel-message" data-id="${item.id}">Cancel</button>` : ""}</div>
      </article>`).join("") : "<p>No messages found.</p>";
    $$(".queue-message").forEach((button) => button.onclick = () => changeMessage(button.dataset.id, true));
    $$(".cancel-message").forEach((button) => button.onclick = () => changeMessage(button.dataset.id, false));
  }

  async function loadMessages() {
    try {
      const data = await read("messages");
      state.messages = data.messages || [];
      renderMessages();
    } catch (error) { toast(error.message); }
  }

  async function createDraft(event) {
    event.preventDefault();
    try {
      await write("createDraft", {
        sourceSystem: $("#messageSource").value,
        sourceEventType: "manual_test",
        recipientType: "other",
        recipientName: $("#recipientName").value.trim(),
        destination: $("#destination").value.trim(),
        channel: "whatsapp",
        message: $("#messageBody").value.trim()
      });
      $("#messageForm").reset();
      toast("Draft created. No message was sent.");
      await Promise.all([loadMessages(), loadSummary()]);
    } catch (error) { toast(error.message); }
  }

  async function changeMessage(id, queue) {
    if (queue && !confirm("Queue this message? Delivery is still blocked until a real provider is activated.")) return;
    try {
      await write(queue ? "queueMessage" : "cancelMessage", {
        messageId: id,
        scheduledAt: new Date().toISOString()
      });
      toast(queue ? "Message queued." : "Message cancelled.");
      await Promise.all([loadMessages(), loadSummary()]);
    } catch (error) { toast(error.message); }
  }

  function renderProviders() {
    $("#providerList").innerHTML = state.providers.length ? state.providers.map((item) => `
      <article class="card"><div><strong>${escapeHtml(item.provider_name)}</strong><span>${escapeHtml(item.channel)} • ${escapeHtml(item.handler_type)} • ${escapeHtml(item.status)}</span><small>${item.is_default ? "Default provider" : "Not default"}</small></div></article>`
    ).join("") : "<p>No providers configured.</p>";
  }

  function openConnection() {
    const auth = credentials();
    $("#adminCode").value = auth?.adminCode || "";
    $("#adminSecret").value = auth?.adminSecret || "";
    $("#connectionDialog").showModal();
  }

  async function saveConnection(event) {
    event.preventDefault();
    localStorage.setItem(cfg.storageKey, JSON.stringify({
      adminCode: $("#adminCode").value.trim(),
      adminSecret: $("#adminSecret").value.trim()
    }));
    $("#connectionDialog").close();
    await Promise.all([loadSummary(), loadTemplates(), loadMessages()]);
  }

  $$(".tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("#templateForm").addEventListener("submit", saveTemplate);
  $("#messageForm").addEventListener("submit", createDraft);
  $("#connectButton").addEventListener("click", openConnection);
  $("#connectionForm").addEventListener("submit", saveConnection);
  if (credentials()) await Promise.all([loadSummary(), loadTemplates(), loadMessages()]);
})();
