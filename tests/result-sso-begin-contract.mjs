import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/result-sso-token.js');
const headers = new Map();
let body = '';
const req = {
  method: 'POST',
  headers: { origin: 'https://wts-result-system.vercel.app' },
  body: { action: 'sso_begin', portal_origin: 'https://wts-school-platform.vercel.app' },
};
const res = {
  statusCode: 0,
  setHeader(name, value) { headers.set(name.toLowerCase(), value); },
  getHeader(name) { return headers.get(name.toLowerCase()); },
  end(value) { body = value || ''; },
};

await handler(req, res);
assert.equal(res.statusCode, 200);
const payload = JSON.parse(body);
assert.equal(payload.ok, true);
const authorize = new URL(payload.authorize_url);
assert.equal(authorize.origin, 'https://wts-school-platform.vercel.app');
assert.equal(authorize.pathname, '/api/sso/authorize');
assert.equal(authorize.searchParams.get('client_id'), 'result_portal');
assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
assert.match(payload.code_verifier, /^[A-Za-z0-9._~-]{43,128}$/);
assert.equal(payload.state, authorize.searchParams.get('state'));
assert.equal(payload.nonce, authorize.searchParams.get('nonce'));
assert.equal(
  createHash('sha256').update(payload.code_verifier).digest('base64url'),
  authorize.searchParams.get('code_challenge'),
);
const cookie = String(headers.get('set-cookie'));
assert.match(cookie, /wts_result_sso_transaction=/);
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /Secure/);
assert.match(cookie, /SameSite=Lax/);
console.log('Result SSO begin contract passed');
