"use strict";

const crypto = require("node:crypto");

const MAX_BATCH = 100;
const DEFAULT_BATCH = 25;
const RESPONSE_LIMIT = 4000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH;
  return Math.max(1, Math.min(parsed, MAX_BATCH));
}

function maskDestination(value) {
  const text = String(value || "");
  if (text.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`;
}

function truncate(value, length = 500) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function safeResponseSnapshot(value) {
  if (value == null) return {};
  if (typeof value === "string") return { body: truncate(value, RESPONSE_LIMIT) };
  try {
    const clone = JSON.parse(JSON.stringify(value));
    for (const key of ["token", "access_token", "authorization", "api_key", "apikey", "secret"]) {
      if (Object.prototype.hasOwnProperty.call(clone, key)) clone[key] = "[redacted]";
    }
    return clone;
  } catch {
    return { body: truncate(value, RESPONSE_LIMIT) };
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function supabaseRpc(name, args, env) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: truncate(text, RESPONSE_LIMIT) }; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Supabase RPC ${name} failed`);
    error.code = `SUPABASE_${response.status}`;
    error.snapshot = safeResponseSnapshot(data);
    throw error;
  }
  return data;
}

function envForRequest() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const workerSecret = process.env.WTS_NOTIFICATION_WORKER_SECRET || "";
  if (!supabaseUrl || !serviceRoleKey || !workerSecret) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey, workerSecret };
}

function providerEnvironment(message) {
  const prefix = String(message.secret_env_prefix || "WTS_WHATSAPP_GATEWAY").replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
  const endpoint = process.env[`${prefix}_ENDPOINT`] || "";
  const token = process.env[`${prefix}_TOKEN`] || process.env[`${prefix}_API_KEY`] || "";
  const allowedHosts = String(process.env.WTS_WHATSAPP_ALLOWED_HOSTS || "")
    .split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  return { prefix, endpoint, token, allowedHosts };
}

function validateEndpoint(endpoint, allowedHosts) {
  let url;
  try { url = new URL(endpoint); }
  catch { throw Object.assign(new Error("Provider endpoint is invalid"), { code: "INVALID_PROVIDER_ENDPOINT" }); }
  if (url.protocol !== "https:") {
    throw Object.assign(new Error("Provider endpoint must use HTTPS"), { code: "INSECURE_PROVIDER_ENDPOINT" });
  }
  if (!allowedHosts.length || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw Object.assign(new Error("Provider endpoint host is not allow-listed"), { code: "PROVIDER_HOST_NOT_ALLOWED" });
  }
  return url.toString();
}

function providerReference(data) {
  if (!data || typeof data !== "object") return null;
  return data.id || data.message_id || data.messageId || data.reference || data.request_id || null;
}

function retryAfterSeconds(response) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(30, seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(30, Math.ceil((date - Date.now()) / 1000));
  return null;
}

async function sendExternal(message) {
  const env = providerEnvironment(message);
  const endpoint = validateEndpoint(env.endpoint, env.allowedHosts);
  if (!env.token) throw Object.assign(new Error("Provider credential is missing"), { code: "PROVIDER_CREDENTIAL_MISSING" });

  const config = message.configuration || {};
  const authHeader = String(config.auth_header || "Authorization");
  const authScheme = String(config.auth_scheme || "Bearer");
  const headers = { "Content-Type": "application/json" };
  headers[authHeader] = authScheme ? `${authScheme} ${env.token}` : env.token;

  const payload = {
    to: message.destination,
    message: message.message,
    sender: message.sender_identity || "WTS SCHOOL",
    reference: message.id,
    language: message.language_code || "en",
    metadata: {
      source_system: message.source_system,
      source_event_type: message.source_event_type,
      recipient_type: message.recipient_type,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { body: truncate(text, RESPONSE_LIMIT) }; }

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Provider returned HTTP ${response.status}`);
    error.code = `PROVIDER_HTTP_${response.status}`;
    error.retryAfter = retryAfterSeconds(response);
    error.snapshot = safeResponseSnapshot(data);
    throw error;
  }
  return { reference: providerReference(data), snapshot: safeResponseSnapshot(data) };
}

async function complete(message, workerId, success, details, env) {
  return supabaseRpc("complete_school_notification_attempt", {
    p_message_id: message.id,
    p_worker_id: workerId,
    p_success: success,
    p_provider_reference: details.reference || null,
    p_response: details.snapshot || {},
    p_error_code: details.errorCode || null,
    p_error_message: details.errorMessage || null,
    p_retry_after_seconds: details.retryAfter || null,
  }, env);
}

async function processMessage(message, workerId, env) {
  try {
    if (message.handler_type === "mock") {
      const reference = `mock-${crypto.randomUUID()}`;
      const completion = await complete(message, workerId, true, {
        reference,
        snapshot: { mock: true, accepted: true, destination: maskDestination(message.destination) },
      }, env);
      return { id: message.id, status: completion.status || "sent", destination: maskDestination(message.destination) };
    }

    if (message.handler_type !== "edge_env") {
      throw Object.assign(new Error(`Unsupported provider handler: ${message.handler_type}`), { code: "UNSUPPORTED_PROVIDER_HANDLER" });
    }

    const result = await sendExternal(message);
    const completion = await complete(message, workerId, true, result, env);
    return { id: message.id, status: completion.status || "sent", destination: maskDestination(message.destination) };
  } catch (error) {
    let completion;
    try {
      completion = await complete(message, workerId, false, {
        snapshot: error.snapshot || {},
        errorCode: error.code || "DELIVERY_ERROR",
        errorMessage: truncate(error.message, 500),
        retryAfter: error.retryAfter || null,
      }, env);
    } catch (completionError) {
      return {
        id: message.id,
        status: "completion_failed",
        destination: maskDestination(message.destination),
        error: truncate(completionError.message, 250),
      };
    }
    return {
      id: message.id,
      status: completion.status || "failed",
      destination: maskDestination(message.destination),
      error: truncate(error.message, 250),
    };
  }
}

module.exports = async function handler(req, res) {
  const env = envForRequest();
  if (!env) return json(res, 503, { ok: false, code: "WORKER_ENVIRONMENT_NOT_CONFIGURED" });
  if (!constantTimeEqual(bearerToken(req), env.workerSecret)) {
    return json(res, 401, { ok: false, code: "WORKER_AUTH_FAILED" });
  }

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      code: "NOTIFICATION_WORKER_READY",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      timestamp: new Date().toISOString(),
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  const body = await readBody(req);
  const limit = clampLimit(body.limit);
  const providerCode = body.providerCode ? String(body.providerCode).trim() : null;
  const workerId = `vercel-${process.env.VERCEL_REGION || "local"}-${crypto.randomUUID()}`;

  try {
    const claim = await supabaseRpc("claim_school_notifications", {
      p_worker_id: workerId,
      p_limit: limit,
      p_provider_code: providerCode,
    }, env);

    if (claim?.ok === false) {
      return json(res, 409, { ok: false, code: claim.code || "CLAIM_REJECTED", claimed: 0 });
    }

    const messages = Array.isArray(claim.messages) ? claim.messages : [];
    const results = [];
    for (const message of messages) results.push(await processMessage(message, workerId, env));

    return json(res, 200, {
      ok: true,
      code: "NOTIFICATION_WORKER_COMPLETED",
      provider_code: claim.provider_code || providerCode,
      dry_run: claim.dry_run === true,
      claimed: messages.length,
      sent: results.filter(item => item.status === "sent").length,
      queued_for_retry: results.filter(item => item.status === "queued").length,
      failed: results.filter(item => !["sent", "queued"].includes(item.status)).length,
      results,
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      code: error.code || "WORKER_EXECUTION_FAILED",
      message: truncate(error.message, 250),
    });
  }
};
