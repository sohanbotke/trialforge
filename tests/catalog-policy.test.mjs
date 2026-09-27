import test from 'node:test';
import assert from 'node:assert/strict';
import { offerStatus, timestampMillis, recheckQueue, REVIEW_WINDOW_MS } from '../catalog-policy.mjs';
import { mergedCatalog } from '../catalog-model.mjs';
import { seedCatalog } from '../seed-catalog.mjs';
import { reviewedCost, comparisonFacts, reviewLabel } from '../consumer-model.mjs';

const now = Date.parse('2026-09-27T12:00:00Z');
const iso = offset => new Date(now + offset).toISOString();
const offer = (overrides = {}) => ({
  id:'test-offer', name:'Test offer', description:'Fixture, not a real provider.', category:'shows',
  url:'https://example.test/', offerType:'trial', trialDays:7, reviewDays:7, monthlyValue:12.5,
  upfrontCost:0, currency:'USD', priceDetails:'Monthly subscription after trial.',
  eligibility:'Fixture accounts', region:'US', cancellation:'Cancel in provider account.',
  goal:'Try a show', status:'published', verifiedAt:iso(0), expiresAt:null, ...overrides
});

test('freshness is current only before the exact seven-day boundary', () => {
  assert.equal(offerStatus(offer({verifiedAt:iso(-REVIEW_WINDOW_MS+1)}),now),'current');
  assert.equal(offerStatus(offer({verifiedAt:iso(-REVIEW_WINDOW_MS)}),now),'stale');
  assert.equal(offerStatus(offer({verifiedAt:iso(-REVIEW_WINDOW_MS-1)}),now),'stale');
});
test('invalid, absent and future verification dates fail closed', () => {
  for (const verifiedAt of [undefined,null,'','2026-09-27','2026-02-30T00:00:00Z',iso(1),42,{}, {toMillis(){throw Error('bad');}}, {toMillis:()=>1e100}]) {
    assert.equal(offerStatus(offer({verifiedAt}),now),'needs_verification');
  }
  assert.equal(offerStatus(offer(),NaN),'needs_verification');
  assert.equal(timestampMillis({toMillis:()=>now}),now);
  assert.equal(timestampMillis({toDate:()=>new Date(now)}),now);
});
test('expiry, withdrawal and known retirement override recent verification', () => {
  for (const expiresAt of [iso(0),iso(-1),'not a date']) assert.equal(offerStatus(offer({expiresAt}),now),'expired');
  assert.equal(offerStatus(offer({expiresAt:iso(1)}),now),'current');
  assert.equal(offerStatus(offer({status:'withdrawn'}),now),'withdrawn');
  assert.equal(offerStatus(offer({id:'github-models'}),now),'retired');
  assert.equal(offerStatus(offer({id:'constructor'}),now),'current');
});
test('tombstones, expiry, malformed overrides and retirement suppress seed fallback', () => {
  for (const overrides of [{status:'withdrawn'}, {expiresAt:iso(0)}, {monthlyValue:-1}]) {
    assert.deepEqual(mergedCatalog([{id:'test-offer'}],[offer(overrides)],now),[]);
  }
  assert(!mergedCatalog(seedCatalog,[offer({id:'github-models'})],now).some(item=>item.id==='github-models'));
  assert.equal(mergedCatalog([],[offer({expiresAt:iso(1)})],now).length,1,'Expiry validation must use supplied clock');
});
test('stale and undated offers retain research identity, never current cost claims', () => {
  for (const verifiedAt of [iso(-REVIEW_WINDOW_MS),undefined]) {
    const [item] = mergedCatalog([],[offer({verifiedAt})],now);
    assert.notEqual(item.verificationStatus,'reviewed');
    assert.equal(reviewedCost(item),null);
    assert.equal(comparisonFacts(item).monthly,'Not confirmed');
    assert.match(reviewLabel(item),/Needs (recheck|verification)/);
  }
});
test('raw seeds cannot prefill fake trial lengths, prices or verification dates', () => {
  assert.equal(seedCatalog.length,35);
  for (const seed of seedCatalog) {
    for (const field of ['trialDays','monthlyValue','verified','verifiedAt']) assert(!Object.hasOwn(seed,field),`${seed.id}.${field}`);
  }
});
test('recheck queue includes all overdue published states, excludes current and private entries', () => {
  const records = [offer(),offer({id:'stale',verifiedAt:iso(-2*REVIEW_WINDOW_MS)}),
    offer({id:'undated',verifiedAt:null}),offer({id:'expired',expiresAt:iso(-1)}),
    offer({id:'withdrawn',status:'withdrawn'}),offer({id:'private',status:'pending'}),
    offer({id:'github-models'}),offer({id:'invalid-sdk',verifiedAt:{toMillis:()=>1e100}})];
  const queue = recheckQueue(records,now);
  assert.deepEqual(queue.map(item=>item.id),['stale','expired','github-models','invalid-sdk','undated']);
  assert.equal(queue[0].dueAt,iso(-REVIEW_WINDOW_MS));
  assert.equal(queue[3].verifiedAt,null);
  assert.deepEqual(Object.keys(queue[0]).sort(),['dueAt','id','name','status','url','verifiedAt']);
});
