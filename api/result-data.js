'use strict';

const {
  authStatus,
  readJsonBody,
  requestOriginAllowed,
  sendJson,
  sessionFromRequest,
  supabaseRpc,
} = require('./_lib');
const smartRecording = require('./smart-recording');

module.exports = async function resultData(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (!requestOriginAllowed(req)) {
    sendJson(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    return;
  }

  const session = sessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, code: 'RESULT_SESSION_REQUIRED' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body.action !== 'string' || !body.action.trim()) {
    sendJson(res, 400, { ok: false, code: 'RESULT_ACTION_REQUIRED' });
    return;
  }

  const action = body.action.trim();
  if (action === 'students.upsert' || action === 'students.archive') {
    sendJson(res, 403, { ok: false, code: 'RESULT_STUDENT_MUTATION_REGISTRY_ONLY' });
    return;
  }
  const requestPayload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  let payload = action === 'staff.write_access.read'
    ? await supabaseRpc('school_result_staff_write_access_read', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
      })
    : action === 'staff.write_access.update'
      ? await supabaseRpc('school_result_staff_write_access_update', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
          p_person_id: requestPayload.person_id || null,
          p_write_enabled: requestPayload.write_enabled === true,
          p_reason: typeof requestPayload.reason === 'string' ? requestPayload.reason : null,
        })
    : action === 'staff.write_access.bulk'
      ? await supabaseRpc('school_result_staff_write_access_bulk', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
          p_write_enabled: requestPayload.write_enabled === true,
          p_reason: typeof requestPayload.reason === 'string' ? requestPayload.reason : null,
        })
    : action === 'smart.sheet.create'
    ? await supabaseRpc('school_result_smart_sheet_create', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_class_key: requestPayload.class_key || null,
        p_subject_index: requestPayload.subject_index === '' || requestPayload.subject_index === undefined ? null : requestPayload.subject_index,
        p_term: requestPayload.term || null,
        p_academic_session: requestPayload.academic_session || null,
        p_assessment_config: requestPayload.assessment_config || { ca1: 10, ca2: 10, ca3: 10, exam: 70 },
      })
    : action === 'smart.sheet.read'
      ? await supabaseRpc('school_result_smart_sheet_read', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
          p_sheet_id: requestPayload.sheet_id || null,
          p_class_key: requestPayload.class_key || null,
          p_subject_index: requestPayload.subject_index === '' || requestPayload.subject_index === undefined ? null : requestPayload.subject_index,
          p_term: requestPayload.term || null,
          p_academic_session: requestPayload.academic_session || null,
        })
    : action === 'smart.history.read'
      ? await supabaseRpc('school_result_smart_history_read', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
          p_limit: Number.isInteger(requestPayload.limit) ? requestPayload.limit : 30,
        })
    : action === 'smart.scores.commit'
      ? await supabaseRpc('school_result_smart_recording_commit', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
          p_sheet_id: requestPayload.sheet_id || null,
          p_rows: Array.isArray(requestPayload.rows) ? requestPayload.rows : [],
          p_summary: requestPayload.summary && typeof requestPayload.summary === 'object' ? requestPayload.summary : {},
          p_image_fingerprint: requestPayload.image_fingerprint || null,
        })
    : action.startsWith('read.')
    ? await supabaseRpc('school_result_read_api', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_resource: action.slice('read.'.length),
        p_payload: requestPayload,
      })
    : action === 'scores.enter'
      ? await supabaseRpc('school_result_score_update', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_student_id: requestPayload.student_id || null,
        p_class_key: requestPayload.class_key || null,
        p_subject_index: requestPayload.subject_index === '' || requestPayload.subject_index === undefined ? null : requestPayload.subject_index,
        p_term: requestPayload.term || null,
        p_academic_session: requestPayload.academic_session || null,
        p_ca1: requestPayload.ca1 === '' || requestPayload.ca1 === undefined ? null : requestPayload.ca1,
        p_ca2: requestPayload.ca2 === '' || requestPayload.ca2 === undefined ? null : requestPayload.ca2,
        p_ca3: requestPayload.ca3 === '' || requestPayload.ca3 === undefined ? null : requestPayload.ca3,
        p_exam: requestPayload.exam === '' || requestPayload.exam === undefined ? null : requestPayload.exam,
      })
    : action === 'traits.enter'
      ? await supabaseRpc('school_result_traits_update', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_student_id: requestPayload.student_id || null,
        p_class_key: requestPayload.class_key || null,
        p_term: requestPayload.term || null,
        p_academic_session: requestPayload.academic_session || null,
        p_trait_type: requestPayload.trait_type || null,
        p_trait_name: requestPayload.trait_name || null,
        p_rating: requestPayload.rating === '' || requestPayload.rating === undefined ? null : requestPayload.rating,
      })
      : action === 'remarks.enter'
        ? await supabaseRpc('school_result_remarks_update', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
          p_student_id: requestPayload.student_id || null,
          p_class_key: requestPayload.class_key || null,
          p_term: requestPayload.term || null,
          p_academic_session: requestPayload.academic_session || null,
          p_academic: requestPayload.academic ?? null,
          p_form_master: requestPayload.form_master ?? null,
          p_principal: requestPayload.principal ?? null,
          p_days_opened: requestPayload.days_opened === '' || requestPayload.days_opened === undefined ? null : requestPayload.days_opened,
          p_days_present: requestPayload.days_present === '' || requestPayload.days_present === undefined ? null : requestPayload.days_present,
        })
        : action === 'fees.update'
    ? await supabaseRpc('school_result_fees_update', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_student_id: requestPayload.student_id || null,
        p_class_key: requestPayload.class_key || null,
        p_term: requestPayload.term || null,
        p_academic_session: requestPayload.academic_session || null,
        p_total: requestPayload.total === '' || requestPayload.total === undefined ? null : requestPayload.total,
        p_paid: requestPayload.paid === '' || requestPayload.paid === undefined ? null : requestPayload.paid,
        p_debt: requestPayload.debt === '' || requestPayload.debt === undefined ? null : requestPayload.debt,
      })
    : action === 'context.set'
      ? await supabaseRpc('school_result_context_set', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_class_key: requestPayload.class_key || null,
        p_academic_session: requestPayload.academic_session || null,
        p_term: requestPayload.term || null,
      })
    : action === 'context.read'
      ? await supabaseRpc('school_result_context_read', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
      })
    : action === 'settings.app_config.update'
      ? await supabaseRpc('school_result_app_config_update', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_config: requestPayload.config && typeof requestPayload.config === 'object' ? requestPayload.config : {},
      })
    : action === 'settings.provider_key.update'
      ? await (async () => {
        const authorized = await supabaseRpc('school_result_provider_key_authorize', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
        });
        if (!authorized?.ok) return authorized;
        const providerKey = typeof requestPayload.provider_key === 'string' ? requestPayload.provider_key.trim() : '';
        const verified = await smartRecording.verifyGeminiApiKey(providerKey);
        if (!verified?.ok) return verified;
        return supabaseRpc('school_result_provider_key_update', {
          p_session_id: session.sessionId,
          p_session_secret: session.sessionSecret,
          p_provider_key: providerKey,
        });
      })()
    : action === 'settings.provider_key.status'
      ? await supabaseRpc('school_result_provider_key_status', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
      })
    : action === 'settings.read'
    ? await supabaseRpc('school_result_settings_read', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
      })
    : action === 'history.context.set'
      ? await supabaseRpc('school_result_history_context_set', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_class_key: requestPayload.class_key || null,
        p_academic_session: requestPayload.academic_session || null,
        p_term: requestPayload.term || null,
      })
    : action.startsWith('history.')
      ? await supabaseRpc('school_result_history_read', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_action: action.slice('history.'.length),
        p_payload: requestPayload,
      })
    : await supabaseRpc('school_result_api', {
        p_session_id: session.sessionId,
        p_session_secret: session.sessionSecret,
        p_action: action,
        p_payload: requestPayload,
      });
  if (payload?.ok && action === 'read.students' && Array.isArray(payload.rows) && payload.rows.length) {
    const portfolioPayload = await supabaseRpc('school_profile_portfolios_read', {
      p_session_id: session.sessionId,
      p_session_secret: session.sessionSecret,
      p_target_type: 'student',
      p_class_key: requestPayload.class_key || null,
      p_student_id: requestPayload.student_id || null,
      p_academic_session: requestPayload.academic_session || null,
      p_term: requestPayload.term || null,
    });
    if (portfolioPayload?.ok && Array.isArray(portfolioPayload.rows)) {
      const byStudent = new Map(portfolioPayload.rows.map((entry) => [String(entry.student_id), Array.isArray(entry.portfolios) ? entry.portfolios : []]));
      payload = { ...payload, rows: payload.rows.map((student) => ({ ...student, portfolios: byStudent.get(String(student.id)) || [] })) };
    }
  }
  if (!payload?.ok) {
    sendJson(res, authStatus(payload?.code), payload || { ok: false, code: 'RESULT_REQUEST_FAILED' });
    return;
  }
  sendJson(res, 200, payload);
};
