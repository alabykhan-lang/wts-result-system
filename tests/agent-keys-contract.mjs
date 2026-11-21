import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portal = await readFile(new URL("../portal_core.html", import.meta.url), "utf8");
const api = await readFile(new URL("../api/result-data.js", import.meta.url), "utf8");
const agentApi = await readFile(new URL("../api/agent-scores.js", import.meta.url), "utf8");
const sql = await readFile(new URL("../supabase/migrations/20261121140000_result_agent_keys.sql", import.meta.url), "utf8");

// The browser never carries an agent key write itself; keys are minted server-side
// and the raw key is never stored.
assert.match(sql, /key_hash text not null unique/);
assert.match(sql, /encode\(digest\(v_key, 'sha256'\), 'hex'\)/);
assert.equal(/key_secret|plain_key|key_plain/i.test(sql), false, "the raw agent key must never be stored");

// Every agent write is scoped and attributed.
assert.match(sql, /not \(v_class = any\(v_key.class_scope\)\)/);
assert.match(sql, /source_application, success, audit_metadata/);
assert.match(sql, /'agent_key', true/);
assert.match(sql, /'agent_key_id', v_key.id/);

// A key cannot go round the portal's rules.
assert.match(sql, /RESULT_TERM_NOT_ACTIVE/);
assert.match(sql, /RESULT_OPERATING_MODE_READ_ONLY/);
assert.match(sql, /RESULT_AGENT_CLEAR_NOT_ALLOWED/);
assert.match(sql, /RESULT_STUDENT_CLASS_MISMATCH/);

// Tables are not readable by browsers.
assert.match(sql, /create policy result_agent_keys_server_only on public\.result_agent_keys/);

// Server routes.
assert.match(api, /action === 'agent_keys\.create'/);
assert.match(api, /action === 'agent_keys\.revoke'/);
assert.match(agentApi, /school_result_agent_score_update/);
assert.match(agentApi, /school_result_agent_roster/);
assert.match(agentApi, /RESULT_AGENT_KEY_REQUIRED/);

// Portal surface.
assert.match(portal, /agent_keys\.create/);
assert.match(portal, /Create key/);

console.log("Agent key contract passed");
