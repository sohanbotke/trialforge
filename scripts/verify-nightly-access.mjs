// Safe diagnostics against our own candidate, never a user's document.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { accessToken, project } from '../backend/upload-nightly.mjs';
const latest = JSON.parse(await readFile(new URL('../backend/data/nightly/latest.json', import.meta.url), 'utf8'));
const id = latest.candidates[0]?.id;
assert.match(id, /^[a-f0-9]{64}$/);
const token = await accessToken();
const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/candidates/${id}`;
for (const method of ['GET', 'PATCH', 'DELETE']) {
  // Impossible update-time precondition protects the record even if a role was
  // accidentally broader than intended. Do not remove this guard.
  const suffix = method === 'GET' ? '' : '?currentDocument.updateTime=2000-01-01T00%3A00%3A00Z';
  const response = await fetch(url + suffix, { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { status: { stringValue: 'pending_review' } } }) } : {}) });
  const result = await response.json();
  assert.equal(response.status, 403, `${method} must be denied`);
  assert.equal(result.error?.status, 'PERMISSION_DENIED');
  console.log(`Collector ${method}: denied as intended.`);
}
const publicRead = await fetch(url, { signal: AbortSignal.timeout(20000) });
assert.equal(publicRead.status, 403, 'Review queue must not be public.');
console.log('Unauthenticated review read: denied as intended.');
