import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogClient,CATALOG_DOCUMENT_LIMIT,CATALOG_PAYLOAD_LIMIT} from '../catalog-client.mjs';

test('catalog reads use a sentinel and reject truncated/oversized snapshots before publishing them',()=>{
  let deliver,limit;
  const sdk={collection:()=>({}),query:()=>({}),limit:value=>{limit=value;},onSnapshot(query,options,callback){deliver=callback;return ()=>{};}};
  const received=[],errors=[];
  createCatalogClient({},sdk,{}).watchCatalog(records=>received.push(records),error=>errors.push(error.message));
  assert.equal(limit,CATALOG_DOCUMENT_LIMIT+1);
  const send=(records,metadata={fromCache:false,hasPendingWrites:false})=>deliver({size:records.length,metadata,docs:records.map((data,index)=>({id:String(index),data:()=>data}))});
  send([{status:'withdrawn'}]);
  assert.equal(received[0][0].status,'withdrawn');
  send(Array.from({length:CATALOG_DOCUMENT_LIMIT+1},()=>({status:'withdrawn'})));
  send([{description:'x'.repeat(CATALOG_PAYLOAD_LIMIT)}]);
  assert.equal(received.length,1,'Neither over-capacity snapshot may replace a complete catalog');
  assert.equal(errors.length,2);
  send([],{fromCache:true,hasPendingWrites:false});
  send([],{fromCache:false,hasPendingWrites:true});
  assert.equal(received.length,1);
  send([]);
  assert.deepEqual(received[1],[],'A genuine empty server snapshot must still deliver');
});
