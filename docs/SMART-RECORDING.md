# Smart Recording

Smart Recording is part of the existing Result Portal. It does not create a second student, subject, authentication, or score database.

## Flow

1. Generate a Smart Score Sheet for a current class and subject.
2. The protected server creates a unique sheet ID and stores the roster row map, assessment limits, template version, and cell geometry.
3. The printed QR contains `WTS-SR1:<sheet UUID>:<page index>` and is only a routing identifier.
4. A phone capture is orientation-normalized and resized in the browser. Native QR detection is attempted first, with `jsQR` as a fallback.
5. If QR detection fails, the user selects class, subject, session, and term; the latest matching generated template is loaded.
6. The server sends the image and controlled row/column geometry to the configured handwriting provider. Student names are not used for OCR matching.
7. Provider output is normalized into `confirmed`, `needs_review`, `blank`, `out_of_range`, or `extraction_failure` cells.
8. Only exception cells require review. The original score-cell crop, detected value, and assessment maximum are shown.
9. Existing-score conflicts require `keep_existing` or `use_scanned` before save.
10. The protected batch RPC validates the full request and delegates every student record to the existing `school_result_score_update` function.

## Server configuration

Handwriting extraction runs only in `api/smart-recording.js`. Configure one of these Vercel server environment variables:

- `WTS_GEMINI_API_KEY` (preferred)
- `GEMINI_API_KEY`

Optional:

- `WTS_SMART_RECORDING_MODEL` (defaults to `gemini-2.5-flash`)

No provider key is read from browser storage or returned to the client.

## Database security

- `result_smart_sheets` and `result_smart_recordings` have RLS enabled.
- `anon` and `authenticated` have no direct table privileges.
- Explicit deny policies document the RPC-only boundary.
- Security-definer RPCs require the portal's opaque session ID and secret, then call the existing Result authorization functions for class, subject, academic context, and `scores.enter` permission.

## Test boundary

`tests/smart-recording.test.mjs` covers controlled row mapping, QR parsing, clear and distorted fixture responses, blank cells, ambiguous handwriting, invalid ranges, extraction failures, protected endpoint behavior, and conflict payload forwarding. Provider responses are mocked so these tests never alter production result data.

Actual printed handwriting and camera conditions still require a physical phone test.
