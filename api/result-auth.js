'use strict';

const {
  clearSessionCookie,
  readJsonBody,
  requestOriginAllowed,
  sendJson,
  sessionFromRequest,
  setSessionCookie,
  supabaseRpc,
} = require('./_lib');

function safeLoginResponse(payload) {
  return {
    ok: true,
    code: payload.code,
    auth_mode: 'central',
    expires_at: payload.expires_at,
    person: payload.person,
    result_user: payload.result_user,
    access_role: payload.access_role,
    permissions: payload.permissions,
  };
}

module.exports = async function resultAuth(req, res) {
  if (!requestOriginAllowed(req)) {
    sendJson(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    return;
  }

  if (req.method === 'GET') {
    const session = sessionFromRequest(req);
    if (!session) {
      clearSessionCookie(res);
      sendJson(res, 401, { ok: false, code: 'RESULT_SESSION_REQUIRED' });
      return;
    }
    const payload = await supabaseRpc('school_result_api', {
      p_session_id: session.sessionId,
      p_session_secret: session.sessionSecret,
      p_action: 'identity.context',
      p_payload: {},
    });
    if (!payload?.ok) {
      clearSessionCookie(res);
      sendJson(res, 401, payload || { ok: false, code: 'RESULT_SESSION_NOT_ACTIVE' });
      return;
    }
    sendJson(res, 200, {
      ...payload,
      auth_mode: 'central',
    });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, code: 'INVALID_JSON' });
    return;
  }

  if (body.action === 'logout') {
    const session = sessionFromRequest(req);
    if (session) {
      await supabaseRpc('school_identity_session_revoke', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_reason: 'RESULT_PORTAL_LOGOUT',
      });
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true, code: 'RESULT_LOGOUT_SUCCESS' });
    return;
  }

  if (body.action === 'change_password') {
    sendJson(res, 403, { ok: false, code: 'CENTRAL_PASSWORD_MANAGEMENT_REQUIRED' });
    return;
  }

  if (body.action === 'login') {
    sendJson(res, 400, { ok: false, code: 'SSO_REQUIRED' });
    return;
  }

  sendJson(res, 400, { ok: false, code: 'AUTH_ACTION_NOT_SUPPORTED' });

};

