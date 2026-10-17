import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublicCatalog,startPublicCatalog,primePublicCatalog} from '../public-catalog.mjs';
import {mergedCatalog} from '../catalog-model.mjs';
const project='test-project';
const doc=(id,fields={})=>({name:`projects/${project}/databases/(default)/documents/catalog/${id}`,fields});
const response=body=>new Response(JSON.stringify(body));
test('bootstrap is bounded, public, anonymous, uncached and preserves tombstones/types',async()=>{
  let call;
  const records=await readPublicCatalog(project,{fetcher:async(url,options)=>{
    call={url,options};return response({documents:[doc('withdrawn',{status:{stringValue:'withdrawn'}}),doc('types',{
      id:{stringValue:'not-the-document-id'},verifiedAt:{timestampValue:'2026-10-17T00:00:00Z'},
      monthlyValue:{doubleValue:12.5},revision:{integerValue:'2'},expiresAt:{nullValue:null},
      identity:{mapValue:{fields:{plan:{stringValue:'Plus'}}}},tags:{arrayValue:{values:[{stringValue:'one'},{booleanValue:true}]}}
    })]});
  }});
  assert.match(call.url,/\/documents\/catalog\?pageSize=501$/);
  assert.deepEqual(call.options,{signal:undefined,credentials:'omit',cache:'no-store',redirect:'error'});
  assert.equal(records[1].id,'types');assert.equal(records[1].monthlyValue,12.5);
  assert.equal(records[1].revision,2);assert.equal(records[1].expiresAt,null);
  assert.equal(records[1].verifiedAt,'2026-10-17T00:00:00Z');
  assert.deepEqual(records[1].identity,{plan:'Plus'});assert.deepEqual(records[1].tags,['one',true]);
  assert.deepEqual(mergedCatalog([{id:'withdrawn'}],records),[],'A withdrawal must suppress seed fallback');
});
test('never expose partial, duplicated, oversized or malformed snapshots',async()=>{
  for (const body of [[],null,{documents:'bad'},{nextPageToken:'more',documents:[doc('a')]},
    {documents:Array.from({length:501},(_,i)=>doc(`id-${i}`))}, {documents:[doc('a'),doc('a')]},
    {documents:[{name:'projects/another/databases/(default)/documents/catalog/a'}]},
    {documents:[doc('bad/id')]},{documents:[doc('a',{value:{integerValue:'9007199254740992'}})]},
    {documents:[doc('a',{value:{referenceValue:'private/doc'}})]}]) {
    await assert.rejects(readPublicCatalog(project,{fetcher:async()=>response(body)}));
  }
  await assert.rejects(readPublicCatalog(project,{fetcher:async()=>new Response('x',{status:403})}));
  await assert.rejects(readPublicCatalog(project,{fetcher:async()=>new Response('not JSON')}));
  let canceled=false;
  await assert.rejects(readPublicCatalog(project,{fetcher:async()=>new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(1024*1024+1));},cancel(){canceled=true;}
  }))}),/payload/);
  assert(canceled,'Oversized streams must be canceled, not buffered unboundedly');
  await assert.rejects(readPublicCatalog('../wrong',{fetcher:()=>{throw Error('Must not fetch');}}),/project/);
  assert.deepEqual(await readPublicCatalog(project,{fetcher:async()=>response({})}),[]);
});
test('live SDK snapshot/error wins over a late startup read, even if fetch ignores abort',async()=>{
  let resolve,called=false;
  const bootstrap=startPublicCatalog(project,()=>{called=true;},{fetcher:()=>new Promise(r=>resolve=r)});
  bootstrap.stop();resolve(response({documents:[doc('late')]}));await bootstrap.done;
  assert.equal(called,false);
  let shown;
  const fast=startPublicCatalog(project,records=>{shown=records;},{fetcher:async()=>response({documents:[doc('first')]})});
  await fast.done;assert.equal(shown[0].id,'first');fast.stop();
});
test('read failures and timeouts quietly fall back to the live SDK without empty success',async()=>{
  let called=false;
  await startPublicCatalog(undefined,()=>{called=true;}).done;
  assert.equal(called,false);
  const failed=startPublicCatalog(project,()=>{called=true;},{fetcher:async()=>new Response('',{status:503})});
  await failed.done;assert.equal(called,false);
  let aborted=false;
  const slow=startPublicCatalog(project,()=>{called=true;},{timeout:1,fetcher:async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(Error('Aborted'));},{once:true});
  })});
  await slow.done;assert(aborted);assert.equal(called,false);
});
test('early bootstrap is consumed once and retries request a new snapshot',async()=>{
  let calls=0,shown;
  const fetcher=async()=>{calls++;return response({documents:[doc(`call-${calls}`)]});};
  primePublicCatalog(project,{fetcher});
  primePublicCatalog(project,{fetcher});
  const first=startPublicCatalog(project,records=>{shown=records;},{fetcher});
  await first.done;assert.equal(calls,1);assert.equal(shown[0].id,'call-1');first.stop();
  const retry=startPublicCatalog(project,records=>{shown=records;},{fetcher});
  await retry.done;assert.equal(calls,2);assert.equal(shown[0].id,'call-2');retry.stop();
});
