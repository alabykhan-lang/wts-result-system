'use strict';

// Write path for an outside assistant (Muse, or any automation).
//
// The portal itself is SSO-only and the scores table only accepts writes from
// the school server, so an agent cannot sign in. It gets a key instead: the key
// names the classroom scope, cannot be used for anything but marks, and every
// call is logged with the person who created it.

const {
  readJsonBody,
  sendJson,
  setSecurityHeaders,
  supabaseRpc,
} = require('./_lib');

const KEY_PATTERN = /^Bearer\s+(wtsak_[A-Za-z0-9]{8,128})$/;

function agentKey(req) {
  const header = String(req.headers.authorization || '').trim();
  const match = KEY_PATTERN.exec(header);
  return match ? match[1] : null;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return value === null || value === undefined ? null : String(value);
}

module.exports = async function agentScores(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const key = agentKey(req);
  if (!key) {
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

  const action = String((body && body.action) || '').trim();
  const payload = body && body.payload && typeof body.payload === 'object' ? body.payload : {};
  const classKey = text(payload.class_key);
  const term = text(payload.term);
  const session = text(payload.academic_session);

  if (action === 'roster') {
    const result = await supabaseRpc('school_result_agent_roster', {
      p_key: key,
      p_class_key: classKey,
      p_term: term,
      p_academic_session: session,
    });
    sendJson(res, result && result.ok ? 200 : 403, result);
    return;
  }

  if (action === 'scores.write') {
    const subjectIndex = payload.subject_index === '' || payload.subject_index === undefined
      ? null
      : Number(payload.subject_index);
    if (!Number.isInteger(subjectIndex)) {
      sendJson(res, 400, { ok: false, code: 'RESULT_SUBJECT_INDEX_REQUIRED' });
      return;
    }
    const clear = Array.isArray(payload.clear)
      ? payload.clear.map((value) => String(value).toLowerCase()).filter((value) => ['ca1', 'ca2', 'ca3', 'exam'].includes(value))
      : [];
    const result = await supabaseRpc('school_result_agent_score_update', {
      p_key: key,
      p_student_id: text(payload.student_id),
      p_class_key: classKey,
      p_subject_index: subjectIndex,
      p_term: term,
      p_academic_session: session,
      p_ca1: numberOrNull(payload.ca1),
      p_ca2: numberOrNull(payload.ca2),
      p_ca3: numberOrNull(payload.ca3),
      p_exam: numberOrNull(payload.exam),
      p_clear_components: clear,
    });
    sendJson(res, result && result.ok ? 200 : 403, result);
    return;
  }

  sendJson(res, 400, {
    ok: false,
    code: 'RESULT_AGENT_ACTION_REQUIRED',
    actions: ['roster', 'scores.write'],
  });
};
