import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedCost, reviewedFirst, matchesConsumerFilters, shortlistRecord } from '../consumer-model.mjs';
import { defaultState, validateState, mergePlans } from '../plan-state.mjs';
import { createPlanStore } from '../plan-store.mjs';

const preview = { id: 'preview', name: 'Preview', monthlyValue: 0, upfrontCost: 0, verificationStatus: 'unreviewed' };
const reviewed = { ...preview, id: 'reviewed', name: 'Reviewed', verificationStatus: 'reviewed', offerType: 'free_tier' };
const saved = () => shortlistRecord(preview, { id: 'saved-1', createdAt: '2026-09-12T12:00:00Z' });
const stateWith = record => ({ ...structuredClone(defaultState), trials: [record] });

test('unreviewed or missing costs never become confirmed zero-cost claims', () => {
  assert.equal(reviewedCost(preview), null);
  assert.equal(reviewedCost(reviewed), 0);
  for (const monthlyValue of [undefined, null, '0', -1, Infinity, NaN]) assert.equal(reviewedCost({ ...reviewed, monthlyValue }), null);
});

test('reviewed-first ordering preserves the order inside each group', () => {
  assert.deepEqual([preview, reviewed, { ...preview, id: 'second' }].sort(reviewedFirst).map(v => v.id), ['reviewed', 'preview', 'second']);
});

test('budget zero is a real filter; unknown prices and types are not matches', () => {
  assert.equal(matchesConsumerFilters(preview), true);
  assert.equal(matchesConsumerFilters(preview, { maximum: '0' }), false);
  assert.equal(matchesConsumerFilters(reviewed, { maximum: '0' }), true);
  assert.equal(matchesConsumerFilters({ ...reviewed, monthlyValue: 10.01 }, { maximum: '10' }), false);
  assert.equal(matchesConsumerFilters({ ...reviewed, monthlyValue: 10 }, { maximum: '10' }), true);
  assert.equal(matchesConsumerFilters(preview, { review: 'reviewed' }), false);
  assert.equal(matchesConsumerFilters({ ...preview, offerType: 'trial' }, { type: 'trial' }), false);
  assert.equal(matchesConsumerFilters(reviewed, { type: 'free_tier' }), true);
});

test('saving has no dates; reload, export/import and merging preserve that state', () => {
  const record = saved();
  assert.equal(record.status, 'saved');
  assert.equal(record.startDate, '');
  assert.equal(record.endDate, '');
  const plan = validateState(JSON.parse(JSON.stringify(stateWith(record))));
  assert.deepEqual(plan.trials[0], record);
  assert.equal(mergePlans(plan, plan).trials.length, 1);
  assert.throws(() => validateState(stateWith({ ...record, startDate: '2026-09-12' })), /Invalid trial/);
  assert.throws(() => validateState(stateWith({ ...record, status: 'active' })), /Invalid trial/);
});

test('existing started/decided plans keep their dates and status', () => {
  for (const status of ['active', 'keep', 'cancel']) {
    const record = { ...saved(), status, startDate: '2026-09-01', endDate: '2026-09-20' };
    assert.deepEqual(validateState(stateWith(record)).trials[0], record);
  }
});

test('saved options survive account synchronization and do not leak to guest storage', async () => {
  let document, shown;
  const guest = structuredClone(defaultState);
  const store = createPlanStore({
    backend: { async load() { return document; }, async commit(uid, revision, state) { document = { revision: revision + 1, state }; return document.revision; }, subscribe() { return () => {}; } },
    onState(next) { shown = next; }, onStatus() {}, onUser() {}, readGuest: () => guest,
    writeGuest() { throw new Error('Account must not write guest data'); }
  });
  await store.setUser({ uid: 'test-only' });
  store.save(stateWith(saved()));
  await new Promise(resolve => setTimeout(resolve, 0));
  await store.loadLatest();
  assert.equal(shown.trials[0].status, 'saved');
  await store.setUser(null);
  assert.equal(shown.trials.length, 0);
});
