"use strict";

(() => {
  const STORAGE_KEY = "wts_notification_admin_connection";
  const TIMEOUT_MS = 20 * 60 * 1000;
  const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  let lastActivityWrite = 0;
  let expiryTimer = null;

  const readRaw = () => originalGetItem.call(sessionStorage, STORAGE_KEY);
  const writeRaw = (value) => originalSetItem.call(sessionStorage, STORAGE_KEY, value);
  const removeRaw = () => originalRemoveItem.call(sessionStorage, STORAGE_KEY);

  function parse(raw) {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      return value?.adminCode && value?.adminSecret ? value : null;
    } catch {
      return null;
    }
  }

  function normalize(value) {
    const now = Date.now();
    let session;
    try { session = JSON.parse(String(value)); } catch { session = null; }
    if (!session?.adminCode || !session?.adminSecret) return String(value);
    return JSON.stringify({
      adminCode: String(session.adminCode).trim(),
      adminSecret: String(session.adminSecret),
      issuedAt: Number(session.issuedAt) || now,
      lastActivityAt: now,
      expiresAt: now + TIMEOUT_MS,
      storageMode: "tab_session",
    });
  }

  function migrateLegacy() {
    const legacy = originalGetItem.call(localStorage, STORAGE_KEY);
    if (parse(legacy)) writeRaw(normalize(legacy));
    originalRemoveItem.call(localStorage, STORAGE_KEY);
  }

  function activeSession() {
    const session = parse(readRaw());
    if (!session) return null;
    if (!session.expiresAt || Number(session.expiresAt) <= Date.now()) {
      removeRaw();
      window.dispatchEvent(new CustomEvent("wts-notification-session-expired"));
      return null;
    }
    return session;
  }

  function refresh(force = false) {
    const session = activeSession();
    if (!session) return false;
    const now = Date.now();
    if (!force && now - lastActivityWrite < ACTIVITY_WRITE_INTERVAL_MS) return true;
    session.lastActivityAt = now;
    session.expiresAt = now + TIMEOUT_MS;
    writeRaw(JSON.stringify(session));
    lastActivityWrite = now;
    scheduleExpiry();
    render();
    return true;
  }

  function signOut(reload = true) {
    removeRaw();
    originalRemoveItem.call(localStorage, STORAGE_KEY);
    if (reload) window.location.reload();
  }

  function mask(code) {
    const value = String(code || "Administrator");
    return value.length <= 8 ? value : `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }

  function injectStyles() {
    if (document.querySelector("#notificationSessionStyles")) return;
    const style = document.createElement("style");
    style.id = "notificationSessionStyles";
    style.textContent = `
      .notification-session-bar{margin:14px 0;padding:11px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #abefc6;border-radius:13px;background:#ecfdf3;color:#075f46;box-shadow:0 6px 18px rgba(15,124,92,.06)}
      .notification-session-bar[hidden]{display:none!important}.notification-session-copy{display:flex;align-items:center;gap:10px;min-width:0}.notification-session-copy strong,.notification-session-copy small{display:block}.notification-session-copy strong{font-size:12px}.notification-session-copy small{margin-top:2px;font-size:9px;color:#087443}.notification-session-dot{width:9px;height:9px;border-radius:50%;background:#12b76a;box-shadow:0 0 0 5px rgba(18,183,106,.13);flex:0 0 auto}.notification-session-signout{border:1px solid #75c9aa;border-radius:9px;padding:7px 10px;background:#fff;color:#075f46;font-size:10px;font-weight:850;white-space:nowrap}
      @media(max-width:900px){.notification-session-copy small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:56vw}}
    `;
    document.head.appendChild(style);
  }

  function ensureBar() {
    if (document.querySelector("#notificationSessionBar")) return;
    const anchor = document.querySelector(".system-links") || document.querySelector(".hero");
    if (!anchor) return;
    const bar = document.createElement("div");
    bar.id = "notificationSessionBar";
    bar.className = "notification-session-bar";
    bar.hidden = true;
    bar.innerHTML = `
      <div class="notification-session-copy"><span class="notification-session-dot"></span><div><strong id="notificationSessionIdentity">Secure administrator session</strong><small>Credentials are held only in this browser tab • 20-minute inactivity timeout</small></div></div>
      <button type="button" class="notification-session-signout" id="notificationSessionSignOut">Sign out</button>
    `;
    anchor.insertAdjacentElement("afterend", bar);
    bar.querySelector("#notificationSessionSignOut").addEventListener("click", () => signOut(true));
  }

  function render() {
    ensureBar();
    const session = activeSession();
    const bar = document.querySelector("#notificationSessionBar");
    if (!bar) return;
    bar.hidden = !session;
    if (session) {
      const identity = document.querySelector("#notificationSessionIdentity");
      if (identity) identity.textContent = `Signed in: ${mask(session.adminCode)}`;
      const connect = document.querySelector("#connectButton");
      if (connect) connect.textContent = "Manage session";
    }
  }

  function scheduleExpiry() {
    window.clearTimeout(expiryTimer);
    const session = activeSession();
    if (!session) return;
    expiryTimer = window.setTimeout(() => {
      if (!activeSession()) {
        render();
        const target = document.querySelector("#toastContainer");
        if (target) {
          const item = document.createElement("div");
          item.className = "toast error";
          item.textContent = "Administrator session expired after inactivity. Please sign in again.";
          target.appendChild(item);
        }
        window.setTimeout(() => window.location.reload(), 1200);
      }
    }, Math.max(1000, Number(session.expiresAt) - Date.now() + 100));
  }

  migrateLegacy();

  Storage.prototype.getItem = function patchedGetItem(key) {
    if (this === localStorage && key === STORAGE_KEY) {
      const session = activeSession();
      return session ? JSON.stringify(session) : null;
    }
    return originalGetItem.call(this, key);
  };

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    if (this === localStorage && key === STORAGE_KEY) {
      writeRaw(normalize(value));
      originalRemoveItem.call(localStorage, STORAGE_KEY);
      scheduleExpiry();
      window.setTimeout(render, 0);
      return;
    }
    return originalSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    if (this === localStorage && key === STORAGE_KEY) {
      removeRaw();
      originalRemoveItem.call(localStorage, STORAGE_KEY);
      window.setTimeout(render, 0);
      return;
    }
    return originalRemoveItem.call(this, key);
  };

  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((name) => window.addEventListener(name, () => refresh(false), { passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      activeSession();
      render();
      scheduleExpiry();
    }
  });
  window.addEventListener("DOMContentLoaded", () => {
    injectStyles();
    render();
    scheduleExpiry();
  });

  window.WTSNotificationSession = Object.freeze({ get: activeSession, refresh: () => refresh(true), signOut, timeoutMinutes: 20 });
})();
