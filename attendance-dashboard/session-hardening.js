"use strict";

(() => {
  const STORAGE_KEY = "wts_attendance_admin_connection";
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

  function parseSession(raw) {
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      if (!session?.adminCode || !session?.adminSecret) return null;
      return session;
    } catch {
      return null;
    }
  }

  function isExpired(session) {
    return !session?.expiresAt || Number(session.expiresAt) <= Date.now();
  }

  function normalizeSession(value) {
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

  function migrateLegacyStorage() {
    const legacy = originalGetItem.call(localStorage, STORAGE_KEY);
    if (!legacy) return;
    const session = parseSession(legacy);
    if (session) writeRaw(normalizeSession(legacy));
    originalRemoveItem.call(localStorage, STORAGE_KEY);
  }

  function getActiveSession() {
    const session = parseSession(readRaw());
    if (!session) return null;
    if (isExpired(session)) {
      removeRaw();
      window.dispatchEvent(new CustomEvent("wts-admin-session-expired"));
      return null;
    }
    return session;
  }

  function refreshSession(force = false) {
    const session = getActiveSession();
    if (!session) return false;
    const now = Date.now();
    if (!force && now - lastActivityWrite < ACTIVITY_WRITE_INTERVAL_MS) return true;
    session.lastActivityAt = now;
    session.expiresAt = now + TIMEOUT_MS;
    writeRaw(JSON.stringify(session));
    lastActivityWrite = now;
    scheduleExpiryCheck();
    renderSessionStatus();
    return true;
  }

  function signOut({ reload = true, reason = "signed_out" } = {}) {
    removeRaw();
    originalRemoveItem.call(localStorage, STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("wts-admin-session-ended", { detail: { reason } }));
    if (reload) window.location.reload();
  }

  function maskCode(code) {
    const value = String(code || "Administrator");
    if (value.length <= 8) return value;
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }

  function scheduleExpiryCheck() {
    window.clearTimeout(expiryTimer);
    const session = getActiveSession();
    if (!session) return;
    const delay = Math.max(1000, Number(session.expiresAt) - Date.now() + 100);
    expiryTimer = window.setTimeout(() => {
      if (!getActiveSession()) {
        renderSessionStatus();
        const toast = document.querySelector("#toastContainer");
        if (toast) {
          const message = document.createElement("div");
          message.className = "toast error";
          message.textContent = "Administrator session expired after inactivity. Please sign in again.";
          toast.appendChild(message);
        }
        window.setTimeout(() => window.location.reload(), 1200);
      }
    }, delay);
  }

  function ensureSessionBar() {
    if (document.querySelector("#adminSessionBar")) return;
    const anchor = document.querySelector(".app-shortcuts") || document.querySelector(".topbar");
    if (!anchor) return;
    const bar = document.createElement("div");
    bar.id = "adminSessionBar";
    bar.className = "admin-session-bar";
    bar.hidden = true;
    bar.innerHTML = `
      <div class="admin-session-copy">
        <span class="admin-session-dot"></span>
        <div><strong id="adminSessionIdentity">Secure administrator session</strong><small>Credentials are held only in this browser tab • 20-minute inactivity timeout</small></div>
      </div>
      <button type="button" class="admin-session-signout" id="adminSessionSignOut">Sign out</button>
    `;
    anchor.insertAdjacentElement("afterend", bar);
    bar.querySelector("#adminSessionSignOut").addEventListener("click", () => signOut());
  }

  function injectStyles() {
    if (document.querySelector("#adminSessionStyles")) return;
    const style = document.createElement("style");
    style.id = "adminSessionStyles";
    style.textContent = `
      .admin-session-bar{margin:12px 0 0;padding:11px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #abefc6;border-radius:13px;background:#ecfdf3;color:#075f46;box-shadow:0 6px 18px rgba(15,124,92,.06)}
      .admin-session-bar[hidden]{display:none!important}.admin-session-copy{display:flex;align-items:center;gap:10px;min-width:0}.admin-session-copy strong,.admin-session-copy small{display:block}.admin-session-copy strong{font-size:12px}.admin-session-copy small{margin-top:2px;font-size:9px;color:#087443}.admin-session-dot{width:9px;height:9px;border-radius:50%;background:#12b76a;box-shadow:0 0 0 5px rgba(18,183,106,.13);flex:0 0 auto}.admin-session-signout{border:1px solid #75c9aa;border-radius:9px;padding:7px 10px;background:#fff;color:#075f46;font-size:10px;font-weight:850;white-space:nowrap}
      @media(max-width:820px){.admin-session-bar{margin-top:9px}.admin-session-copy small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:54vw}.admin-session-signout{padding:7px 9px}}
    `;
    document.head.appendChild(style);
  }

  function renderSessionStatus() {
    ensureSessionBar();
    const session = getActiveSession();
    const bar = document.querySelector("#adminSessionBar");
    if (!bar) return;
    bar.hidden = !session;
    if (session) {
      const identity = document.querySelector("#adminSessionIdentity");
      if (identity) identity.textContent = `Signed in: ${maskCode(session.adminCode)}`;
      const connectButton = document.querySelector("#connectButton");
      if (connectButton && !connectButton.textContent.toLowerCase().includes("manage")) connectButton.textContent = "Manage session";
    }
  }

  migrateLegacyStorage();

  Storage.prototype.getItem = function patchedGetItem(key) {
    if (this === localStorage && key === STORAGE_KEY) {
      const session = getActiveSession();
      return session ? JSON.stringify(session) : null;
    }
    return originalGetItem.call(this, key);
  };

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    if (this === localStorage && key === STORAGE_KEY) {
      writeRaw(normalizeSession(value));
      originalRemoveItem.call(localStorage, STORAGE_KEY);
      scheduleExpiryCheck();
      window.setTimeout(renderSessionStatus, 0);
      return;
    }
    return originalSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    if (this === localStorage && key === STORAGE_KEY) {
      removeRaw();
      originalRemoveItem.call(localStorage, STORAGE_KEY);
      window.setTimeout(renderSessionStatus, 0);
      return;
    }
    return originalRemoveItem.call(this, key);
  };

  const activityEvents = ["pointerdown", "keydown", "touchstart", "scroll"];
  activityEvents.forEach((eventName) => window.addEventListener(eventName, () => refreshSession(false), { passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      getActiveSession();
      renderSessionStatus();
      scheduleExpiryCheck();
    }
  });
  window.addEventListener("wts-admin-session-expired", () => renderSessionStatus());
  window.addEventListener("DOMContentLoaded", () => {
    injectStyles();
    renderSessionStatus();
    scheduleExpiryCheck();
  });

  window.WTSAttendanceSession = Object.freeze({
    get: getActiveSession,
    refresh: () => refreshSession(true),
    signOut,
    timeoutMinutes: TIMEOUT_MS / 60000,
  });
})();
