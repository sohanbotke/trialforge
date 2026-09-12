import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord, firestoreValue, createRecord } from '../backend/upload-nightly.mjs';
const id = 'a'.repeat(64);
const item = { id, schemaVersion: 1, observedAt: '2026-09-08T12:00:00Z', status: 'pending_review', verificationStatus: 'unverified', evidence: ['Free trial'], url: 'https://example.com', sourceUrl: 'https://example.com', evidenceUrl: 'https://example.com', policyUrl: 'https://example.com' };

test('only review records can be uploaded; no user paths or approval', () => {
  validateRecord(`candidates/${id}`, item);
  assert.throws(() => validateRecord('users/alice/plans/default', item));
  assert.throws(() => validateRecord(`catalog/${id}`, item));
  assert.throws(() => validateRecord(`candidates/${id}`, { ...item, status: 'published' }));
  assert.throws(() => validateRecord(`candidates/${id}`, { ...item, evidence: ['x'.repeat(501)] }));
  assert.throws(() => validateRecord(`candidates/${id}`, { ...item, url: 'javascript:alert(1)' }));
});

test('typed Firestore serialization', () => {
  assert.deepEqual(firestoreValue({ a: 3, b: [true, null] }), { mapValue: { fields: { a: { integerValue: '3' }, b: { arrayValue: { values: [{ booleanValue: true }, { nullValue: null }] } } } } });
});

test('create-only request; duplicate retry is acknowledged', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /\/candidates\?documentId=/);
    assert.equal(options.method, 'POST');
    return { ok: false, status: 409, json: async () => ({ error: { status: 'ALREADY_EXISTS' } }) };
  };
  try { assert.equal(await createRecord('test-token', `candidates/${id}`, item), 'already_exists'); }
  finally { globalThis.fetch = original; }
});

test('permission failures are not acknowledged or overwritten', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED' } }) });
  try { await assert.rejects(createRecord('test-token', `candidates/${id}`, item), /Outbox retained/); }
  finally { globalThis.fetch = original; }
});
