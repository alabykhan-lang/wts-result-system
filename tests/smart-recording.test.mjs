import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExtractionPrompt, normalizeExtraction, parseSheetCode } = require('../api/_smart-recording.js');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/smart-recording-cases.json', import.meta.url), 'utf8'));
const { sheet, cases } = fixture;

const identity = parseSheetCode(`https://example.test/?sheet=WTS-SR1:${sheet.id}:0`);
assert.deepEqual(identity, { id: sheet.id, page: 0 });
assert.equal(parseSheetCode('no qr here'), null);

const prompt = buildExtractionPrompt(sheet, 0);
assert.equal(prompt.includes('Adigun Bazim'), false, 'student names must not be sent for OCR matching');
assert.match(prompt, /"row_index":1/);

const clear = normalizeExtraction(sheet, cases.clear_qr.provider, 0);
assert.equal(clear.summary.ready, 8);
assert.equal(clear.summary.review, 0);
assert.equal(clear.cells.find((cell) => cell.student_id.endsWith('0001') && cell.component === 'exam').value, 52);
assert.equal(clear.cells.find((cell) => cell.student_id.endsWith('0002') && cell.component === 'ca3').value, 4);

const difficult = normalizeExtraction(sheet, cases.rotated_perspective_manual.provider, 0);
assert.equal(difficult.summary.confirmed, 4);
assert.equal(difficult.summary.blank, 1);
assert.equal(difficult.summary.needs_review, 1);
assert.equal(difficult.summary.out_of_range, 1);
assert.equal(difficult.summary.extraction_failure, 1);
assert.equal(difficult.summary.review, 3);

// Exercise the authenticated server endpoint with a mocked provider and protected RPC.
process.env.GEMINI_API_KEY = 'test-only-key';
const originalFetch = globalThis.fetch;
let providerPrompt = '';
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/rest/v1/rpc/school_result_smart_sheet_read')) {
    return new Response(JSON.stringify({ ok: true, sheet, existing_scores: [{ student_id: sheet.roster[0].student_id, ca1: 7, ca2: null, ca3: null, exam: 54 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('generativelanguage.googleapis.com')) {
    const body = JSON.parse(options.body); providerPrompt = body.contents[0].parts[0].text;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(cases.clear_qr.provider) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected URL ${url}`);
};

const handler = require('../api/smart-recording.js');
const req = {
  method: 'POST', headers: { cookie: 'wts_result_session=session-id.session-secret' },
  body: { action: 'extract', sheet_id: sheet.id, page_index: 0, image_data_url: 'data:image/png;base64,aGVsbG8=' },
};
const response = { statusCode: 0, headers: {}, setHeader(k,v){this.headers[k]=v;}, end(raw){this.body=raw;} };
await handler(req, response);
globalThis.fetch = originalFetch;
assert.equal(response.statusCode, 200);
const body = JSON.parse(response.body);
assert.equal(body.code, 'SMART_SCORES_EXTRACTED');
assert.equal(body.extraction.summary.ready, 8);
assert.equal(body.existing_scores[0].exam, 54);
assert.equal(body.image_fingerprint.length, 64);
assert.equal(providerPrompt.includes('Bakare Fathiat'), false);

const unauthResponse = { statusCode: 0, headers: {}, setHeader(k,v){this.headers[k]=v;}, end(raw){this.body=raw;} };
await handler({ method: 'POST', headers: {}, body: req.body }, unauthResponse);
assert.equal(unauthResponse.statusCode, 401);
assert.equal(JSON.parse(unauthResponse.body).code, 'RESULT_SESSION_REQUIRED');

const badOriginResponse = { statusCode: 0, headers: {}, setHeader(k,v){this.headers[k]=v;}, end(raw){this.body=raw;} };
await handler({ method: 'POST', headers: { origin: 'https://evil.example', cookie: req.headers.cookie }, body: req.body }, badOriginResponse);
assert.equal(badOriginResponse.statusCode, 403);

let commitRpcBody = null;
globalThis.fetch = async (url, options) => {
  assert.match(String(url), /school_result_smart_recording_commit$/);
  commitRpcBody = JSON.parse(options.body);
  return new Response(JSON.stringify({ ok: true, code: 'SMART_SCORES_SAVED', score_fields_saved: 2 }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const resultData = require('../api/result-data.js');
const commitRequest = {
  method: 'POST', headers: { cookie: req.headers.cookie },
  body: { action: 'smart.scores.commit', payload: { sheet_id: sheet.id, rows: [{ student_id: sheet.roster[0].student_id, scores: { ca1: 8, exam: 52 }, existing: { ca1: 7, exam: 54 }, decisions: { ca1: 'use_scanned', exam: 'keep_existing' } }], summary: { corrections_made: 1 }, image_fingerprint: 'abc' } },
};
const commitResponse = { statusCode: 0, headers: {}, setHeader(k,v){this.headers[k]=v;}, end(raw){this.body=raw;} };
await resultData(commitRequest, commitResponse);
globalThis.fetch = originalFetch;
assert.equal(commitResponse.statusCode, 200);
assert.equal(commitRpcBody.p_sheet_id, sheet.id);
assert.equal(commitRpcBody.p_rows[0].decisions.exam, 'keep_existing');
assert.equal(commitRpcBody.p_session_secret, 'session-secret');

// Guardrails in the migration: blank cells are omitted and conflicts require explicit choices.
const migration = fs.readFileSync(new URL('../supabase/migrations/20260904120000_result_smart_recording.sql', import.meta.url), 'utf8');
assert.match(migration, /SMART_CONFLICT_DECISION_REQUIRED/);
assert.match(migration, /keep_existing','use_scanned/);
assert.match(migration, /school_result_score_update/);
assert.match(migration, /revoke all on table public\.result_smart_sheets from anon, authenticated/);

console.log('Smart Recording digital fixtures passed: QR, manual fallback geometry, clear, rotated/perspective, blank, ambiguous, range, failure, conflict guards');
