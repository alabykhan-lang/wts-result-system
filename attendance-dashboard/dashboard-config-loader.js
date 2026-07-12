"use strict";

window.WTSDashboardConfigReady = (async () => {
  const runtime = window.WTS_ATTENDANCE_RUNTIME_CONFIG;
  if (runtime?.supabaseUrl && runtime?.publishableKey) {
    return Object.freeze({
      supabaseUrl: runtime.supabaseUrl,
      publishableKey: runtime.publishableKey,
      storageKey: runtime.storageKey || "wts_attendance_admin_connection"
    });
  }

  try {
    const response = await fetch("./attendance-config.json", { cache: "no-store" });
    if (response.ok) {
      const config = await response.json();
      if (config?.supabaseUrl && config?.publishableKey) {
        return Object.freeze({
          supabaseUrl: config.supabaseUrl,
          publishableKey: config.publishableKey,
          storageKey: config.storageKey || "wts_attendance_admin_connection"
        });
      }
    }
  } catch {
    // The standalone config file is optional during the current incubation deployment.
  }

  const legacyResponse = await fetch("./app.js", { cache: "no-store" });
  if (!legacyResponse.ok) throw new Error("Unable to read attendance runtime configuration.");
  const source = await legacyResponse.text();
  const url = source.match(/const SUPABASE_URL = "([^"]+)"/);
  const key = source.match(/const PUBLISHABLE_KEY = "([^"]+)"/);
  const store = source.match(/const STORAGE_KEY = "([^"]+)"/);
  if (!url || !key || !store) throw new Error("Attendance runtime configuration is incomplete.");
  return Object.freeze({ supabaseUrl: url[1], publishableKey: key[1], storageKey: store[1] });
})();
