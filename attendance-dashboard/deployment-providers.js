"use strict";
window.WTSDeployProviders = (() => {
  const D = window.WTSDeploy;
  const { $, $$, escapeHtml, state, toast, read, edge } = D;

  function render(data) {
    state.providers = data.providers || [];
    const counts = data.queue_counts || {};
    $("#queueDraft").textContent = counts.draft || 0;
    $("#queueQueued").textContent = counts.queued || 0;
    $("#queueSending").textContent = counts.sending || 0;
    $("#queueSent").textContent = counts.sent || 0;
    $("#queueFailed").textContent = counts.failed || 0;

    $("#providerList").innerHTML = state.providers.length ? state.providers.map((provider) => `
      <article class="card">
        <div><strong>${escapeHtml(provider.provider_name)}</strong><span>${escapeHtml(provider.channel)} • ${escapeHtml(provider.handler_type)} • ${escapeHtml(provider.status)}</span><small>${provider.is_default ? "Default provider" : "Not default"} • Sender: ${escapeHtml(provider.sender_identity || "Not set")}</small></div>
      </article>`).join("") : '<div class="empty-state"><h4>No providers configured</h4></div>';

    $("#dispatchProvider").innerHTML = state.providers
      .filter((provider) => ["test", "active"].includes(provider.status))
      .map((provider) => `<option value="${provider.provider_code}">${escapeHtml(provider.provider_name)} (${escapeHtml(provider.status)})</option>`)
      .join("");
  }

  async function load() {
    try { render(await read("providers")); }
    catch (error) { toast(error.message, "error"); }
  }

  function renderDispatch(result, dryRun) {
    const className = dryRun || result.claimed === 0 ? "success-box" : "success-box";
    $("#dispatchResult").innerHTML = `<div class="${className}"><strong>${escapeHtml(result.code)}</strong><br>${dryRun ? "No messages were claimed or sent." : `${result.claimed || 0} message(s) processed.`}</div>`;
  }

  async function dispatch(dryRun) {
    const providerCode = $("#dispatchProvider").value;
    if (!dryRun && providerCode !== "mock_sms") {
      return toast("Actual dispatch is allowed only with the mock provider during this stage.", "error");
    }
    if (!dryRun && !confirm("Run the mock dispatcher? It will not contact any parent or incur charges.")) return;
    try {
      const result = await edge("attendance-notification-dispatch", {
        action: "dispatch",
        dryRun,
        providerCode,
        limit: Number($("#dispatchLimit").value || 20)
      });
      renderDispatch(result, dryRun);
      toast(dryRun ? "Dispatch dry run completed." : "Mock dispatch completed.", "success");
      await load();
    } catch (error) { toast(error.message, "error"); }
  }

  $("#loadProviders").addEventListener("click", load);
  $("#dispatchDryRun").addEventListener("click", () => dispatch(true));
  $("#dispatchMock").addEventListener("click", () => dispatch(false));
  return { load };
})();
