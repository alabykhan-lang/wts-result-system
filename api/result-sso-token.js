'use strict';

const crypto = require('node:crypto');

const {
  authStatus,
  readJsonBody,
  requestOriginAllowed,
  sendJson,
  setSessionCookie,
  supabaseRpc,
} = require('./_lib');

const CLIENT_ID = 'result_portal';
// The active Supabase client registration is the production callback below.
// Keep exchange validation pinned to that exact URI; future origins must be
// registered explicitly before they can be used.
const REDIRECT_URI = 'https://wts-result-system.vercel.app/portal_core.html';
const TRANSACTION_COOKIE = 'wts_result_sso_transaction';
const TRANSACTION_MAX_AGE = 5 * 60;

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function transactionCookie(value, maxAge = TRANSACTION_MAX_AGE) {
  return `${TRANSACTION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function appendCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', current ? [...(Array.isArray(current) ? current : [current]), value] : value);
}

function readTransaction(req) {
  const part = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${TRANSACTION_COOKIE}=`));
  if (!part) return null;
  try {
    const raw = decodeURIComponent(part.slice(TRANSACTION_COOKIE.length + 1));
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!parsed || parsed.expires_at < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearTransaction(res) {
  appendCookie(res, transactionCookie('', 0));
}

function isUrlSafe(value, min, max) {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && /^[A-Za-z0-9._~-]+$/.test(value);
}

function safeExchangeResponse(payload) {
  return {
    ok: true,
    code: 'RESULT_SSO_SESSION_ISSUED',
    auth_mode: 'central',
    expires_at: payload.expires_at,
    person: payload.person || null,
    result_user: payload.result_user || null,
    staff: payload.staff || null,
    access_role: payload.access_role || null,
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
  };
}

module.exports = async function resultSsoToken(req, res) {
  if (!requestOriginAllowed(req)) {
    sendJson(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { ok: false, code: 'INVALID_JSON' });
    return;
  }

  if (body.action === 'sso_begin') {
    const verifier = base64Url(crypto.randomBytes(48));
    const state = base64Url(crypto.randomBytes(24));
    const nonce = base64Url(crypto.randomBytes(24));
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const transaction = base64Url(JSON.stringify({ verifier, state, nonce, expires_at: Date.now() + (TRANSACTION_MAX_AGE * 1000) }));
    const portalOrigin = typeof body.portal_origin === 'string' && /^https:\/\/(?:portal\.waytosuccessschools\.com|wts-school-platform(?:-[a-z0-9-]+)?\.vercel\.app)$/.test(body.portal_origin)
      ? body.portal_origin
      : 'https://wts-school-platform.vercel.app';
    const authorize = new URL('/api/sso/authorize', portalOrigin);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', CLIENT_ID);
    authorize.searchParams.set('redirect_uri', REDIRECT_URI);
    authorize.searchParams.set('scope', 'results');
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('nonce', nonce);
    appendCookie(res, transactionCookie(transaction));
    // The cookie is the preferred storage, but Android WebViews can drop a
    // module cookie while navigating to the Staff Portal and back.  Return
    // the short-lived PKCE transaction as well so the same-origin callback
    // can keep it in sessionStorage and submit the verifier explicitly.
    sendJson(res, 200, {
      ok: true,
      authorize_url: authorize.toString(),
      // Keep the flat fields for older portal bundles; the nested object is
      // convenient for newer clients that treat this as one transaction.
      code_verifier: verifier,
      state,
      nonce,
      transaction: { verifier, state, nonce, expires_at: Date.now() + (TRANSACTION_MAX_AGE * 1000) },
    });
    return;
  }

  const grantType = typeof body.grant_type === 'string' ? body.grant_type : '';
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : '';
  const code = typeof body.code === 'string' ? body.code : '';
  const transaction = readTransaction(req);
  const submittedVerifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
  const codeVerifier = submittedVerifier || transaction?.verifier || '';
  const state = typeof body.state === 'string' ? body.state : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';

  if (
    grantType !== 'authorization_code'
    || clientId !== CLIENT_ID
    || redirectUri !== REDIRECT_URI
    || !isUrlSafe(code, 43, 512)
    || !isUrlSafe(codeVerifier, 43, 128)
    || !isUrlSafe(state, 16, 512)
    || !isUrlSafe(nonce, 16, 512)
    // If the WebView retained the cookie, still bind state/nonce to it.  If
    // the callback supplied the short-lived verifier from sessionStorage,
    // use that explicit transaction instead of rejecting a stale cookie from
    // an earlier attempt.
    || (transaction && !submittedVerifier && (state !== transaction.state || nonce !== transaction.nonce))
  ) {
    clearTransaction(res);
    sendJson(res, 400, { ok: false, code: 'SSO_REQUEST_INVALID' });
    return;
  }

  const payload = await supabaseRpc('school_sso_authorization_code_exchange', {
    p_code: code,
    p_client_id: clientId,
    p_redirect_uri: redirectUri,
    p_code_verifier: codeVerifier,
    p_state: state,
    p_nonce: nonce,
  });

  if (!payload?.ok) {
    const codeValue = typeof payload?.code === 'string' ? payload.code : 'SSO_EXCHANGE_FAILED';
    clearTransaction(res);
    sendJson(res, authStatus(codeValue), { ok: false, code: codeValue });
    return;
  }

  if (typeof payload.session_id !== 'string' || typeof payload.session_secret !== 'string') {
    sendJson(res, 503, { ok: false, code: 'RESULT_SESSION_ISSUE_FAILED' });
    return;
  }

  setSessionCookie(res, payload.session_id, payload.session_secret);
  clearTransaction(res);
  sendJson(res, 200, safeExchangeResponse(payload));
};
