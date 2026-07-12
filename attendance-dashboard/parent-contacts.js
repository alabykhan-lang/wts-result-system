"use strict";
(() => {
  const $ = (query) => document.querySelector(query);
  const $$ = (query) => [...document.querySelectorAll(query)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
  const state = { contacts: [], students: [] };

  function toast(message, type = "default") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = String(message || "Request failed.");
    $("#toastContainer").appendChild(node);
    setTimeout(() => node.remove(), 4500);
  }

  async function credentials() {
    const cfg = await window.WTSDashboardConfigReady;
    try { return JSON.parse(localStorage.getItem(cfg.storageKey) || "null"); }
    catch { return null; }
  }

  async function rpc(functionName, action, payload = {}) {
    const cfg = await window.WTSDashboardConfigReady;
    const auth = await credentials();
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
    if (!response.ok || data?.ok === false) throw new Error(data?.code || "Parent contact request failed.");
    return data;
  }

  const read = (action, payload = {}) => rpc("attendance_controls_admin_read_api", action, payload);
  const write = (action, payload = {}) => rpc("attendance_parent_contact_admin_write_api", action, payload);

  function selectedChannels() {
    const channels = [];
    if ($("#channelWhatsapp").checked) channels.push("whatsapp");
    if ($("#channelSms").checked) channels.push("sms");
    if ($("#channelEmail").checked) channels.push("email");
    return channels;
  }

  function preferences() {
    return {
      check_in: $("#prefCheckIn").checked,
      late: $("#prefLate").checked,
      absence: $("#prefAbsence").checked,
      check_out: $("#prefCheckOut").checked,
      correction: $("#prefCorrection").checked,
      result_published: $("#prefResult").checked
    };
  }

  function resetForm() {
    $("#contactForm").reset();
    $("#guardianId").value = "";
    $("#studentId").innerHTML = '<option value="">Search first</option>';
    $("#optInStatus").value = "pending";
    $("#preferredLanguage").value = "en";
    $("#receivesAlerts").checked = true;
    $("#channelWhatsapp").checked = true;
    ["#prefCheckIn", "#prefLate", "#prefAbsence", "#prefCheckOut", "#prefCorrection"].forEach((id) => { $(id).checked = true; });
  }

  async function searchStudents() {
    const search = $("#studentSearch").value.trim();
    if (!search) return toast("Enter a student name or admission number.", "error");
    try {
      const data = await read("people", { personType: "student", search });
      state.students = data.students || [];
      $("#studentId").innerHTML = '<option value="">Select student</option>' + state.students.map((student) =>
        `<option value="${student.id}">${escapeHtml(student.name)} — ${escapeHtml(student.class_key)} — ${escapeHtml(student.admno || "")}</option>`
      ).join("");
    } catch (error) { toast(error.message, "error"); }
  }

  function contactMatches(contact) {
    const query = $("#contactSearch").value.trim().toLowerCase();
    const consent = $("#consentFilter").value;
    if (consent && contact.whatsapp_opt_in_status !== consent) return false;
    if (!query) return true;
    return [contact.student_name, contact.guardian_name, contact.phone, contact.whatsapp_number, contact.email, contact.admno]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }

  function renderMetrics() {
    const contacts = state.contacts.filter((contact) => contact.status === "active");
    $("#activeCount").textContent = contacts.length;
    $("#whatsappCount").textContent = contacts.filter((contact) => contact.whatsapp_number).length;
    $("#optedInCount").textContent = contacts.filter((contact) => contact.whatsapp_opt_in_status === "opted_in").length;
    $("#pendingCount").textContent = contacts.filter((contact) => contact.whatsapp_opt_in_status === "pending").length;
    $("#verifiedCount").textContent = contacts.filter((contact) => contact.whatsapp_verified_at).length;
  }

  function renderContacts() {
    const contacts = state.contacts.filter(contactMatches);
    $("#contactList").innerHTML = contacts.length ? contacts.map((contact) => `
      <article class="card">
        <div>
          <strong>${escapeHtml(contact.student_name)} — ${escapeHtml(contact.guardian_name)}</strong>
          <span>${escapeHtml(contact.relationship || "Guardian")} • ${escapeHtml(contact.whatsapp_number || contact.phone || contact.email || "No contact")}</span>
          <small>${escapeHtml(contact.class_key || "")} • ${contact.is_primary ? "Primary contact • " : ""}${contact.whatsapp_verified_at ? "Verified • " : "Unverified • "}${(contact.preferred_channels || []).join(", ")}</small>
          <span class="status ${escapeHtml(contact.whatsapp_opt_in_status || "pending")}">${escapeHtml((contact.whatsapp_opt_in_status || "pending").replaceAll("_", " "))}</span>
        </div>
        <div class="inline"><button class="secondary-button edit-contact" data-id="${contact.id}">Edit</button>${contact.whatsapp_opt_in_status !== "opted_in" ? `<button class="primary-button opt-in-contact" data-id="${contact.id}">Record opt-in</button>` : `<button class="secondary-button opt-out-contact" data-id="${contact.id}">Opt out</button>`}<button class="secondary-button deactivate-contact" data-id="${contact.id}">Deactivate</button></div>
      </article>`).join("") : '<div class="empty-state"><h4>No matching contacts</h4><p>Add a guardian or adjust the search filters.</p></div>';
    $$(".edit-contact").forEach((button) => button.onclick = () => editContact(button.dataset.id));
    $$(".opt-in-contact").forEach((button) => button.onclick = () => recordConsent(button.dataset.id, "opted_in"));
    $$(".opt-out-contact").forEach((button) => button.onclick = () => recordConsent(button.dataset.id, "opted_out"));
    $$(".deactivate-contact").forEach((button) => button.onclick = () => deactivate(button.dataset.id));
  }

  async function loadContacts() {
    try {
      const data = await read("guardians", { status: "active" });
      state.contacts = data.guardians || [];
      renderMetrics();
      renderContacts();
    } catch (error) { toast(error.message, "error"); }
  }

  function editContact(id) {
    const contact = state.contacts.find((item) => item.id === id);
    if (!contact) return;
    $("#guardianId").value = contact.id;
    $("#studentId").innerHTML = `<option value="${contact.student_id}" selected>${escapeHtml(contact.student_name)} — ${escapeHtml(contact.class_key || "")}</option>`;
    $("#guardianName").value = contact.guardian_name || "";
    $("#relationship").value = contact.relationship || "";
    $("#phone").value = contact.phone || "";
    $("#whatsappNumber").value = contact.whatsapp_number || "";
    $("#email").value = contact.email || "";
    $("#preferredLanguage").value = contact.preferred_language || "en";
    $("#optInStatus").value = contact.whatsapp_opt_in_status || "pending";
    $("#optInSource").value = contact.whatsapp_opt_in_source || "";
    $("#primaryContact").checked = contact.is_primary === true;
    $("#verified").checked = Boolean(contact.whatsapp_verified_at);
    $("#receivesAlerts").checked = contact.receives_attendance_alerts !== false;
    const channels = contact.preferred_channels || [];
    $("#channelWhatsapp").checked = channels.includes("whatsapp");
    $("#channelSms").checked = channels.includes("sms");
    $("#channelEmail").checked = channels.includes("email");
    const prefs = contact.notification_preferences || {};
    $("#prefCheckIn").checked = prefs.check_in !== false;
    $("#prefLate").checked = prefs.late !== false;
    $("#prefAbsence").checked = prefs.absence !== false;
    $("#prefCheckOut").checked = prefs.check_out !== false;
    $("#prefCorrection").checked = prefs.correction !== false;
    $("#prefResult").checked = prefs.result_published === true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveContact(event) {
    event.preventDefault();
    const channels = selectedChannels();
    if (!channels.length) return toast("Choose at least one communication channel.", "error");
    try {
      const result = await write("saveParentContact", {
        guardianId: $("#guardianId").value,
        studentId: $("#studentId").value,
        guardianName: $("#guardianName").value.trim(),
        relationship: $("#relationship").value.trim(),
        phone: $("#phone").value.trim(),
        whatsappNumber: $("#whatsappNumber").value.trim(),
        email: $("#email").value.trim(),
        preferredChannels: channels,
        receivesAlerts: $("#receivesAlerts").checked,
        isPrimary: $("#primaryContact").checked,
        verified: $("#verified").checked,
        whatsappOptInStatus: $("#optInStatus").value,
        whatsappOptInSource: $("#optInSource").value,
        preferredLanguage: $("#preferredLanguage").value,
        notificationPreferences: preferences(),
        status: "active"
      });
      toast(`Parent contact saved: ${result.normalized_whatsapp_number || "no WhatsApp number"}.`, "success");
      resetForm();
      await loadContacts();
    } catch (error) { toast(error.message, "error"); }
  }

  async function recordConsent(id, status) {
    const source = prompt("Consent source:", status === "opted_in" ? "school_office" : "whatsapp_reply");
    if (source === null) return;
    try {
      await write("recordWhatsAppConsent", { guardianId: id, status, source });
      toast(`WhatsApp consent updated to ${status.replaceAll("_", " ")}.`, "success");
      await loadContacts();
    } catch (error) { toast(error.message, "error"); }
  }

  async function deactivate(id) {
    if (!confirm("Deactivate this parent contact? Historical records will remain available.")) return;
    try {
      await write("deactivateParentContact", { guardianId: id });
      toast("Parent contact deactivated.", "success");
      await loadContacts();
    } catch (error) { toast(error.message, "error"); }
  }

  async function openConnection() {
    const auth = await credentials();
    $("#adminCode").value = auth?.adminCode || "";
    $("#adminSecret").value = auth?.adminSecret || "";
    $("#connectionDialog").showModal();
  }

  async function saveConnection(event) {
    event.preventDefault();
    const cfg = await window.WTSDashboardConfigReady;
    localStorage.setItem(cfg.storageKey, JSON.stringify({
      adminCode: $("#adminCode").value.trim(),
      adminSecret: $("#adminSecret").value.trim()
    }));
    $("#connectionDialog").close();
    loadContacts();
  }

  $("#studentSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); searchStudents(); } });
  $("#contactForm").addEventListener("submit", saveContact);
  $("#clearForm").addEventListener("click", resetForm);
  $("#loadContacts").addEventListener("click", loadContacts);
  $("#contactSearch").addEventListener("input", renderContacts);
  $("#consentFilter").addEventListener("change", renderContacts);
  $("#connectButton").addEventListener("click", openConnection);
  $("#connectionForm").addEventListener("submit", saveConnection);
  credentials().then((auth) => { if (auth) loadContacts(); });
})();
