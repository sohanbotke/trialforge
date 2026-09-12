import assert from 'node:assert/strict';
import test from 'node:test';
import { draftSuggestions } from '../catalog-model.mjs';
const row = value => ({value,quote:'The Demo Free plan is free to use.'});
const item = fields => ({evidenceUrl:'https://example.com/pricing',aiDraft:{schemaVersion:1,status:'unverified',provider:'ollama-local',sourceUrl:'https://example.com/pricing',model:'local-test',fields}});
test('drafts only expose explicitly allowed fields and preserve zero',()=>{
  const draft=draftSuggestions(item({name:row('Demo'),monthlyValue:row(0),confirmed:row(true),url:row('https://evil.example'),id:row('overwrite')}));
  assert.deepEqual(draft.fields,{name:'Demo',monthlyValue:0});
  assert(draft.missing.includes('cancellation'));
});
test('drafts reject type confusion, oversized fields and contradictory pricing',()=>{
  const draft=draftSuggestions(item({name:row('x'.repeat(121)),offerType:row('free_tier'),trialDays:row(30),monthlyValue:row(10),upfrontCost:row(true)}));
  assert.deepEqual(draft.fields,{offerType:'free_tier'});
  assert.equal(draft.evidence.length,1);
});
test('draft provenance mismatches are not applied',()=>{
  for(const changes of [{status:'approved'},{provider:'cloud'},{sourceUrl:'https://evil.example'},{schemaVersion:2}]){
    const value=item({name:row('Demo')});Object.assign(value.aiDraft,changes);assert.equal(draftSuggestions(value),null);
  }
});
