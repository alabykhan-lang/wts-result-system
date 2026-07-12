"use strict";
window.WTSDeployGuardians = (() => {
  const D = window.WTSDeploy;
  const { $, $$, escapeHtml, state, toast, read, write, download } = D;

  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];
      if (character === '"' && quoted && next === '"') { field += '"'; index += 1; continue; }
      if (character === '"') { quoted = !quoted; continue; }
      if (character === "," && !quoted) { row.push(field); field = ""; continue; }
      if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && next === "\n") index += 1;
        row.push(field); field = "";
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        continue;
      }
      field += character;
    }
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    return rows;
  }

  function mapRows(csvRows) {
    if (csvRows.length < 2) throw new Error("The CSV must contain a header and at least one data row.");
    const headers = csvRows[0].map((value) => value.trim());
    const requiredAny = headers.includes("studentAdmissionNumber") || headers.includes("studentName");
    if (!requiredAny || !headers.includes("guardianName")) {
      throw new Error("CSV headers must include studentAdmissionNumber or studentName, and guardianName.");
    }
    return csvRows.slice(1).map((values) => {
      const record = Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]));
      const preferredChannels = String(record.preferredChannels || "whatsapp")
        .split(/[|;\s]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
      return {
        studentAdmissionNumber: record.studentAdmissionNumber || "",
        studentName: record.studentName || "",
        guardianName: record.guardianName || "",
        relationship: record.relationship || "",
        phone: record.phone || "",
        email: record.email || "",
        preferredChannels: preferredChannels.length ? preferredChannels : ["whatsapp"],
        isPrimary: ["true", "yes", "1", "primary"].includes(String(record.isPrimary || "").toLowerCase())
      };
    });
  }

  function renderImports() {
    $("#importList").innerHTML = state.imports.length ? state.imports.map((batch) => `
      <article class="card">
        <div><strong>${escapeHtml(batch.batch_name)}</strong><span>${escapeHtml(batch.status)} • ${batch.valid_rows}/${batch.total_rows} valid</span><small>${escapeHtml(batch.source_filename || "Manual upload")} • Applied: ${batch.applied_rows || 0} • ${new Date(batch.created_at).toLocaleString("en-NG")}</small></div>
        <div class="inline"><button class="secondary-button view-import" data-id="${batch.id}">Review</button>${["validated", "partially_valid"].includes(batch.status) ? `<button class="primary-button apply-import" data-id="${batch.id}">Apply valid rows</button>` : ""}</div>
      </article>`).join("") : '<div class="empty-state"><h4>No guardian import batches</h4><p>Validated CSV uploads will appear here.</p></div>';
    $$(".view-import").forEach((button) => button.onclick = () => loadRows(button.dataset.id));
    $$(".apply-import").forEach((button) => button.onclick = () => applyBatch(button.dataset.id));
  }

  async function loadImports() {
    try {
      const data = await read("guardianImports");
      state.imports = data.batches || [];
      renderImports();
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadRows(batchId) {
    try {
      const data = await read("guardianImportRows", { batchId });
      const rows = data.rows || [];
      $("#importRows").innerHTML = rows.map((row) => `
        <tr><td>${row.row_number}</td><td>${escapeHtml(row.student_admission_number || row.student_name || "—")}</td><td>${escapeHtml(row.guardian_name)}</td><td>${escapeHtml(row.phone || row.email || "—")}</td><td>${escapeHtml(row.match_status)}</td><td>${escapeHtml((row.validation_errors || []).join(", ") || "None")}</td></tr>`).join("");
      const consentNote = data.batch.status === "applied" ? "<br>Imported WhatsApp numbers remain pending until consent is recorded in the Parent Contact Library." : "";
      $("#guardianValidation").innerHTML = `<div class="${data.batch.status === "validated" || data.batch.status === "applied" ? "success-box" : "warning-box"}"><strong>${escapeHtml(data.batch.status)}</strong><br>${data.batch.valid_rows || 0} valid, ${data.batch.invalid_rows || 0} invalid.${consentNote}</div>`;
    } catch (error) { toast(error.message, "error"); }
  }

  async function validateCsv(event) {
    event.preventDefault();
    const file = $("#guardianCsv").files[0];
    if (!file) return toast("Select a CSV file.", "error");
    try {
      const rows = mapRows(parseCsv(await file.text()));
      const result = await write("validateGuardianImport", {
        batchName: $("#guardianBatchName").value.trim(),
        sourceFilename: file.name,
        rows
      });
      $("#guardianValidation").innerHTML = `<div class="${result.status === "validated" ? "success-box" : "warning-box"}"><strong>${escapeHtml(result.status)}</strong><br>${result.valid_rows} valid row(s); ${result.invalid_rows} blocked row(s). No WhatsApp consent is assumed.</div>`;
      toast("Guardian CSV validation completed.", "success");
      await loadImports();
      await loadRows(result.batch_id);
    } catch (error) { toast(error.message, "error"); }
  }

  async function applyBatch(batchId) {
    if (!confirm("Apply only the validated rows? Imported WhatsApp numbers will remain pending consent.")) return;
    try {
      const result = await write("applyGuardianImport", { batchId });
      toast(`${result.applied_rows} guardian contact(s) applied with pending WhatsApp consent.`, "success");
      await loadImports();
      await loadRows(batchId);
    } catch (error) { toast(error.message, "error"); }
  }

  function template() {
    const content = [
      "studentAdmissionNumber,studentName,guardianName,relationship,phone,email,preferredChannels,isPrimary",
      ",EXACT STUDENT NAME,GUARDIAN NAME,Father,08000000000,,whatsapp,true"
    ].join("\n");
    download("WTS_Parent_WhatsApp_Import_Template.csv", content, "text/csv;charset=utf-8");
  }

  $("#guardianImportForm").addEventListener("submit", validateCsv);
  $("#loadImports").addEventListener("click", loadImports);
  $("#downloadTemplate").addEventListener("click", template);
  return { loadImports };
})();
