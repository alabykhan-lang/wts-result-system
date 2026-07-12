"use strict";
window.WTSCAttendance = (() => {
  const C = window.WTSC;
  const { $, $$, escapeHtml, state, toast, read, write, loadSummary, localDateTime } = C;

  async function searchPeople(prefix) {
    const personType = $(`#${prefix}PersonType`).value;
    const search = $(`#${prefix}Search`).value.trim();
    if (!search) return toast("Enter a name or number to search.", "error");
    try {
      const data = await read("people", { personType, search });
      const rows = personType === "student" ? data.students || [] : data.staff || [];
      const select = $(`#${prefix}Person`);
      select.innerHTML = '<option value="">Select person</option>' + rows.map((row) => {
        const name = personType === "student" ? row.name : row.full_name;
        const number = personType === "student" ? row.admno : row.staff_number;
        const detail = personType === "student" ? row.class_key : row.designation || row.department;
        return `<option value="${row.id}">${escapeHtml(name)} — ${escapeHtml(number || detail || "")}</option>`;
      }).join("");
    } catch (error) { toast(error.message, "error"); }
  }

  async function submitManual(event) {
    event.preventDefault();
    const date = $("#manualDate").value;
    const time = $("#manualTime").value;
    try {
      await write("createManualEntry", {
        personType: $("#manualPersonType").value,
        personId: $("#manualPerson").value,
        session: "2026/2027",
        term: "1st Term",
        attendanceDate: date,
        eventType: $("#manualEvent").value,
        eventTime: localDateTime(date, time),
        reasonCode: $("#manualReasonCode").value,
        reason: $("#manualReason").value.trim()
      });
      $("#manualReason").value = "";
      toast("Manual-entry request submitted for approval.", "success");
      await Promise.all([loadManual(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  function renderManual() {
    const box = $("#manualList");
    box.innerHTML = state.manual.length ? state.manual.map((item) => `
      <article class="card">
        <div><strong>${escapeHtml(item.person_name)}</strong><span>${escapeHtml(item.event_type.replaceAll("_", " "))} • ${escapeHtml(item.attendance_date)} • ${new Date(item.event_time).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</span><small>${escapeHtml(item.reason_code.replaceAll("_", " "))}: ${escapeHtml(item.reason)} • ${escapeHtml(item.status)}</small></div>
        <div class="inline">${item.status === "pending" ? `<button class="primary-button approve-manual" data-id="${item.id}">Approve</button><button class="secondary-button reject-manual" data-id="${item.id}">Reject</button>` : ""}</div>
      </article>`).join("") : '<div class="empty-state"><h4>No manual-entry requests</h4><p>Forgotten-card and authorized manual requests will appear here.</p></div>';
    $$(".approve-manual").forEach((button) => button.onclick = () => reviewManual(button.dataset.id, true));
    $$(".reject-manual").forEach((button) => button.onclick = () => reviewManual(button.dataset.id, false));
  }

  async function loadManual() {
    try {
      const data = await read("manualEntries", {
        session: "2026/2027",
        from: "2026-01-01",
        to: "2027-12-31",
        status: $("#manualStatus").value
      });
      state.manual = data.requests || [];
      renderManual();
    } catch (error) { toast(error.message, "error"); }
  }

  async function reviewManual(id, approve) {
    const note = prompt(approve ? "Approval note:" : "Reason for rejection:", approve ? "Verified by attendance reviewer" : "Insufficient evidence");
    if (note === null) return;
    try {
      await write(approve ? "approveManualEntry" : "rejectManualEntry", { manualRequestId: id, reviewNote: note });
      toast(approve ? "Manual entry approved and applied." : "Manual entry rejected.", "success");
      await Promise.all([loadManual(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function searchDailyRecords() {
    const personType = $("#correctionPersonType").value;
    const search = $("#correctionSearch").value.trim();
    if (!search) return toast("Enter a name or number to search.", "error");
    try {
      const data = await read("dailyRecords", {
        personType,
        search,
        session: "2026/2027",
        from: "2026-01-01",
        to: "2027-12-31"
      });
      const rows = personType === "student" ? data.student_records || [] : data.staff_records || [];
      $("#correctionDaily").innerHTML = '<option value="">Select daily record</option>' + rows.map((row) => {
        const name = personType === "student" ? row.student_name : row.staff_name;
        return `<option value="${row.id}">${escapeHtml(name)} — ${escapeHtml(row.attendance_date)} — ${escapeHtml(row.daily_status)}</option>`;
      }).join("");
    } catch (error) { toast(error.message, "error"); }
  }

  async function submitCorrection(event) {
    event.preventDefault();
    const toIso = (value) => value ? new Date(value).toISOString() : "";
    try {
      await write("createCorrection", {
        personType: $("#correctionPersonType").value,
        dailyId: $("#correctionDaily").value,
        requestedStatus: $("#correctionStatus").value,
        requestedCheckIn: toIso($("#correctionIn").value),
        requestedCheckOut: toIso($("#correctionOut").value),
        requestedLateMinutes: $("#correctionLate").value,
        reason: $("#correctionReason").value.trim(),
        evidenceNote: $("#correctionEvidence").value.trim()
      });
      $("#correctionReason").value = "";
      $("#correctionEvidence").value = "";
      toast("Correction request submitted for approval.", "success");
      await Promise.all([loadCorrections(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  function renderCorrections() {
    const box = $("#correctionList");
    box.innerHTML = state.corrections.length ? state.corrections.map((item) => `
      <article class="card">
        <div><strong>${escapeHtml(item.person_name)}</strong><span>${escapeHtml(item.attendance_date)} • ${escapeHtml(item.current_status)} → ${escapeHtml(item.requested_status || "unchanged")}</span><small>${escapeHtml(item.reason)} • ${escapeHtml(item.status)}</small></div>
        <div class="inline">${item.status === "pending" ? `<button class="primary-button approve-correction" data-id="${item.id}">Approve</button><button class="secondary-button reject-correction" data-id="${item.id}">Reject</button>` : ""}</div>
      </article>`).join("") : '<div class="empty-state"><h4>No correction requests</h4><p>Append-only correction requests will appear here.</p></div>';
    $$(".approve-correction").forEach((button) => button.onclick = () => reviewCorrection(button.dataset.id, true));
    $$(".reject-correction").forEach((button) => button.onclick = () => reviewCorrection(button.dataset.id, false));
  }

  async function loadCorrections() {
    try {
      const data = await read("corrections", { status: $("#correctionQueueStatus").value });
      state.corrections = data.requests || [];
      renderCorrections();
    } catch (error) { toast(error.message, "error"); }
  }

  async function reviewCorrection(id, approve) {
    const note = prompt(approve ? "Approval note:" : "Reason for rejection:", approve ? "Evidence reviewed and correction approved" : "Correction not supported by evidence");
    if (note === null) return;
    try {
      await write(approve ? "approveCorrection" : "rejectCorrection", { correctionId: id, reviewNote: note });
      toast(approve ? "Correction approved and applied." : "Correction rejected.", "success");
      await Promise.all([loadCorrections(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  $("#manualSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); searchPeople("manual"); } });
  $("#manualForm").addEventListener("submit", submitManual);
  $("#loadManual").addEventListener("click", loadManual);
  $("#manualStatus").addEventListener("change", loadManual);
  $("#correctionSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); searchDailyRecords(); } });
  $("#correctionForm").addEventListener("submit", submitCorrection);
  $("#loadCorrections").addEventListener("click", loadCorrections);
  $("#correctionQueueStatus").addEventListener("change", loadCorrections);

  return { loadManual, loadCorrections };
})();
