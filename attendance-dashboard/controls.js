"use strict";
(function loadControls() {
  const files = [
    "./dashboard-config-loader.js",
    "./controls-core.js",
    "./controls-attendance.js",
    "./controls-communication.js",
    "./controls-admin.js"
  ];

  function load(index) {
    if (index >= files.length) return;
    const script = document.createElement("script");
    script.src = files[index];
    script.async = false;
    script.onload = async () => {
      if (files[index].endsWith("dashboard-config-loader.js")) {
        try { await window.WTSDashboardConfigReady; }
        catch (error) {
          const notice = document.createElement("div");
          notice.className = "toast error";
          notice.textContent = error.message;
          document.querySelector("#toastContainer")?.appendChild(notice);
          return;
        }
      }
      load(index + 1);
    };
    script.onerror = () => {
      const notice = document.createElement("div");
      notice.className = "toast error";
      notice.textContent = `Unable to load ${files[index]}`;
      document.querySelector("#toastContainer")?.appendChild(notice);
    };
    document.body.appendChild(script);
  }

  load(0);
})();
