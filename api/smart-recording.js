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

async function extractWithGemini(sheet, pageIndex, image) {
  const apiKey = process.env.WTS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, code: 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' };
  const model = process.env.WTS_SMART_RECORDING_MODEL || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: buildExtractionPrompt(sheet, pageIndex) },
        { inline_data: { mime_type: image.mimeType, data: image.base64 } },
      ] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) return { ok: false, code: 'SMART_EXTRACTION_PROVIDER_FAILED', provider_status: response.status };
  const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  try { return { ok: true, payload: JSON.parse(raw) }; } catch {
    return { ok: false, code: 'SMART_EXTRACTION_INVALID_RESPONSE' };
  }
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
  if (!body || body.action !== 'extract' || !body.sheet_id) {
    sendJson(res, 400, { ok: false, code: 'SMART_EXTRACTION_PAYLOAD_INVALID' }); return;
  }
  const image = imageParts(body.image_data_url);
  if (!image) {
    sendJson(res, 400, { ok: false, code: 'SMART_IMAGE_INVALID' }); return;
  }
  const sheetPayload = await readSheet(session, body.sheet_id);
  if (!sheetPayload?.ok) {
    sendJson(res, authStatus(sheetPayload?.code), sheetPayload || { ok: false, code: 'SMART_SHEET_NOT_FOUND' }); return;
  }
  const sheet = sheetPayload.sheet;
  const pageIndex = Math.max(0, Number(body.page_index) || 0);
  const extracted = await extractWithGemini(sheet, pageIndex, image);
  if (!extracted.ok) {
    sendJson(res, extracted.code === 'SMART_RECORDING_PROVIDER_NOT_CONFIGURED' ? 503 : 422, extracted); return;
  }
  const normalized = normalizeExtraction(sheet, extracted.payload, pageIndex);
  sendJson(res, 200, {
    ok: true,
    code: 'SMART_SCORES_EXTRACTED',
    sheet,
    existing_scores: sheetPayload.existing_scores || [],
    extraction: normalized,
    image_fingerprint: crypto.createHash('sha256').update(image.bytes).digest('hex'),
  });
};
