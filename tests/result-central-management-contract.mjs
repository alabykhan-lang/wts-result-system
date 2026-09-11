import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portal = await readFile(new URL("../portal_core.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../api/result-auth.js", import.meta.url), "utf8");

assert.doesNotMatch(portal, /central-management-only/);
assert.doesNotMatch(portal, /central-management-mode/);
assert.doesNotMatch(portal, /central_registry_management_allowed/);
assert.doesNotMatch(portal, /CURRENT_CENTRAL_MANAGEMENT_ALLOWED/);

assert.doesNotMatch(auth, /school_result_central_management_access/);
assert.doesNotMatch(auth, /central_registry_management_allowed/);

console.log("Result Central Registry isolation contract passed");

