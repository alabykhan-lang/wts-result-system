"use strict";

window.WTSOpsCalendar = (() => {
  const O = window.WTSOps;
  const { $, $$, state, labels, escapeHtml, toast, read, calendarWrite, sessionWrite, loadOverview } = O;

  async function loadCalendar() {
    try {
      const data = await read("calendar", {
        session: "2026/2027",
        from: "2026-08-01",
        to: "2027-08-31"
      });
      state.calendar = data.days || [];
      $("#calendarList").innerHTML = state.calendar.length ? state.calendar.map((day) => `
        <div class="record-card">
          <div><strong>${escapeHtml(day.title)}</strong><span>${escapeHtml(day.calendar_date)} • ${escapeHtml(day.day_type.replaceAll("_", " "))}</span><small>Required: ${(day.attendance_required_for || []).join(", ") || "none"}</small></div>
          <button class="secondary-button delete-calendar" data-id="${day.id}">Delete</button>
        </div>`).join("") : '<div class="empty-state"><h4>No calendar overrides</h4><p>Normal attendance rules remain active until an override is added.</p></div>';
      $$(".delete-calendar").forEach((button) => button.addEventListener("click", deleteCalendarDay));
    } catch (error) { toast(error.message, "error"); }
  }

  async function saveCalendarDay(event) {
    event.preventDefault();
    const required = [];
    if ($("#calendarStudents").checked) required.push("student");
    if ($("#calendarStaff").checked) required.push("staff");

    try {
      await calendarWrite("saveCalendarDay", {
        session: "2026/2027",
        term: "1st Term",
        calendarDate: $("#calendarDate").value,
        dayType: $("#dayType").value,
        title: $("#calendarTitle").value.trim(),
        note: $("#calendarNote").value.trim(),
        attendanceRequiredFor: required,
        checkInOpens: $("#calendarOpen").value,
        onTimeUntil: $("#calendarLate").value,
        absenceCutoff: $("#calendarCutoff").value,
        studentClosingTime: $("#calendarClose").value
      });
      $("#calendarForm").reset();
      toast("Calendar day saved.", "success");
      await Promise.all([loadCalendar(), loadOverview(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function deleteCalendarDay(event) {
    if (!confirm("Delete this calendar override?")) return;
    try {
      await calendarWrite("deleteCalendarDay", { calendarId: event.currentTarget.dataset.id });
      toast("Calendar day deleted.", "success");
      await loadCalendar();
    } catch (error) { toast(error.message, "error"); }
  }

  function populateExceptionStudents() {
    const select = $("#exceptionStudent");
    const unique = new Map();
    state.entries.forEach((entry) => {
      if (entry.student_id) {
        unique.set(entry.student_id, `${entry.full_name} — ${labels[entry.source_class_key] || entry.source_class_key}`);
      }
    });
    select.innerHTML = '<option value="">Select student</option>' + [...unique.entries()].map(([id, label]) =>
      `<option value="${id}">${escapeHtml(label)}</option>`
    ).join("");
  }

  async function loadExceptions() {
    try {
      if (!state.entries.length && window.WTSOpsRoster && $("#batchSelect").value) {
        await window.WTSOpsRoster.loadRoster();
      }
      const data = await read("studentExceptions", { status: "" });
      state.exceptions = data.exceptions || [];
      $("#exceptionList").innerHTML = state.exceptions.length ? state.exceptions.map((item) => `
        <div class="record-card">
          <div><strong>${escapeHtml(item.student_name)}</strong><span>${escapeHtml(item.exception_type.replaceAll("_", " "))} • ${escapeHtml(item.start_date)} to ${escapeHtml(item.end_date)}</span><small>${escapeHtml(item.reason)} • ${escapeHtml(item.status)}</small></div>
          ${item.status !== "cancelled" ? `<button class="secondary-button cancel-exception" data-id="${item.id}">Cancel</button>` : ""}
        </div>`).join("") : '<div class="empty-state"><h4>No student exceptions</h4><p>Approved leave and medical absence will appear here.</p></div>';
      $$(".cancel-exception").forEach((button) => button.addEventListener("click", cancelException));
    } catch (error) { toast(error.message, "error"); }
  }

  async function saveException(event) {
    event.preventDefault();
    try {
      await calendarWrite("saveStudentException", {
        studentId: $("#exceptionStudent").value,
        exceptionType: $("#exceptionType").value,
        startDate: $("#exceptionStart").value,
        endDate: $("#exceptionEnd").value,
        reason: $("#exceptionReason").value.trim(),
        status: $("#exceptionStatus").value
      });
      $("#exceptionForm").reset();
      populateExceptionStudents();
      toast("Student exception saved.", "success");
      await Promise.all([loadExceptions(), loadOverview(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function cancelException(event) {
    if (!confirm("Cancel this student attendance exception?")) return;
    try {
      await calendarWrite("cancelStudentException", { exceptionId: event.currentTarget.dataset.id });
      toast("Student exception cancelled.", "success");
      await loadExceptions();
    } catch (error) { toast(error.message, "error"); }
  }

  async function saveActivation(event) {
    event.preventDefault();
    const rollout = $("#rolloutStage").value;
    if (rollout !== "development" && !confirm(`Move attendance to ${rollout.toUpperCase()} stage?`)) return;

    try {
      await sessionWrite("configureOperationalSession", {
        session: $("#activationSession").value.trim(),
        term: $("#activationTerm").value,
        startDate: $("#activationStart").value,
        endDate: $("#activationEnd").value,
        rolloutStage: rollout,
        automaticAbsenceEnabled: $("#studentAuto").checked,
        staffAutomaticAbsenceEnabled: $("#staffAuto").checked
      });
      toast("Operational session configuration saved.", "success");
      await loadOverview(false);
    } catch (error) { toast(error.message, "error"); }
  }

  $("#calendarForm").addEventListener("submit", saveCalendarDay);
  $("#loadCalendar").addEventListener("click", loadCalendar);
  $("#exceptionForm").addEventListener("submit", saveException);
  $("#loadExceptions").addEventListener("click", loadExceptions);
  $("#activationForm").addEventListener("submit", saveActivation);

  return { loadCalendar, loadExceptions, populateExceptionStudents };
})();

if (window.WTSOps.credentials()) window.WTSOps.loadOverview();
