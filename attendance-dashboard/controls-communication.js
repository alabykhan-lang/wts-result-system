"use strict";
window.WTSCCommunication = (() => {
  const C = window.WTSC;
  const { $, $$, escapeHtml, state, toast, read, write, loadSummary } = C;

  async function searchStudent() {
    const search = $("#guardianStudentSearch").value.trim();
    if (!search) return toast("Enter a student name or admission number.", "error");
    try {
      const data = await read("people", { personType: "student", search });
      const students = data.students || [];
      $("#guardianStudent").innerHTML = '<option value="">Select student</option>' + students.map((student) =>
        `<option value="${student.id}">${escapeHtml(student.name)} — ${escapeHtml(student.class_key)} — ${escapeHtml(student.admno || "")}</option>`
      ).join("");
    } catch (error) { toast(error.message, "error"); }
  }

  async function saveGuardian(event) {
    event.preventDefault();
    const channels = [];
    if ($("#guardianSms").checked) channels.push("sms");
    if ($("#guardianWhatsapp").checked) channels.push("whatsapp");
    if ($("#guardianEmailChannel").checked) channels.push("email");
    try {
      await write("saveGuardian", {
        studentId: $("#guardianStudent").value,
        guardianName: $("#guardianName").value.trim(),
        relationship: $("#guardianRelationship").value.trim(),
        phone: $("#guardianPhone").value.trim(),
        email: $("#guardianEmail").value.trim(),
        preferredChannels: channels,
        receivesAlerts: true,
        isPrimary: $("#guardianPrimary").checked,
        status: "active"
      });
      $("#guardianForm").reset();
      $("#guardianSms").checked = true;
      toast("Guardian contact saved.", "success");
      await Promise.all([loadAll(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  function renderGuardians() {
    const items = state.guardians.slice(0, 20);
    $("#guardianList").innerHTML = items.length ? items.map((item) => `
      <article class="card"><div><strong>${escapeHtml(item.student_name)}</strong><span>${escapeHtml(item.guardian_name)}${item.relationship ? ` • ${escapeHtml(item.relationship)}` : ""}</span><small>${escapeHtml(item.phone || item.email || "No destination")} • ${(item.preferred_channels || []).join(", ")}${item.is_primary ? " • Primary" : ""}</small></div></article>`).join("") : '<div class="empty-state"><h4>No guardian contacts</h4><p>Add the primary guardian for each student before notifications are enabled.</p></div>';
  }

  function renderNotifications() {
    $("#notificationList").innerHTML = state.notifications.length ? state.notifications.map((item) => `
      <article class="card">
        <div><strong>${escapeHtml(item.student_name)}</strong><span>${escapeHtml(item.notification_type)} • ${escapeHtml(item.channel)} • ${escapeHtml(item.status)}</span><small>${escapeHtml(item.message)}<br>${escapeHtml(item.destination || "No destination")}</small></div>
        <div class="inline">${item.status === "draft" ? `<button class="primary-button queue-notification" data-id="${item.id}">Queue</button><button class="secondary-button cancel-notification" data-id="${item.id}">Cancel</button>` : item.status === "queued" ? `<button class="secondary-button cancel-notification" data-id="${item.id}">Cancel</button>` : ""}</div>
      </article>`).join("") : '<div class="empty-state"><h4>No notification drafts</h4><p>Absence and lateness notices will appear here after preparation.</p></div>';
    $$(".queue-notification").forEach((button) => button.onclick = () => updateNotification(button.dataset.id, true));
    $$(".cancel-notification").forEach((button) => button.onclick = () => updateNotification(button.dataset.id, false));
  }

  async function loadAll() {
    try {
      const [guardians, notifications] = await Promise.all([
        read("guardians", { status: "active" }),
        read("notifications", { from: "2026-01-01", to: "2027-12-31" })
      ]);
      state.guardians = guardians.guardians || [];
      state.notifications = notifications.notifications || [];
      renderGuardians();
      renderNotifications();
    } catch (error) { toast(error.message, "error"); }
  }

  async function saveNotificationConfig(event) {
    event.preventDefault();
    const channels = [];
    if ($("#notifySms").checked) channels.push("sms");
    if ($("#notifyWhatsapp").checked) channels.push("whatsapp");
    if ($("#notifyEmail").checked) channels.push("email");
    if (!channels.length) return toast("Choose at least one notification channel.", "error");
    try {
      await write("configureNotifications", {
        enabled: $("#notificationsEnabled").value === "true",
        channels
      });
      toast("Notification configuration saved.", "success");
      await loadSummary(false);
    } catch (error) { toast(error.message, "error"); }
  }

  async function prepareNotifications() {
    const date = prompt("Attendance date for notification preparation (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!date) return;
    try {
      const result = await write("prepareNotifications", { date, session: "2026/2027" });
      toast(`${result.inserted || 0} notification draft(s) prepared.`, "success");
      await Promise.all([loadAll(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function updateNotification(id, queue) {
    try {
      await write(queue ? "queueNotification" : "cancelNotification", {
        notificationId: id,
        scheduledAt: new Date().toISOString()
      });
      toast(queue ? "Notification queued for provider delivery." : "Notification cancelled.", "success");
      await Promise.all([loadAll(), loadSummary(false)]);
    } catch (error) { toast(error.message, "error"); }
  }

  $("#guardianStudentSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); searchStudent(); } });
  $("#guardianForm").addEventListener("submit", saveGuardian);
  $("#notificationConfig").addEventListener("submit", saveNotificationConfig);
  $("#prepareNotifications").addEventListener("click", prepareNotifications);
  $("#loadNotifications").addEventListener("click", loadAll);

  return { loadAll };
})();
