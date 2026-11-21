import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../portal_core.html", import.meta.url), "utf8");

// Pull the clear-detection block out of dbUpsertScore so the shipped logic is
// what gets exercised here.
const start = source.indexOf("// An emptied box must clear the stored mark");
const end = source.indexOf("var ck=dbClassKey(CLS);", start);
assert.ok(start > 0 && end > start, "clear-detection block not found in portal source");
const block = source.slice(start, end);

const run = new Function(
  "SCORE_CLEARS",
  "scorePersisted",
  "scoreCellValue",
  "scoreDraftKey",
  "d",
  "studentId",
  "subjectIdx",
  `${block}\nreturn clear;`
);

const scoreCellValue = (value) => (value === null || value === undefined ? "" : value);
const scoreDraftKey = (studentId, subjectIdx) => `${studentId}|${subjectIdx}`;
const empty = { ca1: null, ca2: null, ca3: null, exam: null };

// 1. The page still holds an empty copy of the row (another device or an
//    automation wrote the mark), the user empties the box: it must be cleared.
let persisted = { ...empty };
let clear = run({ "s1|5": { exam: true } }, () => persisted, scoreCellValue, scoreDraftKey,
  { ca1: 9, ca2: null, ca3: 10, exam: null }, "s1", 5);
assert.deepEqual(clear, ["exam"], "stale local row must still clear the emptied mark");

// 2. Untouched empty boxes never send a clear.
persisted = { ca1: "9", ca2: null, ca3: "10", exam: "10" };
clear = run({}, () => persisted, scoreCellValue, scoreDraftKey,
  { ca1: 9, ca2: null, ca3: 10, exam: 10 }, "s1", 5);
assert.deepEqual(clear, [], "untouched empty components must not be cleared");

// 3. Cached row knows the mark: the old behaviour still clears it.
clear = run({}, () => persisted, scoreCellValue, scoreDraftKey,
  { ca1: 9, ca2: null, ca3: 10, exam: null }, "s1", 5);
assert.deepEqual(clear, ["exam"], "a mark present in the local row must clear");

// 4. The explicit clear set is what carries a stale row, and only for that row.
clear = run({ "s1|5": { exam: true } }, () => persisted, scoreCellValue, scoreDraftKey,
  { ca1: 9, ca2: null, ca3: 10, exam: null }, "s1", 5);
assert.deepEqual(clear, ["exam"]);
clear = run({ "s1|5": { exam: true } }, () => empty, scoreCellValue, scoreDraftKey,
  { ca1: null, ca2: null, ca3: null, exam: null }, "s2", 5);
assert.deepEqual(clear, [], "a clear recorded for one row must not clear another");

// 5. Value typed back after emptying withdraws the clear.
assert.match(source, /if\(raw===null\)clears\[field\]=true;else delete clears\[field\];/);
assert.match(source, /delete SCORE_CLEARS\[key\];/);

console.log("Score clear contract passed");
