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
  if (!payload?.ok) throw payload || { ok: false, code: 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' };
  return typeof payload.provider_key === 'string' ? payload.provider_key.trim() : '';
}

async function resolveProviderKey(session, scope) {
  let storedError = null;
  try {
    const stored = await readStoredProviderKey(session, scope);
    if (stored) return { ok: true, key: stored };
  } catch (error) {
    storedError = error;
  }
  if (storedError?.code && storedError.code !== 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED') {
    return { ok: false, code: storedError.code };
  }
  if (storedError && !storedError.code) {
    return { ok: false, code: 'SMART_EXTRACTION_PROVIDER_UNAVAILABLE' };
  }
  const fallback = String(process.env.WTS_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (fallback) return { ok: true, key: fallback };
  return { ok: false, code: 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' };
}

function parseGeminiJson(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(text); } catch {}
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0).sort((a, b) => a - b);
  const start = starts[0];
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

function geminiModelsFromPayload(payload) {
  return (Array.isArray(payload?.models) ? payload.models : [])
    .filter((model) => Array.isArray(model?.supportedGenerationMethods)
      && model.supportedGenerationMethods.includes('generateContent'))
    .map((model) => String(model.name || '').replace(/^models\//, '').trim())
    .filter(Boolean);
}

async function verifyGeminiApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (key.length < 20 || key.length > 512 || /[\s\u0000-\u001f]/.test(key)) {
    return { ok: false, code: 'SMART_EXTRACTION_PROVIDER_KEY_INVALID' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {
      method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const message = String(payload?.error?.message || '').slice(0, 240);
      const invalid = response.status === 401 || response.status === 403
        || /api[ _-]?key|key not valid|invalid key|permission denied/i.test(message);
      return { ok: false, code: invalid ? 'SMART_EXTRACTION_PROVIDER_KEY_INVALID' : 'SMART_EXTRACTION_PROVIDER_FAILED', provider_status: response.status, provider_message: message };
    }
    const models = geminiModelsFromPayload(payload);
    if (!models.length) return { ok: false, code: 'SMART_EXTRACTION_PROVIDER_FAILED', provider_message: 'No Gemini model with generateContent is available for this key.' };
    return { ok: true, models };
  } catch (error) {
    return { ok: false, code: error?.name === 'AbortError' ? 'SMART_EXTRACTION_PROVIDER_TIMEOUT' : 'SMART_EXTRACTION_PROVIDER_UNAVAILABLE' };
  } finally {
    clearTimeout(timeout);
  }
}

async function geminiGenerate(apiKey, model, prompt, image, jsonMode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const generationConfig = { temperature: 0 };
    if (jsonMode) generationConfig.responseMimeType = 'application/json';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: prompt },
          { inline_data: { mime_type: image.mimeType, data: image.base64 } },
        ] }],
        generationConfig,
      }),
      signal: controller.signal,
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    return { response, payload };
  } catch (error) {
    return { error };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(apiKey, prompt, image) {
  if (!apiKey) return { ok: false, code: 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' };
  const configuredModel = String(process.env.WTS_SMART_RECORDING_MODEL || '').trim();
  const preferredModels = [...new Set([
    configuredModel,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ].filter(Boolean))];
  const tried = new Set();
  let lastFailure = null;

  const tryModel = async (model) => {
    if (tried.has(model)) return null;
    tried.add(model);
    for (const jsonMode of [true, false]) {
      const result = await geminiGenerate(apiKey, model, prompt, image, jsonMode);
      if (result.error) return { ok: false, code: result.error?.name === 'AbortError' ? 'SMART_EXTRACTION_PROVIDER_TIMEOUT' : 'SMART_EXTRACTION_PROVIDER_UNAVAILABLE' };
      const { response, payload } = result;
      if (!response.ok) {
        const providerMessage = String(payload?.error?.message || '').slice(0, 240);
        const keyRejected = response.status === 400 && /api[ _-]?key|key not valid|invalid key|permission denied/i.test(providerMessage);
        lastFailure = { ok: false, code: keyRejected ? 'SMART_EXTRACTION_PROVIDER_KEY_INVALID' : 'SMART_EXTRACTION_PROVIDER_FAILED', provider_status: response.status, provider_message: providerMessage };
        if (keyRejected || response.status === 401 || response.status === 403) return lastFailure;
        if ((response.status === 400 || response.status === 404) && jsonMode) continue;
        if (response.status !== 400 && response.status !== 404) return lastFailure;
        break;
      }
      const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
      const parsed = parseGeminiJson(raw);
      if (parsed !== null) return { ok: true, payload: parsed };
      if (!jsonMode) return { ok: false, code: 'SMART_EXTRACTION_INVALID_RESPONSE' };
    }
    return null;
  };

  for (const model of preferredModels) {
    const result = await tryModel(model);
    if (result) {
      if (result.ok || result.code !== 'SMART_EXTRACTION_PROVIDER_FAILED') return result;
    }
  }

  // Gemini model names change over time. If the stable aliases above are not
  // available, discover the models enabled for this key and retry with the
  // provider's current generateContent model names.
  if (lastFailure?.provider_status === 400 || lastFailure?.provider_status === 404) {
    const discovered = await verifyGeminiApiKey(apiKey);
    if (discovered.ok) {
      for (const model of discovered.models) {
        const result = await tryModel(model);
        if (result) {
          if (result.ok || result.code !== 'SMART_EXTRACTION_PROVIDER_FAILED') return result;
        }
      }
    }
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

function rowsPerPageForClass(classKey, geometry) {
  const configured = Number(geometry?.rows_per_page);
  if (configured >= 1 && configured <= 100) return Math.round(configured);
  const key = String(classKey || '');
  if (isLandscapeClass(key)) return 50;
  if (/^(jss|ss)\d/.test(key)) return 58;
  return 58;
}

function geometryIsLandscape(geometry, classKey) {
  if (geometry && typeof geometry.layout === 'string') return geometry.layout === 'landscape';
  const width = Number(geometry?.canonical_width);
  const height = Number(geometry?.canonical_height);
  if (width > 0 && height > 0) return width > height;
  return isLandscapeClass(classKey);
}

function templateGeometry(subjectSheets, baseGeometry, landscape) {
  const count = Math.max(1, subjectSheets.length);
  const stored = baseGeometry && typeof baseGeometry === 'object' ? baseGeometry : {};
  const storedWidth = Number(stored.canonical_width);
  const storedHeight = Number(stored.canonical_height);
  const effectiveLandscape = stored.layout
    ? stored.layout === 'landscape'
    : (storedWidth > 0 && storedHeight > 0 ? storedWidth > storedHeight : landscape);
  const width = storedWidth > 0 ? storedWidth : (effectiveLandscape ? 1754 : 1240);
  const height = storedHeight > 0 ? storedHeight : (effectiveLandscape ? 1240 : 1754);
  const table = stored.table && typeof stored.table === 'object' ? stored.table : {};
  const tableX = Number.isFinite(Number(table.x)) ? Number(table.x) : (effectiveLandscape ? 34 : 54);
  const tableY = Number.isFinite(Number(table.y)) ? Number(table.y) : (effectiveLandscape ? 130 : 292);
  const tableWidth = Number.isFinite(Number(table.width)) ? Number(table.width) : (effectiveLandscape ? 1686 : 1132);
  const numberWidth = 45;
  const storedStudentColumn = stored.student_column && typeof stored.student_column === 'object' ? stored.student_column : {};
  const storedFirstColumn = stored.columns && stored.columns.ca1 && typeof stored.columns.ca1 === 'object'
    ? stored.columns.ca1 : {};
  const derivedStudentWidth = Number(storedFirstColumn.x) - tableX - numberWidth;
  const studentWidth = Number.isFinite(Number(storedStudentColumn.width)) && Number(storedStudentColumn.width) > 0
    ? Number(storedStudentColumn.width)
    : (derivedStudentWidth > 0 ? derivedStudentWidth : (effectiveLandscape ? 335 : 611));
  const scoreWidth = Math.max(1, tableWidth - numberWidth - studentWidth);
  const configuredRows = Number(stored.rows_per_page);
  const rowsPerPage = configuredRows >= 1 && configuredRows <= 100
    ? Math.round(configuredRows)
    : (effectiveLandscape ? 50 : 58);
  const rowHeight = Number.isFinite(Number(table.row_height)) && Number(table.row_height) > 0
    ? Number(table.row_height) : (effectiveLandscape ? 20 : 24);
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
    ...stored,
    canonical_width: width,
    canonical_height: height,
    layout: effectiveLandscape ? 'landscape' : 'portrait',
    subject_count: count,
    rows_per_page: rowsPerPage,
    table: { ...table, x: tableX, y: tableY, width: tableWidth, row_height: rowHeight },
    student_column: { x: tableX + numberWidth, width: studentWidth },
    columns,
  };
}

function normalizeRoster(roster, rowsPerPage) {
  return (roster || [])
    .map((student) => ({ ...student }))
    .sort((a, b) => Number(a.row_index || 0) - Number(b.row_index || 0)
      || String(a.name || '').localeCompare(String(b.name || '')))
    .map((student, index) => ({
      ...student,
      row_index: index + 1,
      page_index: Math.floor(index / rowsPerPage),
      page_row: (index % rowsPerPage) + 1,
    }));
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
    geometryIsLandscape(first.geometry, first.class_key),
  );
  const rowsPerPage = rowsPerPageForClass(first.class_key, first.geometry);
  if (classKeys.length <= 1) {
    first.roster = normalizeRoster(first.roster, rowsPerPage);
    return first;
  }

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
    page_index: Math.floor(index / rowsPerPage),
    page_row: (index % rowsPerPage) + 1,
  }));
  first.grouped_across_classes = true;
  first.class_keys = classKeys;
  return first;
}

async function extractSmart(session, sheet, pageIndex, image) {
  const resolved = await resolveProviderKey(session, {
    class_key: sheet.class_key,
    subject_index: Number(sheet.subject_index),
    academic_session: sheet.academic_session,
    term: sheet.term,
  });
  if (!resolved.ok) return resolved;
  return callGemini(resolved.key, buildExtractionPrompt(sheet, pageIndex), image);
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
  const resolved = await resolveProviderKey(session, {
    class_key: body.class_key,
    subject_index: Number.isInteger(Number(body.subject_index)) ? Number(body.subject_index) : null,
    academic_session: body.academic_session,
    term: body.term,
  });
  if (!resolved.ok) return resolved;
  const result = await callGemini(resolved.key, genericPrompt(body), image);
  if (!result.ok) return result;
  const rows = Array.isArray(result.payload) ? result.payload : result.payload?.rows;
  return Array.isArray(rows) ? { ok: true, rows } : { ok: false, code: 'SMART_EXTRACTION_INVALID_RESPONSE' };
}

async function extractGeneric(session, body, image) {
  const subjectIndex = Number.isInteger(Number(body.subject_index)) ? Number(body.subject_index) : null;
  const resolved = await resolveProviderKey(session, {
    class_key: body.class_key,
    subject_index: subjectIndex,
    academic_session: body.academic_session,
    term: body.term,
  });
  if (!resolved.ok) return resolved;
  const result = await callGemini(resolved.key, smartGenericPrompt(body), image);
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

module.exports.verifyGeminiApiKey = verifyGeminiApiKey;
module.exports.discoverGeminiModels = async function discoverGeminiModels(apiKey) {
  const result = await verifyGeminiApiKey(apiKey);
  return result.ok ? result.models : result;
};
