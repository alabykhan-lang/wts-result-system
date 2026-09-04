'use strict';

const COMPONENTS = ['ca1', 'ca2', 'ca3', 'exam'];

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerRows(payload) {
  const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  const map = new Map();
  rows.forEach((row) => {
    const index = Number(row && row.row_index);
    if (Number.isInteger(index) && index > 0) map.set(index, row);
  });
  return map;
}

function parseSheetCode(raw) {
  const match = /WTS-SR1:([0-9a-f-]{36})(?::(\d+))?/i.exec(String(raw || ''));
  return match ? { id: match[1].toLowerCase(), page: Number(match[2] || 0) } : null;
}

function normalizeExtraction(sheet, providerPayload, pageIndex = 0) {
  const source = providerRows(providerPayload);
  const config = sheet.assessment_config || {};
  const roster = (sheet.roster || []).filter((student) => Number(student.page_index || 0) === Number(pageIndex));
  const cells = [];

  roster.forEach((student) => {
    const detectedRow = source.get(Number(student.row_index)) || {};
    const detectedScores = detectedRow.scores && typeof detectedRow.scores === 'object' ? detectedRow.scores : {};
    COMPONENTS.forEach((component) => {
      const raw = detectedScores[component] && typeof detectedScores[component] === 'object'
        ? detectedScores[component]
        : { value: detectedScores[component] };
      const providerState = String(raw.state || '').toLowerCase();
      const value = numberOrNull(raw.value);
      const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
      const maximum = Number(config[component]);
      let status = 'extraction_failure';
      let reason = 'The score could not be read';

      if (providerState === 'blank' || raw.blank === true) {
        status = 'blank'; reason = 'Empty score cell';
      } else if (value !== null && (value < 0 || value > maximum)) {
        status = 'out_of_range'; reason = `Value must be between 0 and ${maximum}`;
      } else if (value !== null && confidence >= 0.82 && providerState !== 'uncertain') {
        status = 'confirmed'; reason = 'Ready to save';
      } else if (value !== null) {
        status = 'needs_review'; reason = 'Please check this handwriting';
      } else if (providerState === 'uncertain') {
        status = 'needs_review'; reason = 'Please enter the score';
      }

      cells.push({
        student_id: student.student_id,
        student_name: student.name,
        row_index: Number(student.row_index),
        page_row: Number(student.page_row),
        component,
        maximum,
        value,
        detected_value: value,
        confidence,
        status,
        reason,
      });
    });
  });

  return {
    page_index: Number(pageIndex),
    cells,
    summary: cells.reduce((summary, cell) => {
      summary.total += 1;
      summary[cell.status] = (summary[cell.status] || 0) + 1;
      if (cell.status === 'confirmed') summary.ready += 1;
      if (['needs_review', 'out_of_range', 'extraction_failure'].includes(cell.status)) summary.review += 1;
      return summary;
    }, { total: 0, ready: 0, review: 0, confirmed: 0, blank: 0, needs_review: 0, out_of_range: 0, extraction_failure: 0 }),
  };
}

function buildExtractionPrompt(sheet, pageIndex = 0) {
  const rows = (sheet.roster || [])
    .filter((student) => Number(student.page_index || 0) === Number(pageIndex))
    .map((student) => ({ row_index: student.row_index, page_row: student.page_row }));
  return [
    'Read handwritten numeric scores from this WTS controlled score sheet.',
    'Use the printed row number and the known four score columns. Do not OCR or match student names.',
    'Return every listed row and every component: ca1, ca2, ca3, exam.',
    'For a genuinely empty cell use state "blank", value null, confidence 1.',
    'For handwriting that is present but unclear use state "uncertain", your best numeric value or null, and confidence below 0.82.',
    'For a readable number use state "read", numeric value, and confidence from 0 to 1.',
    'Never invent a score. Preserve multi-digit numbers.',
    `Assessment maximums: ${JSON.stringify(sheet.assessment_config || {})}`,
    `Expected rows: ${JSON.stringify(rows)}`,
    `Template geometry: ${JSON.stringify(sheet.geometry || {})}`,
    'Respond as JSON only: {"rows":[{"row_index":1,"scores":{"ca1":{"value":8,"confidence":0.98,"state":"read"},"ca2":{},"ca3":{},"exam":{}}}]}',
  ].join('\n');
}

module.exports = { COMPONENTS, buildExtractionPrompt, normalizeExtraction, numberOrNull, parseSheetCode };
