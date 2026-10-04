import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedCost, reviewedFirst, matchesConsumerFilters, shortlistRecord, comparisonFacts, decisionCalendar, reviewLabel, offerConfidence } from '../consumer-model.mjs';
import { defaultState, validateState, mergePlans } from '../plan-state.mjs';
import { createPlanStore } from '../plan-store.mjs';
import { searchIntent, searchTextScore, matchesCatalogSearch, emptySearchMessage, rankCatalogOffers, searchCoverageMessage } from '../consumer-model.mjs';

test('specific dating phrases signal relationships; love verbs and sports do not', () => {
  const dating={name:'Fixture dating service',description:'Meet singles and build relationships.'};
  const streaming={name:'Fixture streaming service',description:'Movies and live sports. Find shows you love.'};
  for(const query of ['find love','dating apps','relationship services','matchmaking']) {
    assert.equal(searchIntent(query),'relationships');
    assert.equal(matchesCatalogSearch(dating,query),true);
    assert.equal(matchesCatalogSearch(streaming,query),false);
  }
  assert.equal(searchIntent('I love movies'),'general');
  assert.equal(searchIntent('I love coding'),'general');
  for(const query of ['love','I love cooking','love a good deal','tennis singles','singles']) assert.equal(searchIntent(query),'general');
  assert.match(emptySearchMessage('love'),/dating or relationship services/);
});
test('provider exact/prefix/typo matches outrank affinity; price never creates relevance', () => {
  const options=[
    {id:'hulu',name:'Hulu',categories:['shows'],description:'Stream movies'},
    {id:'netflix',name:'Netflix',categories:['shows'],description:'Streaming research fixture; no trial claim'},
    {id:'hosting',name:'Free Hosting',categories:['cloudinfra'],description:'Deploy apps',monthlyValue:0},
    {id:'notes',name:'Notes',categories:['productivity'],description:'A notebook mentioning Netflix'}
  ];
  for(const [query,id] of [['hulu','hulu'],['hul','hulu'],['netflx','netflix'],['Netflix','netflix']]) {
    assert.equal(rankCatalogOffers(options,{text:query,interests:['cloudinfra']})[0].id,id);
  }
  assert.deepEqual(rankCatalogOffers(options,{text:'zzznomatch',interests:['cloudinfra'],budget:50}),[]);
  assert.deepEqual(rankCatalogOffers(options,{text:'tennis singles'}),[]);
  assert.match(rankCatalogOffers(options,{text:'netflx'})[0].rankReason,/spelling match/);
  assert.match(searchCoverageMessage('netflx',options.filter(item=>item.id!=='netflix')),/not in this catalog/);
  assert.equal(searchCoverageMessage('netflx',options),'');
});
test('generic offer search returns research prospects without fabricating confirmed prices', () => {
  const options=[{id:'free',name:'Free hosting',facets:['free cloud hosting'],verificationStatus:'unreviewed'},
    {id:'other',name:'Paid reference',facets:[],verificationStatus:'unreviewed'}];
  const results=rankCatalogOffers(options,{text:'free trial'});
  assert.deepEqual(results.map(item=>item.id),['free']);
  assert.equal(reviewedCost(results[0]),null);
  assert.match(results[0].rankReason,/Research option/);
});
test('unknown queries and generic query words cannot create relevance from price', () => {
  const free={name:'Cloud fixture',description:'A free hosting plan',monthlyValue:0};
  assert.equal(searchTextScore(free,'find me something for zzzunknown'),0);
  assert.equal(matchesCatalogSearch(free,'zzznomatch'),false);
  assert.equal(matchesCatalogSearch(free,'hosting'),true);
  assert.equal(matchesCatalogSearch(free,''),true);
});

const preview = { id: 'preview', name: 'Preview', monthlyValue: 0, upfrontCost: 0, verificationStatus: 'unreviewed' };
const reviewed = { ...preview, id: 'reviewed', name: 'Reviewed', verificationStatus: 'reviewed', verifiedAt:new Date().toISOString(), offerType: 'free_tier' };
const saved = () => shortlistRecord(preview, { id: 'saved-1', createdAt: '2026-09-12T12:00:00Z' });
const stateWith = record => ({ ...structuredClone(defaultState), trials: [record] });

test('consumer check labels use evidence timestamps, not legacy display dates', () => {
  const offer = {...reviewed, verified:'2000-01-01'};
  assert.equal(reviewLabel(offer), `Terms checked ${offer.verifiedAt.slice(0,10)}`);
  assert.equal(comparisonFacts(offer).review, reviewLabel(offer));
  assert.match(offerConfidence(offer).detail, /Offers can change; this is not a provider endorsement/);
  assert.equal(reviewLabel({...offer, verifiedAt:'2020-01-01T00:00:00Z'}), 'Needs recheck — last checked 2020-01-01');
  for (const verifiedAt of [null, 'invalid']) {
    assert.match(reviewLabel({...offer, verifiedAt}), /missing or invalid/);
    assert.equal(reviewedCost({...offer, verifiedAt}), null);
  }
  assert.equal(reviewLabel(preview), 'Terms not confirmed');
});

test('comparison distinguishes reviewed zero from unreviewed and unavailable facts', () => {
  assert.equal(comparisonFacts(preview).monthly, 'Not confirmed');
  assert.equal(comparisonFacts(undefined).monthly, 'Not confirmed');
  assert.equal(comparisonFacts(reviewed).monthly, '$0.00/mo base');
  assert.equal(comparisonFacts(reviewed).duration, 'No trial countdown');
  assert.equal(comparisonFacts({...reviewed, offerType:'trial', providerTrialDays:7, monthlyValue:12.5}).monthly, '$12.50/mo after trial');
  assert.equal(comparisonFacts({...reviewed, offerType:'trial', providerTrialDays:7}).duration, '7 days');
  assert.equal(comparisonFacts({...reviewed, offerType:'trial'}).duration, 'Not confirmed');
  assert.equal(comparisonFacts({...reviewed, monthlyValue:undefined}).monthly, 'Not confirmed');
  assert.equal(comparisonFacts({...preview, eligibility:'Unverified claim'}).eligibility, 'Not confirmed');
});

test('calendar export uses the confirmed all-day decision date and omits private notes', () => {
  const trial = {...saved(), status:'active', endDate:'2028-02-29', service:'A, B; C\\D\nEND:VEVENT', goal:'PRIVATE GOAL', keepCriteria:'PRIVATE NOTES'};
  const ics = decisionCalendar(trial, new Date('2026-09-27T12:30:00Z'));
  assert.match(ics, /DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301/);
  assert.match(ics, /DTSTAMP:20260927T123000Z/);
  assert(ics.includes('SUMMARY:Decide about A\\, B\\; C\\\\D\\nEND:VEVENT'));
  assert.equal(ics.split('\r\nEND:VEVENT\r\n').length, 2);
  assert.doesNotMatch(ics, /PRIVATE GOAL|PRIVATE NOTES|VALARM/);
  for (const endDate of ['', '2026-02-30', '2026-13-01', 'invalid']) assert.throws(() => decisionCalendar({...trial, endDate}));
  assert.throws(() => decisionCalendar({...trial, status:'saved'}));
  assert.throws(() => decisionCalendar({...trial, status:'cancel'}));
});

test('calendar export folds Unicode safely and handles year rollover', () => {
  const service = '日本語😀'.repeat(50);
  const trial = {...saved(), service, status:'active', endDate:'2026-12-31'};
  const ics = decisionCalendar(trial);
  assert.match(ics, /DTEND;VALUE=DATE:20270101/);
  for (const line of ics.split('\r\n')) assert(Buffer.byteLength(line) <= 75);
  assert(ics.replaceAll('\r\n ', '').includes(`SUMMARY:Decide about ${service}`));
});

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
