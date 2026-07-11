"use strict";
window.WTSCAdmin = (() => {
  const C = window.WTSC;
  const { $, $$, escapeHtml, state, toast, read, write, loadSummary } = C;

  function renderRoles() {
    $("#newAdminRole").innerHTML = state.roles.map((role) =>
      `<option value="${role.id}">${escapeHtml(role.role_name)} — ${escapeHtml(role.description || "")}</option>`
    ).join("");

    $("#adminList").innerHTML = state.clients.length ? state.clients.map((client) => `
      <article class="card">
        <div><strong>${escapeHtml(client.client_name)}</strong><span>${escapeHtml(client.client_code)} • ${escapeHtml(client.status)}</span><small>Roles: ${(client.roles || []).map((role) => escapeHtml(role.role_name)).join(", ") || "None"}<br>Effective permissions: ${(client.effective_permissions || []).join(", ")}</small></div>
        <div class="inline">${client.status === "active" ? `<button class="secondary-button suspend-client" data-id="${client.id}">Suspend</button>` : `<button class="secondary-button activate-client" data-id="${client.id}">Activate</button>`}</div>
      </article>`).join("") : '<div class="empty-state"><h4>No administrator clients</h4></div>';
    $$(".suspend-client").forEach((button) => button.onclick = () => changeClientStatus(button.dataset.id, false));
    $$(".activate-client").forEach((button) => button.onclick = () => changeClientStatus(button.dataset.id, true));
  }

  async function loadRoles() {
    try {
      const data = await read("roles");
      state.roles = data.roles || [];
      state.clients = data.clients || [];
      renderRoles();
    } catch (error) { toast(error.message, "error"); }
  }

  async function createAdmin(event) {
    event.preventDefault();
    try {
      const result = await write("createAdminClient", {
        clientCode: $("#newAdminCode").value.trim(),
        clientName: $("#newAdminName").value.trim(),
        roleId: $("#newAdminRole").value
      });
      $("#newSecret").classList.remove("hidden");
      $("#newSecret").innerHTML = `<strong>Save this one-time secret now:</strong><br>${escapeHtml(result.client_secret)}<br><small>Client code: ${escapeHtml(result.client_code)}</small>`;
      $("#adminForm").reset();
      toast("Restricted administrator created.", "success");
      await Promise.all([loadRoles(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function changeClientStatus(id, activate) {
    if (!confirm(`${activate ? "Activate" : "Suspend"} this administrator client?`)) return;
    try {
      await write(activate ? "activateAdminClient" : "suspendAdminClient", { clientId: id });
      toast(`Administrator ${activate ? "activated" : "suspended"}.`, "success");
      await loadRoles();
    } catch (error) { toast(error.message, "error"); }
  }

  function renderBackups() {
    const items = [
      ...state.readiness.map((item) => ({ type: "readiness", date: item.created_at, item })),
      ...state.backups.map((item) => ({ type: "backup", date: item.created_at, item }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    $("#backupList").innerHTML = items.length ? items.slice(0, 100).map(({ type, item }) => type === "backup" ? `
      <article class="card"><div><strong>Backup manifest: ${escapeHtml(item.manifest_type)}</strong><span>${escapeHtml(item.academic_session || "—")} • ${escapeHtml(item.status)} • ${new Date(item.created_at).toLocaleString("en-NG")}</span><small>Checksum: ${escapeHtml(item.checksum_sha256 || "—")}</small></div></article>` : `
      <article class="card"><div><strong>Deployment readiness: ${escapeHtml(item.overall_status.toUpperCase())}</strong><span>${escapeHtml(item.rollout_stage)} • ${new Date(item.created_at).toLocaleString("en-NG")}</span><small>${(item.checks || []).map((check) => `${check.code}: ${check.status}`).join(" • ")}</small></div></article>`).join("") : '<div class="empty-state"><h4>No backup or readiness records</h4></div>';
  }

  async function loadBackups() {
    try {
      const data = await read("backups");
      state.backups = data.manifests || [];
      state.readiness = data.readiness || [];
      renderBackups();
    } catch (error) { toast(error.message, "error"); }
  }

  function renderReadiness(result) {
    const statusClass = result.overall_status === "pass" ? "success-box" : "warning-box";
    $("#readinessResult").innerHTML = `<div class="${statusClass}"><strong>Overall status: ${escapeHtml(result.overall_status.toUpperCase())}</strong><br>${(result.checks || []).map((check) => `${escapeHtml(check.code)} — ${escapeHtml(check.status)}`).join("<br>")}</div>`;
  }

  async function runReadiness() {
    try {
      const result = await write("runDeploymentReadiness");
      renderReadiness(result);
      toast("Deployment-readiness check completed.", "success");
      await Promise.all([loadBackups(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function createBackup(event) {
    event.preventDefault();
    try {
      const result = await write("createBackupManifest", {
        manifestType: $("#backupType").value,
        session: "2026/2027",
        from: $("#backupFrom").value,
        to: $("#backupTo").value
      });
      $("#backupResult").innerHTML = `<div class="success-box"><strong>Manifest created</strong><br>Checksum: ${escapeHtml(result.checksum_sha256)}<br>Rows: ${escapeHtml(JSON.stringify(result.row_counts))}</div>`;
      downloadJson(`wts_attendance_manifest_${result.manifest_id}.json`, result);
      toast("Backup manifest created and downloaded.", "success");
      await Promise.all([loadBackups(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  $("#adminForm").addEventListener("submit", createAdmin);
  $("#loadRoles").addEventListener("click", loadRoles);
  $("#runReadiness").addEventListener("click", runReadiness);
  $("#backupForm").addEventListener("submit", createBackup);
  $("#loadBackups").addEventListener("click", loadBackups);

  return { loadRoles, loadBackups };
})();
