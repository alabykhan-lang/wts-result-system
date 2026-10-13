import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Read portal_core.html and smart-recording.js
const portalPath = path.join(__dirname, '..', 'portal_core.html');
const smartPath = path.join(__dirname, '..', 'smart-recording.js');
const catalogDumpPath = path.join(__dirname, '..', '..', 'catalog_dump.json');

const portalHtml = fs.readFileSync(portalPath, 'utf8');
const smartJs = fs.readFileSync(smartPath, 'utf8');
const catalogDump = JSON.parse(fs.readFileSync(catalogDumpPath, 'utf8'));

// Extract JS from portal_core.html
const dummyEl = () => ({
  style: {},
  classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
  getAttribute: () => null,
  appendChild: () => {},
  removeChild: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  innerHTML: '',
  textContent: '',
  value: ''
});

const sandbox = {
  window: null,
  document: {
    getElementById: dummyEl,
    querySelector: dummyEl,
    querySelectorAll: () => [],
    createElement: dummyEl,
    body: dummyEl(),
    head: dummyEl(),
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  location: {
    origin: 'https://wts-result-system.vercel.app',
    href: 'https://wts-result-system.vercel.app',
    hostname: 'wts-result-system.vercel.app',
    pathname: '/',
    search: '',
    protocol: 'https:'
  },
  navigator: { userAgent: 'node' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  URL: URL,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  Promise: Promise
};
sandbox.window = sandbox;

// Run the core data section in vm
const scriptMatch = portalHtml.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g);
assert.ok(scriptMatch && scriptMatch.length > 0, 'Must find inline script tags in portal_core.html');

// Create context and evaluate all script tags from portal_core
vm.createContext(sandbox);

// Provide minimal stubs for functions called at top-level
sandbox.getCfg = () => ({ depts: {} });
sandbox.isCentralAuth = () => false;
sandbox.resultDataRequest = () => Promise.resolve({ rows: [] });
sandbox.getActiveSession = () => '2026/2027';
sandbox.officialAcademicContext = () => ({ session: '2026/2027', term: '1st Term' });
sandbox.showToast = () => {};
sandbox.canWriteResults = () => true;
sandbox.hasResultPermission = () => true;

for (const scriptTag of scriptMatch) {
  const code = scriptTag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  try {
    vm.runInContext(code, sandbox);
  } catch (e) {
    console.error('Script evaluation error:', e.message);
  }
}

// Also evaluate smart-recording.js
try {
  vm.runInContext(smartJs, sandbox);
} catch (e) {
  console.error('smartJs eval error:', e.message);
}

console.log('=== TEST 1: CATALOG PRESENCE & ACCURACY ACROSS ALL 20 CLASSES ===');
const catalogClasses = Object.keys(catalogDump);
assert.equal(catalogClasses.length, 20, 'Catalog dump must have 20 classes');

let totalCheckedRows = 0;
for (const classKey of catalogClasses) {
  const expectedRows = catalogDump[classKey];
  const map = sandbox.classSubjectMap(classKey);
  assert.ok(map, `Map must exist for ${classKey}`);

  for (const expected of expectedRows) {
    totalCheckedRows++;
    const idx = expected.index;
    const resolvedName = sandbox.subjectNameByIndex(classKey, idx);
    assert.equal(
      resolvedName,
      expected.name,
      `Class ${classKey} index ${idx} must be "${expected.name}", got "${resolvedName}"`
    );

    const catalogItem = map[idx];
    assert.ok(catalogItem, `Catalog item for ${classKey} index ${idx} must exist`);
    assert.equal(catalogItem.index, idx, `Catalog item index must be ${idx}`);
    assert.equal(catalogItem.name, expected.name, `Catalog item name must match`);
    assert.equal(catalogItem.active, expected.active, `Catalog item active status must match for ${classKey}[${idx}]`);
  }
}
console.log(`✓ All ${totalCheckedRows} catalog rows across 20 classes match result_subject_catalog perfectly.`);

console.log('=== TEST 2: JSS2 SUBJECT INDEX ALIGNMENT ===');
// JSS2 has index 10 missing in DB catalog. History is index 12 (59 scores). Islamic Studies is index 11.
assert.equal(sandbox.subjectNameByIndex('jss2', 11), 'Islamic Studies');
assert.equal(sandbox.subjectNameByIndex('jss2', 12), 'History');
assert.equal(sandbox.subjectNameByIndex('jss2', 14), 'Business Studies');

// Check active subjects list for JSS2
const jss2Active = sandbox.classSubjectList('jss2');
const jss2History = jss2Active.find(s => s.name === 'History');
const jss2Islam = jss2Active.find(s => s.name === 'Islamic Studies');
assert.ok(jss2History, 'History must be present in JSS2 active subjects');
assert.ok(jss2Islam, 'Islamic Studies must be present in JSS2 active subjects');
assert.equal(jss2History.index, 12, 'History in JSS2 must have subject_index 12');
assert.equal(jss2Islam.index, 11, 'Islamic Studies in JSS2 must have subject_index 11');
console.log('✓ JSS2: Islamic Studies is index 11, History is index 12 (no missing-index collapse).');

console.log('=== TEST 3: SS1-GENERAL SUBJECT INDEX ALIGNMENT ===');
// SS1 General: index 5 is Biology, index 8 is Literature (inactive), index 9 is Government, index 11 is Financial Accounting
assert.equal(sandbox.subjectNameByIndex('ss1-general', 5), 'Biology');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 8), 'Literature');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 9), 'Government');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 10), 'I.R.S');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 11), 'Financial Accounting');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 12), 'Commerce');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 13), 'Geography');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 14), 'Agricultural Science');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 15), 'Livestock Farming');
assert.equal(sandbox.subjectNameByIndex('ss1-general', 16), 'Yoruba');

const ss1Active = sandbox.classSubjectList('ss1-general');
const ss1Gov = ss1Active.find(s => s.name === 'Government');
const ss1Fin = ss1Active.find(s => s.name === 'Financial Accounting');
const ss1Bio = ss1Active.find(s => s.name === 'Biology');
const ss1Lit = ss1Active.find(s => s.name === 'Literature');

assert.equal(ss1Gov.index, 9, 'Government in ss1-general must have subject_index 9');
assert.equal(ss1Fin.index, 11, 'Financial Accounting in ss1-general must have subject_index 11');
assert.equal(ss1Bio.index, 5, 'Biology in ss1-general must have subject_index 5');
assert.equal(ss1Lit, undefined, 'Literature (active: false) must not be in active entry list');
console.log('✓ SS1 General: Government is index 9, Financial Accounting is index 11, Biology is index 5 (no inactive-drop shift).');

console.log('=== TEST 4: PROMOTION AVERAGE CALCULATION WITH GAPS & INACTIVE INDICES ===');
// Simulate student scores
const studentId = 'test-stu-1';
const mockScores = [
  { student_id: studentId, subject_index: 5, ca1: 8, ca2: 8, ca3: 8, exam: 50 }, // Bio: 74
  { student_id: studentId, subject_index: 9, ca1: 7, ca2: 7, ca3: 7, exam: 45 }, // Gov: 66
  { student_id: studentId, subject_index: 11, ca1: 9, ca2: 9, ca3: 9, exam: 55 } // Fin Acc: 82
];
// Average of the 3 subjects: (74 + 66 + 82) / 3 = 222 / 3 = 74.0
const avg = sandbox.calcPromotionAverage(studentId, 'ss1-general', mockScores, [
  { subject_index: 5 }, { subject_index: 9 }, { subject_index: 11 }
]);
assert.equal(avg, 74, `Expected promotion average 74.0, got ${avg}`);
console.log('✓ calcPromotionAverage matches scores strictly by subject_index, ignoring array position.');

console.log('=== TEST 5: SMART RECORDING TARGET RESOLUTION ===');
if (typeof sandbox.subjectTargetsForKeys === 'function') {
  const govTargets = sandbox.subjectTargetsForKeys('ss1-general', ['government']);
  assert.equal(govTargets.length, 1);
  assert.equal(govTargets[0].subject_index, 9, 'Smart Recording target for Government must be index 9');
  assert.equal(govTargets[0].subject_name, 'Government');

  const histTargets = sandbox.subjectTargetsForKeys('jss2', ['history']);
  assert.equal(histTargets.length, 1);
  assert.equal(histTargets[0].subject_index, 12, 'Smart Recording target for History in JSS2 must be index 12');
  assert.equal(histTargets[0].subject_name, 'History');
  console.log('✓ Smart Recording resolves Government to index 9 and History to index 12.');
}

console.log('=== ALL SUBJECT ALIGNMENT TESTS PASSED ===');
