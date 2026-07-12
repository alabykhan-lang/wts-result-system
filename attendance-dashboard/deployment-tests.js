"use strict";
window.WTSDeployTests = (() => {
  const D = window.WTSDeploy;
  const { $, $$, escapeHtml, state, toast, read, write } = D;

  function statusClass(status) {
    if (status === "pass" || status === "passed") return "success-box";
    if (status === "fail" || status === "failed") return "error-box";
    return "warning-box";
  }

  function renderRuns() {
    $("#testRunList").innerHTML = state.testRuns.length ? state.testRuns.map((run) => `
      <article class="card">
        <div><strong>${escapeHtml(run.test_suite)}</strong><span>${escapeHtml(run.status)} • ${escapeHtml(run.academic_session)}</span><small>${run.passed_count} passed • ${run.warning_count} warnings • ${run.failed_count} failed • ${new Date(run.started_at).toLocaleString("en-NG")}</small></div>
        <div><button class="secondary-button view-test-run" data-id="${run.id}">View</button></div>
      </article>`).join("") : '<div class="empty-state"><h4>No staging test runs</h4></div>';
    $$(".view-test-run").forEach((button) => button.onclick = () => loadResults(button.dataset.id));
  }

  function renderDetails(results) {
    $("#testDetails").innerHTML = results.length ? results.map((item) => `
      <article class="card"><div><strong>${escapeHtml(item.test_name)}</strong><span>${escapeHtml(item.test_code)} • ${escapeHtml(item.status)}</span><small>${escapeHtml(item.detail || "")}</small></div></article>`).join("") : '<div class="empty-state"><h4>No detailed results</h4></div>';
  }

  async function loadRuns() {
    try {
      const data = await read("testRuns");
      state.testRuns = data.runs || [];
      renderRuns();
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadResults(runId) {
    try {
      const data = await read("testResults", { runId });
      renderDetails(data.results || []);
    } catch (error) { toast(error.message, "error"); }
  }

  async function run() {
    if (!confirm("Run the non-destructive staging test suite now?")) return;
    try {
      const result = await write("runStagingTests");
      $("#testResult").innerHTML = `<div class="${statusClass(result.status)}"><strong>${escapeHtml(result.status)}</strong><br>${result.passed} passed • ${result.warnings} warnings • ${result.failed} failed</div>`;
      renderDetails(result.results || []);
      toast("Staging tests completed.", "success");
      await loadRuns();
    } catch (error) { toast(error.message, "error"); }
  }

  $("#runTests").addEventListener("click", run);
  $("#loadTests").addEventListener("click", loadRuns);
  return { loadRuns };
})();
