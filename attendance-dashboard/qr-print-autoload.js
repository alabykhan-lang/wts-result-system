"use strict";

(() => {
  const payload = sessionStorage.getItem("wts_qr_print_payload");
  if (!payload) return;

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed) || !parsed.length) return;
    const input = document.getElementById("dataInput");
    const generateButton = document.getElementById("generateButton");
    if (!input || !generateButton) return;
    input.value = JSON.stringify(parsed, null, 2);
    generateButton.click();
    sessionStorage.removeItem("wts_qr_print_payload");
  } catch {
    sessionStorage.removeItem("wts_qr_print_payload");
  }
})();
