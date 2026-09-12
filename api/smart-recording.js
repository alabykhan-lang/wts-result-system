'use strict';

const crypto = require('node:crypto');
const {
  authStatus,
  readJsonBody,
  requestOriginAllowed,
  sendJson,
  sessionFromRequest,
  supabaseRpc,
} = require('./_lib');
const { buildExtractionPrompt, normalizeExtraction } = require('./_smart-recording');

const MAX_IMAGE_BYTES = 4_000_000;
const PROVIDER_TIMEOUT_MS = 35_000;
const PROVIDER_LIST_TIMEOUT_MS = 12_000;
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];
const PROVIDER_MODEL_CACHE = new Map();

function imageParts(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  return { mimeType: match[1], base64: match[2], bytes };
}

async function readStoredProviderKey(session, scope) {
  const payload = await supabaseRpc('school_result_smart_provider_key_read', {
    p_session_id: session.sessionId,
    p_session_secret: session.sessionSecret,
    p_class_key: scope?.class_key || null,
    p_subject_index: Number.isInteger(scope?.subject_index) ? scope.subject_index : null,
    p_academic_session: scope?.academic_session || null,
    p_term: scope?.term || null,
  });
  if (!payload?.ok) {
    if (payload?.code === 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED') return '';
    throw payload || { ok: false, code: 'SMART_PROVIDER_KEY_READ_FAILED' };
  }
  return payload?.provider_key && typeof payload.provider_key === 'string'
    ? payload.provider_key.trim()
    : '';
}

async function resolveProviderKey(session, scope) {
  const stored = await readStoredProviderKey(session, scope);
  if (stored) return { ok: true, key: stored };
  const fallback = String(process.env.WTS_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (fallback) return { ok: true, key: fallback };
  return { ok: false, code: 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' };
}

function parseGeminiJson(raw) {
  const cleaned = String(raw || '').trim().replace(/^\uFEFF/, '');
  const unfenced = cleaned.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/i, '').trim();
  try { return JSON.parse(unfenced); } catch {}
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(unfenced.slice(first, last + 1)); } catch {}
  }
  const arrayFirst = unfenced.indexOf('[');
  const arrayLast = unfenced.lastIndexOf(']');
  if (arrayFirst >= 0 && arrayLast > arrayFirst) {
    try { return JSON.parse(unfenced.slice(arrayFirst, arrayLast + 1)); } catch {}
  }
  return null;
}

function providerFailureFromResponse(response, payload) {
  const providerMessage = String(payload?.error?.message || '').slice(0, 240);
  const keyRejected = /api[ _-]?key|key not valid|invalid key|permission denied|authentication/i.test(providerMessage);
  return {
    ok: false,
    code: keyRejected || response.status === 401 || response.status === 403
      ? 'SMART_EXTRACTION_PROVIDER_KEY_INVALID'
      : 'SMART_EXTRACTION_PROVIDER_FAILED',
    provider_status: response.status,
    provider_message: providerMessage,
  };
}

function modelName(value) {
  return String(value || '').replace(/^models\//, '').trim();
}

function usableGeminiModel(model) {
  const name = modelName(model?.name || model);
  const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
  if (!name || (methods.length && !methods.includes('generateContent'))) return false;
  return !/(embedding|embed|aqa|imagen|veo|audio|tts|robotics)/i.test(name);
}

function orderGeminiModels(models) {
  const configuredModel = modelName(process.env.WTS_SMART_RECORDING_MODEL);
  const names = [...new Set((models || []).map(modelName).filter(Boolean))];
  const preferred = [configuredModel, ...FALLBACK_MODELS];
  return [
    ...preferred.filter((name) => names.includes(name)),
    ...names
      .filter((name) => !preferred.includes(name))
      .sort((a, b) => {
        const aScore = /flash/i.test(a) ? 0 : /pro/i.test(a) ? 1 : 2;
        const bScore = /flash/i.test(b) ? 0 : /pro/i.test(b) ? 1 : 2;
        return aScore - bScore || a.localeCompare(b);
      }),
  ];
}

async function discoverGeminiModels(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, code: 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' };
  const cached = PROVIDER_MODEL_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  let response;
  let timeoutId;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), PROVIDER_LIST_TIMEOUT_MS);
    response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } catch (error) {
    return {
      ok: false,
      code: error?.name === 'AbortError' ? 'SMART_EXTRACTION_PROVIDER_TIMEOUT' : 'SMART_EXTRACTION_PROVIDER_UNAVAILABLE',
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) return providerFailureFromResponse(response, payload);

  const models = orderGeminiModels((Array.isArray(payload.models) ? payload.models : []).filter(usableGeminiModel));
  const result = { ok: true, models };
  PROVIDER_MODEL_CACHE.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, value: result });
  return result;
}

async function verifyGeminiApiKey(apiKey) {
  const discovered = await discoverGeminiModels(apiKey);
  if (!discovered.ok) {
    return discovered.code === 'SMART_EXTRACTION_PROVIDER_KEY_INVALID'
      ? { ok: false, code: 'RESULT_PROVIDER_KEY_INVALID', provider_status: discovered.provider_status }
      : { ok: false, code: 'RESULT_PROVIDER_KEY_VERIFICATION_FAILED', provider_code: discovered.code };
  }
  if (!discovered.models.length) {
    return { ok: false, code: 'RESULT_PROVIDER_KEY_NO_MODEL' };
  }
  return { ok: true, models: discovered.models };
}

async function requestGeminiModel(apiKey, model, prompt, image, jsonMode) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig = { temperature: 0 };
  if (jsonMode) generationConfig.responseMimeType = 'application/json';
  let response;
  let timeoutId;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: prompt },
          { inline_data: { mime_type: image.mimeType, data: image.base64 } },
        ] }],
        generationConfig,
      }),
    });
  } catch (error) {
    return { ok: false, code: error?.name === 'AbortError' ? 'SMART_EXTRACTION_PROVIDER_TIMEOUT' : 'SMART_EXTRACTION_PROVIDER_UNAVAILABLE' };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

async function callGemini(apiKey, prompt, image) {
  if (!apiKey) return { ok: false, code: 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' };
  const discovered = await discoverGeminiModels(apiKey);
  if (discovered.code === 'SMART_EXTRACTION_PROVIDER_KEY_INVALID') return discovered;
  const models = discovered.ok && discovered.models.length ? discovered.models : orderGeminiModels(FALLBACK_MODELS);
  let lastFailure = null;

  for (const model of models) {
    let result = await requestGeminiModel(apiKey, model, prompt, image, true);
    if (!result.response) return result;
    let { response, payload } = result;
    if (!response.ok) {
      // Some Gemini models reject responseMimeType even though they support
      // vision generation. Retry that exact model once in plain-text mode.
      if (response.status === 400) {
        result = await requestGeminiModel(apiKey, model, prompt, image, false);
        if (!result.response) return result;
        ({ response, payload } = result);
      }
      if (!response.ok) {
        lastFailure = providerFailureFromResponse(response, payload);
        if (lastFailure.code === 'SMART_EXTRACTION_PROVIDER_KEY_INVALID') return lastFailure;
        if (response.status !== 400 && response.status !== 404) return lastFailure;
        continue;
      }
    }

    const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    const parsed = parseGeminiJson(raw);
    if (parsed !== null) return { ok: true, payload: parsed };
    return { ok: false, code: 'SMART_EXTRACTION_INVALID_RESPONSE' };
  }

  return lastFailure || { ok: false, code: 'SMART_EXTRACTION_PROVIDER_FAILED' };
}

async function readSheet(session, sheetId) {
  return supabaseRpc('school_result_smart_sheet_read', {
    p_session_id: session.sessionId,
    p_session_secret: session.sessionSecret,
    p_sheet_id: sheetId,
    p_class_key: null,
    p_subject_index: null,
    p_term: null,
    p_academic_session: null,
  });
}

function isLandscapeClass(classKey) {
  return /^(creche|kg1|kg2|nursery1|nursery2|primary[1-5])$/.test(String(classKey || ''));
}

function rowsPerPageForClass(classKey) {
  return isLandscapeClass(classKey) ? 50 : 58;
}

function templateGeometry(subjectSheets, baseGeometry, landscape) {
  const count = Math.max(1, subjectSheets.length);
  const width = landscape ? 1754 : 1240;
  const height = landscape ? 1240 : 1754;
  const tableX = landscape ? 34 : 54;
  const tableY = landscape ? 130 : 292;
  const tableWidth = landscape ? 1686 : 1132;
  const numberWidth = landscape ? 45 : 45;
  const studentWidth = landscape ? 335 : 611;
  const scoreWidth = Math.max(1, tableWidth - numberWidth - studentWidth);
  const rowHeight = landscape ? 22 : 33;
  const columns = {};
  subjectSheets.forEach((subject, subjectPosition) => {
    const subjectKey = String(subject.group_index === undefined ? subjectPosition : subject.group_index);
    const componentWidth = scoreWidth / (count * 4);
    ['ca1', 'ca2', 'ca3', 'exam'].forEach((component, componentPosition) => {
      columns[subjectKey + '_' + component] = {
        x: Math.round(tableX + numberWidth + studentWidth + (subjectPosition * 4 + componentPosition) * componentWidth),
        width: Math.round(componentWidth),
      };
    });
  });
  return {
    ...(baseGeometry && typeof baseGeometry === 'object' ? baseGeometry : {}),
    canonical_width: width,
    canonical_height: height,
    layout: landscape ? 'landscape' : 'portrait',
    subject_count: count,
    rows_per_page: rowsPerPageForClass(subjectSheets[0]?.class_key),
    table: { x: tableX, y: tableY, width: tableWidth, row_height: rowHeight },
    student_column: { x: tableX + numberWidth, width: studentWidth },
    columns,
  };
}

function groupedSheet(sheetPayloads) {
  const sheets = sheetPayloads.map((payload, index) => ({
    ...payload.sheet,
    group_index: index,
  }));
  const first = { ...sheets[0], group_sheets: sheets };
  const classKeys = [...new Set(sheets.map((sheet) => String(sheet.class_key || '')))].filter(Boolean);
  first.geometry = templateGeometry(
    classKeys.length > 1 ? [sheets[0]] : sheets,
    first.geometry,
    isLandscapeClass(first.class_key) || (classKeys.length <= 1 && sheets.length > 1),
  );
  if (classKeys.length <= 1) return first;

  const seen = new Set();
  const combined = [];
  sheets.forEach((sheet) => {
    (sheet.roster || []).forEach((student) => {
      const id = String(student.student_id || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      combined.push({
        ...student,
        source_sheet_id: sheet.id,
        source_class_key: sheet.class_key,
        source_row_index: student.row_index,
      });
    });
  });
  combined.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.student_id).localeCompare(String(b.student_id)));
  first.roster = combined.map((student, index) => ({
    ...student,
    row_index: index + 1,
    page_index: Math.floor(index / first.geometry.rows_per_page),
    page_row: (index % first.geometry.rows_per_page) + 1,
  }));
  first.grouped_across_classes = true;
  first.class_keys = classKeys;
  return first;
}

async function extractSmart(session, sheet, pageIndex, image) {
  const provider = await resolveProviderKey(session, {
    class_key: sheet.class_key,
    subject_index: Number(sheet.subject_index),
    academic_session: sheet.academic_session,
    term: sheet.term,
  });
  if (!provider.ok) return provider;
  return callGemini(provider.key, buildExtractionPrompt(sheet, pageIndex), image);
}

function genericPrompt(body) {
  const students = Array.isArray(body.roster) ? body.roster.slice(0, 300).map((student) => ({
    name: String(student?.name || '').slice(0, 120),
    admission_number: String(student?.admno || student?.admission_number || '').slice(0, 80),
  })) : [];
  return [
    'Read a handwritten Nigerian school score record page.',
    'Read each visible row and return the student name, CA1 out of 10, CA2 out of 10, CA3 out of 10, and Exam out of 70.',
    'Use null for an empty or unreadable score. Do not invent values.',
    'Return a JSON array only with objects shaped as {"name":"...","ca1":number_or_null,"ca2":number_or_null,"ca3":number_or_null,"exam":number_or_null}.',
    `Registered students for secondary name matching: ${JSON.stringify(students)}`,
  ].join('\n');
}

function smartGenericPrompt(body) {
  const students = Array.isArray(body.roster) ? body.roster.slice(0, 300).map((student, index) => ({
    row_index: Number(student?.row_index) || index + 1,
    name: String(student?.name || '').slice(0, 120),
    admission_number: String(student?.admno || student?.admission_number || '').slice(0, 80),
  })) : [];
  const subjects = Array.isArray(body.subject_specs) && body.subject_specs.length
    ? body.subject_specs.slice(0, 4).map((subject, index) => ({
        subject_index: Number.isInteger(Number(subject?.subject_index)) ? Number(subject.subject_index) : index,
        subject_name: String(subject?.subject_name || '').slice(0, 120),
        maximums: subject?.assessment_config && typeof subject.assessment_config === 'object'
          ? subject.assessment_config : { ca1: 10, ca2: 10, ca3: 10, exam: 70 },
      }))
    : [{ subject_index: Number(body.subject_index) || 0, subject_name: 'Selected subject', maximums: { ca1: 10, ca2: 10, ca3: 10, exam: 70 } }];
  return [
    'Read handwritten numeric scores from this uploaded school score sheet.',
    'This is a generic scan. A generated Smart Score Sheet and QR code are not required.',
    'Use the printed row number and the supplied roster order for student identity. Do not require a QR code and do not invent a student.',
    'Return every visible row. For a genuinely empty score cell use state "blank" and value null. For present but unclear handwriting use state "uncertain", your best value or null, and confidence below 0.82. For a readable score use state "read" and confidence from 0 to 1.',
    'Preserve multi-digit scores and never infer a value from a neighbouring cell.',
    `Subjects and assessment maximums: ${JSON.stringify(subjects)}`,
    `Expected roster in printed row order: ${JSON.stringify(students)}`,
    'Respond as JSON only in this shape: {"rows":[{"row_index":1,"subjects":{"0":{"ca1":{"value":8,"confidence":0.98,"state":"read"},"ca2":{"value":null,"confidence":1,"state":"blank"},"ca3":{"value":null,"confidence":0,"state":"uncertain"},"exam":{"value":52,"confidence":0.94,"state":"read"}}}}]}. For one selected subject, the subjects object must still use its supplied subject_index as the key.',
  ].join('\n');
}

async function extractRecordBook(session, body, image) {
  const provider = await resolveProviderKey(session, {
    class_key: body.class_key,
    subject_index: Number.isInteger(Number(body.subject_index)) ? Number(body.subject_index) : null,
    academic_session: body.academic_session,
    term: body.term,
  });
  if (!provider.ok) return provider;
  const result = await callGemini(provider.key, genericPrompt(body), image);
  if (!result.ok) return result;
  const rows = Array.isArray(result.payload) ? result.payload : result.payload?.rows;
  return Array.isArray(rows) ? { ok: true, rows } : { ok: false, code: 'SMART_EXTRACTION_INVALID_RESPONSE' };
}

async function extractGeneric(session, body, image) {
  const subjectIndex = Number.isInteger(Number(body.subject_index)) ? Number(body.subject_index) : null;
  const provider = await resolveProviderKey(session, {
    class_key: body.class_key,
    subject_index: subjectIndex,
    academic_session: body.academic_session,
    term: body.term,
  });
  if (!provider.ok) return provider;
  const result = await callGemini(provider.key, smartGenericPrompt(body), image);
  if (!result.ok) return result;
  const rows = Array.isArray(result.payload) ? result.payload : result.payload?.rows;
  return Array.isArray(rows) ? { ok: true, rows } : { ok: false, code: 'SMART_EXTRACTION_INVALID_RESPONSE' };
}

function extractionStatus(code) {
  return ['SMART_RECORDING_PROVIDER_NOT_CONFIGURED', 'SMART_EXTRACTION_PROVIDER_FAILED', 'SMART_EXTRACTION_PROVIDER_KEY_INVALID', 'SMART_EXTRACTION_PROVIDER_UNAVAILABLE', 'SMART_EXTRACTION_PROVIDER_TIMEOUT'].includes(code) ? 503 : 422;
}

module.exports = async function smartRecording(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }); return;
  }
  if (!requestOriginAllowed(req)) {
    sendJson(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED' }); return;
  }
  const session = sessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, code: 'RESULT_SESSION_REQUIRED' }); return;
  }
  const body = await readJsonBody(req);
  if (!body || typeof body.action !== 'string') {
    sendJson(res, 400, { ok: false, code: 'SMART_EXTRACTION_PAYLOAD_INVALID' }); return;
  }
  const image = imageParts(body.image_data_url);
  if (!image) {
    sendJson(res, 400, { ok: false, code: 'SMART_IMAGE_INVALID' }); return;
  }

  if (body.action === 'record_book_extract') {
    const extracted = await extractRecordBook(session, body, image);
    if (!extracted.ok) { sendJson(res, extractionStatus(extracted.code), extracted); return; }
    sendJson(res, 200, { ok: true, code: 'SMART_RECORD_BOOK_EXTRACTED', rows: extracted.rows });
    return;
  }

  if (body.action === 'generic_extract') {
    const extracted = await extractGeneric(session, body, image);
    if (!extracted.ok) { sendJson(res, extractionStatus(extracted.code), extracted); return; }
    sendJson(res, 200, {
      ok: true,
      code: 'SMART_GENERIC_SCORES_EXTRACTED',
      rows: extracted.rows,
      image_fingerprint: crypto.createHash('sha256').update(image.bytes).digest('hex'),
    });
    return;
  }

  const sheetIds = Array.isArray(body.sheet_ids)
    ? body.sheet_ids.filter(Boolean).slice(0, 4)
    : (body.sheet_id ? [body.sheet_id] : []);
  if (body.action !== 'extract' || !sheetIds.length) {
    sendJson(res, 400, { ok: false, code: 'SMART_EXTRACTION_PAYLOAD_INVALID' }); return;
  }

  const sheetPayloads = [];
  for (const sheetId of sheetIds) {
    const payload = await readSheet(session, sheetId);
    if (!payload?.ok) {
      sendJson(res, authStatus(payload?.code), payload || { ok: false, code: 'SMART_SHEET_NOT_FOUND' }); return;
    }
    sheetPayloads.push(payload);
  }
  const sheet = groupedSheet(sheetPayloads);
  const pageIndex = Math.max(0, Number(body.page_index) || 0);
  const extracted = await extractSmart(session, sheet, pageIndex, image);
  if (!extracted.ok) { sendJson(res, extractionStatus(extracted.code), extracted); return; }
  const normalized = normalizeExtraction(sheet, extracted.payload, pageIndex);
  sendJson(res, 200, {
    ok: true,
    code: 'SMART_SCORES_EXTRACTED',
    sheet,
    existing_scores: sheetPayloads.flatMap((payload) => (payload.existing_scores || []).map((row) => ({
      ...row,
      sheet_id: payload.sheet.id,
      class_key: payload.sheet.class_key,
      subject_index: payload.sheet.subject_index,
    }))),
    extraction: normalized,
    image_fingerprint: crypto.createHash('sha256').update(image.bytes).digest('hex'),
  });
};

module.exports.discoverGeminiModels = discoverGeminiModels;
module.exports.verifyGeminiApiKey = verifyGeminiApiKey;
