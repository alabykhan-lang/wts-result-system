"use strict";
window.WTSDeployRecovery = (() => {
  const D = window.WTSDeploy;
  const { $, escapeHtml, toast, edge, download } = D;

  async function createExport(event) {
    event.preventDefault();
    const passphrase = $("#exportPassphrase").value;
    try {
      const result = await edge("attendance-secure-export", {
        action: "export",
        passphrase,
        session: "2026/2027",
        from: $("#exportFrom").value,
        to: $("#exportTo").value
      });
      download(result.filename, JSON.stringify(result.envelope, null, 2));
      $("#exportResult").innerHTML = `<div class="success-box"><strong>Encrypted export created</strong><br>File: ${escapeHtml(result.filename)}<br>Checksum: <span class="code">${escapeHtml(result.envelope.checksum_sha256)}</span></div>`;
      $("#exportPassphrase").value = "";
      toast("Encrypted recovery package downloaded.", "success");
    } catch (error) { toast(error.message, "error"); }
  }

  async function validateExport(event) {
    event.preventDefault();
    const file = $("#validateFile").files[0];
    if (!file) return toast("Select an encrypted export file.", "error");
    try {
      const envelope = JSON.parse(await file.text());
      const result = await edge("attendance-secure-export", {
        action: "validate",
        passphrase: $("#validatePassphrase").value,
        envelope
      });
      const counts = Object.entries(result.record_counts || {})
        .map(([name, count]) => `${escapeHtml(name)}: ${count}`).join(" • ");
      $("#validateResult").innerHTML = `<div class="success-box"><strong>Package is valid</strong><br>Session: ${escapeHtml(result.academic_session || "—")}<br>Generated: ${escapeHtml(result.generated_at || "—")}<br>Checksum: <span class="code">${escapeHtml(result.checksum_sha256)}</span><br>${counts}<br>Live restore enabled: No</div>`;
      $("#validatePassphrase").value = "";
      toast("Encrypted package validated successfully.", "success");
    } catch (error) { toast(error.message, "error"); }
  }

  $("#exportForm").addEventListener("submit", createExport);
  $("#validateForm").addEventListener("submit", validateExport);
})();
