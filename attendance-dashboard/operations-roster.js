"use strict";

window.WTSOpsRoster = (() => {
  const O = window.WTSOps;
  const { $, $$, state, labels, classes, escapeHtml, toast, read, rosterWrite, loadOverview } = O;

  function classOptions(selected, includeBlank = true) {
    const blank = includeBlank ? '<option value="">No class</option>' : "";
    return blank + classes.map((key) =>
      `<option value="${key}"${selected === key ? " selected" : ""}>${labels[key]}</option>`
    ).join("");
  }

  function renderRoster(data) {
    state.entries = data.entries || [];
    const availableClasses = [...new Set(state.entries.map((entry) => entry.source_class_key).filter(Boolean))].sort();
    const filter = $("#classFilter");
    const previous = filter.value;
    filter.innerHTML = '<option value="">All classes</option>' + availableClasses.map((key) =>
      `<option value="${key}">${escapeHtml(labels[key] || key)}</option>`
    ).join("");
    if (availableClasses.includes(previous)) filter.value = previous;

    $("#rosterBody").innerHTML = state.entries.map((entry) => `
      <tr data-entry-id="${entry.id}">
        <td><strong>${escapeHtml(entry.full_name)}</strong>${entry.admission_number ? `<br><small>${escapeHtml(entry.admission_number)}</small>` : ""}</td>
        <td>${escapeHtml(labels[entry.source_class_key] || entry.source_class_key || "—")}</td>
        <td>${escapeHtml(labels[entry.proposed_class_key] || entry.proposed_class_key || "—")}</td>
        <td><select class="entry-action">
          <option value="promote"${entry.proposed_action === "promote" ? " selected" : ""}>Promote</option>
          <option value="retain"${entry.proposed_action === "retain" ? " selected" : ""}>Retain</option>
          <option value="graduate"${entry.proposed_action === "graduate" ? " selected" : ""}>Graduate</option>
          <option value="transfer"${entry.proposed_action === "transfer" ? " selected" : ""}>Transfer</option>
          <option value="withdraw"${entry.proposed_action === "withdraw" ? " selected" : ""}>Withdraw</option>
          <option value="exclude"${entry.proposed_action === "exclude" ? " selected" : ""}>Exclude</option>
          <option value="import"${entry.proposed_action === "import" ? " selected" : ""}>Import</option>
        </select></td>
        <td><select class="entry-class">${classOptions(entry.final_class_key)}</select></td>
        <td><select class="entry-status">
          <option value="pending"${entry.decision_status === "pending" ? " selected" : ""}>Pending</option>
          <option value="confirmed"${entry.decision_status === "confirmed" ? " selected" : ""}>Confirmed</option>
          <option value="rejected"${entry.decision_status === "rejected" ? " selected" : ""}>Rejected</option>
        </select></td>
        <td><button class="secondary-button save-entry">Save</button></td>
      </tr>`).join("");

    $$(".save-entry").forEach((button) => button.addEventListener("click", saveEntry));
    if (window.WTSOpsCalendar) window.WTSOpsCalendar.populateExceptionStudents();
  }

  async function loadRoster() {
    const batchId = $("#batchSelect").value;
    if (!batchId) return toast("Select a roster batch.", "error");
    try {
      const data = await read("batchEntries", {
        batchId,
        search: $("#rosterSearch").value.trim(),
        classKey: $("#classFilter").value,
        status: $("#decisionFilter").value
      });
      renderRoster(data);
    } catch (error) { toast(error.message, "error"); }
  }

  async function saveEntry(event) {
    const row = event.currentTarget.closest("tr");
    try {
      await rosterWrite("updateRosterEntry", {
        entryId: row.dataset.entryId,
        proposedAction: row.querySelector(".entry-action").value,
        finalClassKey: row.querySelector(".entry-class").value,
        decisionStatus: row.querySelector(".entry-status").value,
        decisionNote: "Reviewed in attendance operations workspace"
      });
      toast("Roster decision saved.", "success");
      await Promise.all([loadRoster(), loadOverview(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function bulkConfirm() {
    const batchId = $("#batchSelect").value;
    if (!batchId) return toast("Select a roster batch.", "error");
    const classKey = $("#classFilter").value;
    const promptText = classKey
      ? `Confirm pending decisions for ${labels[classKey] || classKey}?`
      : "Confirm every pending decision in this batch?";
    if (!confirm(promptText)) return;

    try {
      const result = await rosterWrite("bulkRosterDecision", {
        batchId,
        sourceClassKey: classKey,
        currentStatus: "pending",
        decisionStatus: "confirmed",
        decisionNote: "Bulk-confirmed after management review"
      });
      toast(`${result.updated || 0} decisions confirmed.`, "success");
      await Promise.all([loadRoster(), loadOverview(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function changeBatchStatus(action, confirmation) {
    const batchId = $("#batchSelect").value;
    if (!batchId) return toast("Select a roster batch.", "error");
    if (confirmation && !confirm(confirmation)) return;

    try {
      await rosterWrite(action, { batchId });
      toast("Roster batch updated.", "success");
      await loadOverview(false);
    } catch (error) { toast(error.message, "error"); }
  }

  async function prepareBatch(action, confirmation) {
    if (!confirm(confirmation)) return;
    try {
      await rosterWrite(action, {
        sourceSession: "2025/2026",
        targetSession: "2026/2027",
        note: action === "preparePortalFinal"
          ? "Final import after third-term promotion and retention completion"
          : "Projection prepared before final promotion decisions"
      });
      toast("Roster batch prepared.", "success");
      await loadOverview(false);
    } catch (error) { toast(error.message, "error"); }
  }

  $("#loadRoster").addEventListener("click", loadRoster);
  $("#confirmVisible").addEventListener("click", bulkConfirm);
  $("#submitReview").addEventListener("click", () => changeBatchStatus("submitRosterReview"));
  $("#approveRoster").addEventListener("click", () => changeBatchStatus("approveRoster", "Approve this roster after resolving every decision?"));
  $("#applyRoster").addEventListener("click", () => changeBatchStatus("applyRoster", "Apply this roster to 2026/2027 attendance? The result portal will not be changed."));
  $("#newProjection").addEventListener("click", () => prepareBatch("prepareProjection", "Create another projection from the current student list?"));
  $("#finalPortalSync").addEventListener("click", () => prepareBatch("preparePortalFinal", "Import current portal classes as the final attendance draft? Do this only after third-term promotion and retention are complete."));

  return { loadRoster };
})();
