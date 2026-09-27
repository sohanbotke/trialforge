import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicCatalog, recheckReport } from '../scripts/catalog-recheck.mjs';
const doc=id=>({name:`projects/test/databases/(default)/documents/catalog/${id}`,fields:{status:{stringValue:'published'},name:{stringValue:id},verifiedAt:{timestampValue:'2026-09-01T00:00:00Z'},privateNotes:{stringValue:'DO NOT INCLUDE'}}});
test('scheduled report paginates public reads and allowlists fields',async()=>{
  const calls=[];
  const records=await loadPublicCatalog(async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>calls.length===1?{documents:[doc('first')],nextPageToken:'next'}:{documents:[doc('second')]}};});
  assert.equal(calls.length,2);assert.match(calls[1].url,/pageToken=next/);
  assert(calls.every(call=>!call.options.method&&!call.options.headers));
  const report=recheckReport(records,Date.parse('2026-09-27T00:00:00Z'));
  assert.equal(report.due.length,2);assert.doesNotMatch(JSON.stringify(report),/privateNotes|DO NOT INCLUDE/);
});
test('read failures and truncated pagination cannot look like an empty healthy catalog',async()=>{
  await assert.rejects(loadPublicCatalog(async()=>({ok:false,status:403})),/failed/);
  await assert.rejects(loadPublicCatalog(async()=>({ok:true,json:async()=>({documents:'bad'})})),/Malformed/);
  await assert.rejects(loadPublicCatalog(async()=>({ok:true,json:async()=>({documents:[],nextPageToken:'loop'})})),/pagination/);
});
