import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20261121160000_result_agent_full_access.sql", import.meta.url), "utf8");
const lib = await readFile(new URL("../api/_lib.js", import.meta.url), "utf8");
const sessionApi = await readFile(new URL("../api/agent-session.js", import.meta.url), "utf8");
const portal = await readFile(new URL("../portal_core.html", import.meta.url), "utf8");

// A session can only be minted for a full-access key, and only for the owner.
assert.match(sql, /if v_key\.access_level <> 'full' then/);
assert.match(sql, /RESULT_AGENT_KEY_SCORES_ONLY/);
assert.match(sql, /where id = v_key\.created_by_person_id/);
assert.match(sql, /RESULT_AGENT_OWNER_NOT_ACTIVE/);
assert.match(sql, /p_ttl_hours integer default 720/);
assert.match(sql, /make_interval\(hours => greatest\(coalesce\(p_ttl_hours, 720\), 1\)\)/);
assert.match(sql, /v_app not in \('results', 'central_registry', 'staff_self_service'/);

// Every mint is logged.
assert.match(sql, /'result\.agent_key\.session'/);

// Only a manager may issue one: the helper authorises one of the three
// management permissions before the key is written.
assert.match(sql, /school_result_agent_key_authorize\(p_session_id, p_session_secret\)/);

// The server accepts a bearer session, the browser keeps its cookie.
assert.match(lib, /function bearerSession\(req\)/);
assert.match(lib, /if \(!value\) return bearerSession\(req\);/);
assert.match(sessionApi, /school_agent_session/);

// Portal surface.
assert.match(portal, /Everything my account can do/);
assert.match(portal, /access_level:level/);

console.log("Agent full-access contract passed");
