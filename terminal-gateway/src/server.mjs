import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { EncryptedQueue } from "./queue.mjs";

const config = {
  apiUrl: process.env.WTS_API_URL ||
    "https://wuftzyeajmsxdrbwaawl.supabase.co/functions/v1/attendance-scan",
  deviceCode: process.env.WTS_DEVICE_CODE || "",
  deviceSecret: process.env.WTS_DEVICE_SECRET || "",
  installationId: process.env.WTS_INSTALLATION_ID || "",
  readerKey: process.env.WTS_READER_KEY || "",
  queueKey: process.env.WTS_QUEUE_KEY || "",
  queuePath: resolve(process.env.WTS_QUEUE_PATH || "./data/offline-queue.enc"),
  port: Number(process.env.PORT || process.env.WTS_TERMINAL_PORT || 8787),
  defaultMode: process.env.WTS_DEFAULT_MODE || "check_in",
  latitude: parseOptionalNumber(process.env.WTS_GATE_LATITUDE),
  longitude: parseOptionalNumber(process.env.WTS_GATE_LONGITUDE),
  locationAccuracy: parseOptionalNumber(process.env.WTS_GATE_ACCURACY_METRES) ?? 10,
  syncIntervalMs: Math.max(30_000, Number(process.env.WTS_SYNC_INTERVAL_MS || 60_000))
};

validateConfiguration();
const queue = new EncryptedQueue(config.queuePath, config.queueKey);
await queue.load();

let syncing = false;

function parseOptionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateConfiguration() {
  const missing = [];
  if (!config.deviceCode) missing.push("WTS_DEVICE_CODE");
  if (!config.deviceSecret) missing.push("WTS_DEVICE_SECRET");
  if (!config.installationId) missing.push("WTS_INSTALLATION_ID");
  if (!config.readerKey || config.readerKey.length < 16) missing.push("WTS_READER_KEY (16+ chars)");
  if (!config.queueKey || config.queueKey.length < 16) missing.push("WTS_QUEUE_KEY (16+ chars)");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    missing.push("valid PORT/WTS_TERMINAL_PORT");
  }
  if (!new Set(["check_in", "check_out"]).has(config.defaultMode)) {
    missing.push("WTS_DEFAULT_MODE=check_in or check_out");
  }
  if ((config.latitude === null) !== (config.longitude === null)) {
    missing.push("both WTS_GATE_LATITUDE and WTS_GATE_LONGITUDE");
  }
  if (missing.length) {
    throw new Error(`Terminal configuration incomplete: ${missing.join(", ")}`);
  }
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(text);
}

function authorised(request) {
  const supplied = request.headers["x-wts-reader-key"];
  return typeof supplied === "string" && supplied === config.readerKey;
}

async function readJson(request, limit = 16_384) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function normaliseCredential(value) {
  if (typeof value !== "string") return null;
  const credential = value.trim();
  return credential.length >= 16 && credential.length <= 512 ? credential : null;
}

function buildScan(body, diagnostic = false) {
  const credential = normaliseCredential(body.credential);
  if (!credential) throw new Error("INVALID_CREDENTIAL");

  const eventType = body.eventType || config.defaultMode;
  if (!new Set(["check_in", "check_out"]).has(eventType)) {
    throw new Error("INVALID_EVENT_TYPE");
  }

  const now = new Date();
  const payload = {
    credential,
    clientEventId: typeof body.clientEventId === "string" ? body.clientEventId : randomUUID(),
    eventType,
    source: "standalone_terminal",
    localRecordedAt: now.toISOString(),
    locationCapturedAt: now.toISOString(),
    diagnostic,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined
  };

  if (config.latitude !== null) {
    payload.latitude = config.latitude;
    payload.longitude = config.longitude;
    payload.locationAccuracyMetres = config.locationAccuracy;
  }

  return payload;
}

async function sendToAttendance(payload) {
  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wts-device-code": config.deviceCode,
        "x-wts-device-secret": config.deviceSecret,
        "x-wts-installation-id": config.installationId
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    return {
      transportFailure: true,
      status: 503,
      body: { ok: false, code: "ATTENDANCE_SERVER_UNREACHABLE", detail: error.message }
    };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = { ok: false, code: "INVALID_ATTENDANCE_SERVER_RESPONSE" };
  }

  return {
    transportFailure: response.status >= 500,
    status: response.status,
    body
  };
}

async function processTap(body) {
  const payload = buildScan(body, false);
  const result = await sendToAttendance(payload);

  if (result.transportFailure) {
    const queued = await queue.add(payload);
    return {
      status: 202,
      body: {
        ok: true,
        code: "QUEUED_OFFLINE",
        recorded: false,
        clientEventId: payload.clientEventId,
        queueSize: queued
      }
    };
  }

  return { status: result.status, body: result.body };
}

async function processDiagnostic(body) {
  const payload = buildScan(body, true);
  const result = await sendToAttendance(payload);
  if (result.transportFailure) {
    return {
      status: 503,
      body: { ok: false, code: "DIAGNOSTIC_REQUIRES_CONNECTION" }
    };
  }
  return { status: result.status, body: result.body };
}

async function syncQueue() {
  if (syncing) return { ok: true, code: "SYNC_ALREADY_RUNNING", queueSize: queue.size() };
  syncing = true;
  let synced = 0;

  try {
    while (queue.peek()) {
      const payload = queue.peek();
      const result = await sendToAttendance({ ...payload, source: "offline_sync" });
      if (result.transportFailure) break;

      if (result.body?.ok === true || result.body?.code === "IDEMPOTENT_REPLAY") {
        await queue.remove(payload.clientEventId);
        synced += 1;
        continue;
      }

      if (result.status >= 400 && result.status < 500) {
        await queue.remove(payload.clientEventId);
        synced += 1;
        continue;
      }

      break;
    }

    return { ok: true, code: "SYNC_COMPLETED", synced, queueSize: queue.size() };
  } finally {
    syncing = false;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://terminal.local");

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        service: "wts-attendance-terminal-gateway",
        deviceCode: config.deviceCode,
        defaultMode: config.defaultMode,
        locationConfigured: config.latitude !== null,
        queueSize: queue.size(),
        syncing
      });
    }

    if (!authorised(request)) {
      return json(response, 401, { ok: false, code: "READER_AUTH_FAILED" });
    }

    if (request.method === "POST" && url.pathname === "/tap") {
      const result = await processTap(await readJson(request));
      return json(response, result.status, result.body);
    }

    if (request.method === "POST" && url.pathname === "/diagnostic") {
      const result = await processDiagnostic(await readJson(request));
      return json(response, result.status, result.body);
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      return json(response, 200, await syncQueue());
    }

    return json(response, 404, { ok: false, code: "NOT_FOUND" });
  } catch (error) {
    const code = error?.message || "TERMINAL_ERROR";
    const status = code === "REQUEST_TOO_LARGE" ? 413 : 400;
    return json(response, status, { ok: false, code });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`WTS terminal gateway listening on port ${config.port}`);
  console.log(`Device: ${config.deviceCode}; offline queue: ${queue.size()} item(s)`);
});

setInterval(() => {
  syncQueue().catch((error) => console.error("Offline sync failed:", error.message));
}, config.syncIntervalMs).unref();
