import assert from 'node:assert/strict';

const baseUrl = (process.env.RESULT_PORTAL_URL || 'https://wts-result-system.vercel.app').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

const unauthenticatedGet = await request('/api/result-auth');
assert.equal(unauthenticatedGet.response.status, 401);
assert.equal(unauthenticatedGet.body.code, 'RESULT_SESSION_REQUIRED');

const unauthenticatedData = await request('/api/result-data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'identity.context', payload: {} }),
});
assert.equal(unauthenticatedData.response.status, 401);
assert.equal(unauthenticatedData.body.code, 'RESULT_SESSION_REQUIRED');

const invalidLogin = await request('/api/result-auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'login',
    login: 'contract-test-invalid-login@example.invalid',
    password: 'contract-test-invalid-password',
  }),
});
assert.equal(invalidLogin.response.status, 400);
assert.equal(invalidLogin.body.ok, false);
assert.equal(invalidLogin.body.code, 'SSO_REQUIRED');
assert.equal(typeof invalidLogin.body.session_secret, 'undefined');
assert.equal(typeof invalidLogin.body.session_id, 'undefined');

console.log(`Result authorization contract passed against ${baseUrl}`);
