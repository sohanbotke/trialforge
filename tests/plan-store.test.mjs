import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, mergePlans, validateState } from '../plan-state.mjs';
import { createPlanStore } from '../plan-store.mjs';

const state = (keywords = '') => ({ ...structuredClone(defaultState), keywords });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const documents = new Map();
  let local = state('guest');
  let shown;
  let status;
  let fail = false;
  const listeners = new Map();
  const backend = {
    async load(uid) { return documents.get(uid) || null; },
    async commit(uid, revision, next) {
      if (fail) throw new Error('offline');
      if ((documents.get(uid)?.revision || 0) !== revision) throw Object.assign(new Error('conflict'), { code: 'plan/conflict' });
      documents.set(uid, { revision: revision + 1, state: next });
      return revision + 1;
    },
    subscribe(uid, callback) { listeners.set(uid, callback); return () => listeners.delete(uid); }
  };
  const store = createPlanStore({ backend, onUser() {}, onState(next) { shown = next; }, onStatus(next) { status = next; }, readGuest: () => local, writeGuest(next) { local = next; } });
  return { store, backend, documents, listeners, shown: () => shown, status: () => status, local: () => local, fail: (value) => { fail = value; } };
}

test('accounts load independently and cloud data never replaces the guest plan', async () => {
  const f = fixture();
  await f.store.setUser({ uid: 'alice' });
  assert.equal(f.shown().keywords, '');
  f.store.save(state('alice private'));
  await tick();
  await f.store.setUser({ uid: 'bob' });
  assert.equal(f.shown().keywords, '');
  assert.equal(f.local().keywords, 'guest');
  await f.store.setUser({ uid: 'alice' });
  assert.equal(f.shown().keywords, 'alice private');
  await f.store.setUser(null);
  assert.equal(f.shown().keywords, 'guest');
});

test('failed writes retain edits and can be retried', async () => {
  const f = fixture();
  await f.store.setUser({ uid: 'alice' });
  f.fail(true);
  f.store.save(state('unsaved'));
  await tick();
  assert.equal(f.status().status, 'error');
  assert.equal(f.store.hasUnsaved(), true);
  assert.equal(f.store.canSignOut(), false);
  f.fail(false);
  await f.store.retry();
  assert.equal(f.documents.get('alice').state.keywords, 'unsaved');
  assert.equal(f.store.hasUnsaved(), false);
});

test('concurrent edits do not silently overwrite the newer account plan', async () => {
  const f = fixture();
  await f.store.setUser({ uid: 'alice' });
  f.documents.set('alice', { revision: 1, state: state('other device') });
  f.store.save(state('my pending edit'));
  await tick();
  assert.equal(f.status().status, 'conflict');
  assert.equal(f.documents.get('alice').state.keywords, 'other device');
  assert.equal(f.store.hasUnsaved(), true);
  await f.store.loadLatest();
  assert.equal(f.shown().keywords, 'other device');
  assert.equal(f.store.hasUnsaved(), false);
});

test('rapid saves serialize and preserve the latest edit', async () => {
  const f = fixture();
  await f.store.setUser({ uid: 'alice' });
  f.store.save(state('one'));
  f.store.save(state('two'));
  f.store.save(state('three'));
  await tick();
  assert.equal(f.documents.get('alice').state.keywords, 'three');
  assert.equal(f.store.hasUnsaved(), false);
});

test('late reads from the previous account cannot leak into the next account', async () => {
  const f = fixture();
  let release;
  f.backend.load = (uid) => uid === 'alice' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(null);
  const aliceRead = f.store.setUser({ uid: 'alice' });
  await f.store.setUser({ uid: 'bob' });
  release({ revision: 1, state: state('alice secret') });
  await aliceRead;
  assert.equal(f.shown().keywords, '');
  assert.equal(f.store.currentUser().uid, 'bob');
});

test('remote updates lock edits until the user loads the latest version', async () => {
  const f = fixture();
  await f.store.setUser({ uid: 'alice' });
  f.listeners.get('alice')(1);
  assert.equal(f.status().status, 'remote');
  assert.throws(() => f.store.save(state('stale edit')), /latest/);
});

test('imports are idempotent and preserve existing account preferences', () => {
  const cloud = state('cloud preference');
  const guest = state('guest preference');
  guest.trials.push({ id: 'trial-1', catalogId: 'service-1', service: 'Test', startDate: '2026-09-01', endDate: '2026-09-14', monthlyValue: 12, status: 'active', goal: 'Local goal' });
  const merged = mergePlans(cloud, guest);
  assert.equal(merged.keywords, 'cloud preference');
  assert.equal(mergePlans(merged, guest).trials.length, 1);
  assert.equal(mergePlans(state(), guest).keywords, 'guest preference');
  assert.throws(() => validateState({ ...guest, trials: [{ ...guest.trials[0], startDate: '2026-02-31' }] }), /Invalid trial/);
});
