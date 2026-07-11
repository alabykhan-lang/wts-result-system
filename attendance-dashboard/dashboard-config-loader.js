"use strict";
window.WTSDashboardConfigReady = fetch("./app.js", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error("Unable to read dashboard configuration.");
    return response.text();
  })
  .then((source) => {
    const url = source.match(/const SUPABASE_URL = "([^"]+)"/);
    const key = source.match(/const PUBLISHABLE_KEY = "([^"]+)"/);
    const store = source.match(/const STORAGE_KEY = "([^"]+)"/);
    if (!url || !key || !store) throw new Error("Dashboard configuration is incomplete.");
    return Object.freeze({ supabaseUrl: url[1], publishableKey: key[1], storageKey: store[1] });
  });
