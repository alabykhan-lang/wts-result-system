'use strict';

// Exchange a full-access agent key for a session on one app.
//
// The session belongs to the person who created the key, so the assistant can
// do exactly what that account can do there. It expires after eight hours and
// each session is logged against the key.

const {
  readJsonBody,
  sendJson,
  setSecurityHeaders,
  supabaseRpc,
} = require('./_lib');

const KEY_PATTERN = /^Bearer\s+(wtsak_[A-Za-z0-9]{8,128})$/;
const APPS = ['results', 'central_registry', 'staff_self_service', 'attendance', 'notifications'];

module.exports = async function agentSession(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const match = KEY_PATTERN.exec(String(req.headers.authorization || '').trim());
  if (!match) {
    sendJson(res, 401, { ok: false, code: 'RESULT_AGENT_KEY_REQUIRED' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, code: 'RESULT_BODY_INVALID' });
    return;
  }

  const app = String((body && body.app) || 'results').trim().toLowerCase();
  if (!APPS.includes(app)) {
    sendJson(res, 400, { ok: false, code: 'RESULT_AGENT_APP_INVALID', apps: APPS });
    return;
  }

  const result = await supabaseRpc('school_agent_session', {
    p_key: match[1],
    p_app_code: app,
  });

  if (!result || result.ok !== true) {
    sendJson(res, 403, result || { ok: false, code: 'RESULT_AGENT_SESSION_FAILED' });
    return;
  }

  sendJson(res, 200, result);
};
