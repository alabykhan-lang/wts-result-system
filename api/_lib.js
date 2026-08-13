'use strict';

const SUPABASE_URL = process.env.WTS_SUPABASE_URL || 'https://wuftzyeajmsxdrbwaawl.supabase.co';
const SUPABASE_KEY = process.env.WTS_SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZnR6eWVham1zeGRyYndhYXdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjczNTgsImV4cCI6MjA4OTQ0MzM1OH0.QUeDRP1IpHCjvecqAOEZAqmMalEFlCLXylZP5D5iLog';
const COOKIE_NAME = 'wts_result_session';
const SESSION_MAX_AGE = 8 * 60 * 60;
const PRODUCTION_RESULT_ORIGIN = 'https://wts-result-system.vercel.app';
const RESULT_ORIGIN = process.env.WTS_RESULT_ORIGIN || PRODUCTION_RESULT_ORIGIN;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  PRODUCTION_RESULT_ORIGIN,
  RESULT_ORIGIN.replace(/\/$/, ''),
]);

function allowedOrigins() {
  const configured = String(process.env.WTS_RESULT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function requestOriginAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  return allowedOrigins().has(origin);
}

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const cookies = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  });
  return cookies;
}

function sessionFromRequest(req) {
  const value = parseCookies(req)[COOKIE_NAME];
  if (!value) return null;
  const separator = value.indexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;
  return {
    sessionId: value.slice(0, separator),
    sessionSecret: value.slice(separator + 1),
  };
}

function setSessionCookie(res, sessionId, sessionSecret) {
  const value = encodeURIComponent(`${sessionId}.${sessionSecret}`);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function supabaseRpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, code: 'IDENTITY_SERVICE_INVALID_RESPONSE' };
  }
  if (!response.ok && !payload?.code) {
    return { ok: false, code: 'IDENTITY_SERVICE_UNAVAILABLE' };
  }
  return payload;
}

function sendJson(res, status, payload) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function authStatus(code) {
  if (['RESULT_SESSION_REQUIRED', 'RESULT_SESSION_NOT_ACTIVE', 'RESULT_SESSION_AUDIENCE_MISMATCH', 'IDENTITY_CREDENTIAL_NOT_ACTIVE', 'IDENTITY_ACCOUNT_NOT_ACTIVE', 'IDENTITY_PERSON_NOT_ACTIVE', 'IDENTITY_NOT_ACTIVE', 'RESULT_IDENTITY_INACTIVE', 'RESULT_EMPLOYMENT_NOT_ACTIVE', 'WTS_SESSION_NOT_ACTIVE', 'SSO_CENTRAL_SESSION_NOT_ACTIVE'].includes(code)) return 401;
  if (['RESULT_PERMISSION_DENIED', 'RESULT_CLASS_SCOPE_REQUIRED', 'RESULT_CLASS_SCOPE_DENIED', 'RESULT_SUBJECT_SCOPE_REQUIRED', 'RESULT_SUBJECT_SCOPE_DENIED', 'RESULT_ACCESS_NOT_GRANTED', 'RESULT_SCOPE_CONTEXT_REQUIRED', 'RESULT_ACADEMIC_CONTEXT_REQUIRED', 'RESULT_ACADEMIC_SESSION_NOT_ACTIVE', 'RESULT_TERM_NOT_ACTIVE', 'RESULT_TERM_INVALID', 'RESULT_CONTEXT_INVALID', 'RESULT_CONTEXT_MISMATCH', 'RESULT_CLASS_NOT_ASSIGNED', 'RESULT_SUBJECT_NOT_ASSIGNED', 'RESULT_CORRECTION_SOURCE_NOT_ALLOWED'].includes(code)) return 403;
  if (code === 'RESULT_OLD_VALUE_MISMATCH') return 409;
  if (code === 'RESULT_SCORE_RECORD_NOT_FOUND') return 404;
  return 400;
}

module.exports = {
  COOKIE_NAME,
  allowedOrigins,
  authStatus,
  clearSessionCookie,
  readJsonBody,
  requestOriginAllowed,
  sendJson,
  sessionFromRequest,
  setSecurityHeaders,
  setSessionCookie,
  supabaseRpc,
};
