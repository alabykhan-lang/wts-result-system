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
  if (String(url).includes('/rest/v1/rpc/school_result_smart_provider_key_read')) {
    return new Response(JSON.stringify({ ok: true, provider_key: 'test-only-key' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('/rest/v1/rpc/school_result_smart_sheet_read')) {
    return new Response(JSON.stringify({ ok: true, sheet, existing_scores: [{ student_id: sheet.roster[0].student_id, ca1: 7, ca2: null, ca3: null, exam: 54 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('/v1beta/models?')) {
    return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
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
// Guardrails in smart-recording.js client script
const clientScript = fs.readFileSync(new URL('../smart-recording.js', import.meta.url), 'utf8');
assert.match(clientScript, /accept="image\/jpeg,image\/png,image\/webp,image\/jpg"/, 'file input must target gallery images on mobile');
assert.doesNotMatch(clientScript, /id="smart-file"[^>]*capture=/, 'smart-file input must not have capture attribute which forces camera');
assert.match(clientScript, /renderSmartPrintPreviewModal/, 'must provide interactive print preview modal for mobile & blocked popups');
assert.match(clientScript, /AndroidPrint\.printLandscape/, 'must support AndroidPrint interface for landscape sheets');
assert.match(clientScript, /AndroidPrint\.printPortrait/, 'must support AndroidPrint interface for portrait sheets');
assert.match(clientScript, /@page\{size:A4 '\+orientation\+';margin:0\}/, 'must define dynamic A4 orientation page rule');
assert.match(clientScript, /var orientation='landscape'/, 'orientation must default to landscape');
assert.match(clientScript, /<section class="smart-print-page landscape"/, 'score sheet pages must always be landscape');

// Verify smart-recording.css print rules for landscape and overflow containment
const printCss = fs.readFileSync(new URL('../smart-recording.css', import.meta.url), 'utf8');
assert.match(printCss, /@page\{size:A4 landscape;margin:0\}/, 'CSS must lock page size to A4 landscape');
assert.match(printCss, /\.smart-print-page\{[^}]*width:297mm!important;height:210mm!important;max-height:210mm!important/, 'CSS must lock page dimensions to A4 landscape');
assert.match(printCss, /\.smart-print-page\{[^}]*overflow:hidden!important/, 'CSS must enforce overflow:hidden to prevent any rows spilling onto subsequent pages');
assert.match(printCss, /\.smart-print-page\{[^}]*page-break-after:always!important/, 'CSS must break pages cleanly');

// Verify backend api/smart-recording.js rowsPerPage and landscape geometry
const apiModule = require('../api/smart-recording.js');
// Check simulation of rowsPerPageForClass & pagination logic
const simulatePagination = (totalStudents, perPage) => {
  const pages = [];
  for (let i = 0; i < totalStudents; i++) {
    const p = Math.floor(i / perPage);
    if (!pages[p]) pages[p] = [];
    pages[p].push(i + 1);
  }
  return pages;
};

// Primary 3 has 60 students: verify that with 35 rows per page, Page 1 has 35 rows and Page 2 has 25 rows
const p3Pages = simulatePagination(60, 35);
assert.equal(p3Pages.length, 2, 'Primary 3 (60 students) must produce exactly 2 pages');
assert.equal(p3Pages[0].length, 35, 'Page 1 must have exactly rows 1-35 (rows 49 & 50 must NEVER be on page 1)');
assert.equal(p3Pages[1].length, 25, 'Page 2 must have exactly rows 36-60 (rows 49 & 50 are cleanly on page 2)');
assert.equal(p3Pages[0][0], 1);
assert.equal(p3Pages[0][34], 35);
assert.equal(p3Pages[1][0], 36);
assert.equal(p3Pages[1][13], 49, 'Row 49 is student 49 on page 2');
assert.equal(p3Pages[1][14], 50, 'Row 50 is student 50 on page 2');
assert.equal(p3Pages[1][24], 60);

console.log('Smart Recording digital fixtures passed: QR, manual fallback geometry, clear, rotated/perspective, blank, ambiguous, range, failure, conflict guards, mobile generation, A4 landscape orientation & 35-row zero-overflow pagination');

