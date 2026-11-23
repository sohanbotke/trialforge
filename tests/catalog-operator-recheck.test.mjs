import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecheckWrites,decode,documentPaths,reviews,root} from '../scripts/recheck-2026-10-24.mjs';

const now=new Date('2026-10-24T17:00:00Z');
function encode(v){
  if(v===null)return {nullValue:null};
  if(typeof v==='string')return {stringValue:v};
  if(typeof v==='number')return {integerValue:String(v)};
  return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,v])=>[k,encode(v)]))}};
}
function doc(name,fields){return {name,updateTime:'2026-10-01T00:00:00.000001Z',fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,encode(v)]))};}
function fixture(){return new Map(reviews.map(item=>{
  const name=`${root}/catalog/${item.id}`;
  const data={id:item.id,name:item.id,description:'Fixture only',category:'devtools',url:item.url,
    offerType:item.type,trialDays:item.type==='trial'?30:0,reviewDays:14,monthlyValue:0,upfrontCost:0,
    currency:'USD',priceDetails:'Fixture pricing',eligibility:'Fixture eligibility',region:'Confirm at signup',
    cancellation:'Fixture cancellation',goal:'Evaluate one project',expiresAt:null,sourceCandidate:'prior-evidence',
    status:'published',revision:item.revision,schemaVersion:1,verifiedAt:'2026-09-01T00:00:00Z'};
  return [name,doc(name,data)];
}));}
function change(documents,id,patch){const key=`${root}/catalog/${id}`,previous=documents.get(key);documents.set(key,doc(key,{...decode(previous),...patch}));}

test('one-time review writes only three confirmed offers plus four immutable observations',()=>{
  const documents=fixture(),writes=buildRecheckWrites(documents,now);
  assert.equal(writes.length,13);
  const offers=writes.filter(w=>w.update.name.includes('/catalog/'));
  assert.deepEqual(offers.map(w=>decode(w.update).id),['cloudflare-workers','github-copilot','adobe-express']);
  for(const write of offers){
    const data=decode(write.update),previous=decode(documents.get(write.update.name));
    assert.equal(data.revision,previous.revision+1);
    assert.equal(data.identityKey.split('~').length,8);
    assert.equal(data.verifiedAt,undefined);
    assert.deepEqual(write.updateTransforms.map(t=>t.fieldPath),['verifiedAt','updatedAt']);
    assert.equal(write.currentDocument.updateTime,documents.get(write.update.name).updateTime);
  }
  const canva=writes.filter(w=>w.update.name.endsWith('/recheck-20261024-canva-pro'));
  assert.equal(canva.length,1);
  assert.equal(decode(canva[0].update).status,'pending_review');
  assert.match(JSON.parse(decode(canva[0].update).payloadJson).evidence[0],/not confirmed/);
  assert(!writes.some(w=>w.update.name.includes('/users/')));
  assert(writes.every(w=>documentPaths().includes(w.update.name)));
  assert(writes.filter(w=>!w.update.name.includes('/catalog/')).every(w=>w.currentDocument.exists===false));
  assert(writes.filter(w=>w.update.name.includes('/candidateReviews/')).every(w=>decode(w.update).notes.length<=1000));
});

test('expired evidence, replay, changed records and conflicting reservations fail closed',()=>{
  assert.throws(()=>buildRecheckWrites(fixture(),new Date('2026-10-25')),/expired/);
  assert.throws(()=>buildRecheckWrites(fixture(),new Date('2026-10-23')),/expired/);
  assert.throws(()=>buildRecheckWrites(fixture(),new Date('invalid')),/expired/);
  for(const patch of [{revision:50},{status:'withdrawn'},{currency:'EUR'},{offerType:'trial'},{identityKey:'someone-else'}, {monthlyValue:10}, {expiresAt:'2026-10-30'}]){
    const documents=fixture();change(documents,'cloudflare-workers',patch);
    assert.throws(()=>buildRecheckWrites(documents,now));
  }
  for(const collection of ['candidates','candidateReviews']){
    const documents=fixture();documents.set(`${root}/${collection}/recheck-20261024-canva-pro`,{});
    assert.throws(()=>buildRecheckWrites(documents,now),/replay/);
  }
  const documents=fixture();documents.delete(`${root}/catalog/adobe-express`);
  assert.throws(()=>buildRecheckWrites(documents,now),/Missing existing/);
  const reserved=fixture(),key=documentPaths().find(path=>path.includes('/offerKeys/'));
  reserved.set(key,doc(key,{offerId:'different-offer'}));
  assert.throws(()=>buildRecheckWrites(reserved,now),/reserved/);
  reserved.set(key,doc(key,{offerId:'cloudflare-workers'}));
  assert.equal(buildRecheckWrites(reserved,now).length,12);
});
