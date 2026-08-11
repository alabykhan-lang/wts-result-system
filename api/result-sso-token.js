'use strict';

const {
  authStatus,
  readJsonBody,
  requestOriginAllowed,
  sendJson,
  setSessionCookie,
  supabaseRpc,
} = require('./_lib');

const CLIENT_ID = 'result_portal';
const RESULT_ORIGIN = process.env.WTS_RESULT_ORIGIN || 'https://wts-result-system.vercel.app';
const REDIRECT_URI = `${RESULT_ORIGIN.replace(/\/$/, '')}/portal_core.html`;

function isUrlSafe(value, min, max) {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && /^[A-Za-z0-9._~-]+$/.test(value);
}

function safeExchangeResponse(payload, managementAllowed) {
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
    central_registry_management_allowed: managementAllowed === true,
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

  const grantType = typeof body.grant_type === 'string' ? body.grant_type : '';
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : '';
  const code = typeof body.code === 'string' ? body.code : '';
  const codeVerifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
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
  ) {
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
    sendJson(res, authStatus(codeValue), { ok: false, code: codeValue });
    return;
  }

  if (typeof payload.session_id !== 'string' || typeof payload.session_secret !== 'string') {
    sendJson(res, 503, { ok: false, code: 'RESULT_SESSION_ISSUE_FAILED' });
    return;
  }

  let managementAllowed = false;
  try {
    const management = await supabaseRpc('school_result_central_management_access', {
      p_session_id: payload.session_id,
      p_session_secret: payload.session_secret,
    });
    managementAllowed = management?.ok === true && management.central_registry_management_allowed === true;
  } catch {
    managementAllowed = false;
  }

  setSessionCookie(res, payload.session_id, payload.session_secret);
  sendJson(res, 200, safeExchangeResponse(payload, managementAllowed));
};
