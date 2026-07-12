"use strict";

(function loadOperationsModules() {
  const modules = [
    "./operations-core.js",
    "./operations-roster.js",
    "./operations-calendar.js"
  ];

  function load(index) {
    if (index >= modules.length) return;
    const script = document.createElement("script");
    script.src = modules[index];
    script.async = false;
    script.onload = () => load(index + 1);
    script.onerror = () => {
      const container = document.querySelector("#toastContainer");
      if (!container) return;
      const notice = document.createElement("div");
      notice.className = "toast error";
      notice.textContent = `Unable to load attendance operations module: ${modules[index]}`;
      container.appendChild(notice);
    };
    document.body.appendChild(script);
  }

  load(0);
})();
