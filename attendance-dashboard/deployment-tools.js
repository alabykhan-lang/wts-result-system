"use strict";
(function loadDeploymentTools() {
  const files = [
    "./deployment-core.js",
    "./deployment-providers.js",
    "./deployment-guardians.js",
    "./deployment-tests.js",
    "./deployment-recovery.js"
  ];

  function load(index) {
    if (index >= files.length) return;
    const script = document.createElement("script");
    script.src = files[index];
    script.async = false;
    script.onload = () => load(index + 1);
    script.onerror = () => {
      const notice = document.createElement("div");
      notice.className = "toast error";
      notice.textContent = `Unable to load ${files[index]}`;
      document.querySelector("#toastContainer")?.appendChild(notice);
    };
    document.body.appendChild(script);
  }

  window.WTSDashboardConfigReady
    .then(() => load(0))
    .catch((error) => {
      const notice = document.createElement("div");
      notice.className = "toast error";
      notice.textContent = error.message;
      document.querySelector("#toastContainer")?.appendChild(notice);
    });
})();
