import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogClient} from '../catalog-client.mjs';

test('approved source reads are bounded, filtered and omit private review fields',async()=>{
  const reads=[],queries=[];
  const sdk={
    doc:(_db,collection,id)=>({collection,id}),collection:(_db,name)=>name,
    where:(...args)=>({where:args}),limit:value=>({limit:value}),startAfter:cursor=>({cursor}),
    query:(collection,...constraints)=>({collection,constraints}),
    async getDocsFromServer(query){queries.push(query);return {size:25,docs:[
      {id:'source-one',data:()=>({status:'approved',publishedId:'shared',notes:'private'})},
      {id:'source-two',data:()=>({status:'approved',publishedId:'shared',notes:'private'})},
      {id:'rejected',data:()=>({status:'rejected',publishedId:'shared'})},
      {id:'unrelated',data:()=>({status:'approved',publishedId:'other'})},
    ]};},
    async getDocFromServer(ref){reads.push(ref);return {exists:()=>true,data:()=>({payloadJson:JSON.stringify({
      sourceId:ref.id,title:'Original source',evidenceUrl:'https://example.com/'+ref.id,
      evidence:['x'.repeat(900),...Array(8).fill('excerpt')],notes:'not for output',aiDraft:{fields:{name:'not for output'}},
    })})};},
  };
  const client=createCatalogClient({},sdk,{currentUser:{uid:'admin'}});
  const result=await client.approvedSources('shared','prior-cursor');
  assert.deepEqual(queries[0],{collection:'candidateReviews',constraints:[{where:['publishedId','==','shared']},{limit:25},{cursor:'prior-cursor'}]});
  assert.deepEqual(reads.map(v=>v.id),['source-one','source-two']);
  assert.equal(result.more,true);
  assert.equal(result.items.length,2);
  for(const item of result.items){assert.equal(item.evidence.length,6);assert.equal(item.evidence[0].length,500);assert(!('notes' in item));assert(!('aiDraft' in item));}
  await assert.rejects(client.approvedSources('../../users'),/valid offer/);
  await assert.rejects(createCatalogClient({},sdk,{currentUser:null}).approvedSources('shared'),/Sign in/);
});

test('missing or malformed source evidence stays explicit and never invented',async()=>{
  const sdk={doc:(_db,_collection,id)=>id,collection:()=>'',where:()=>'',limit:()=>'',query:()=>'',
    getDocsFromServer:async()=>({size:3,docs:['missing','malformed','seed-hulu'].map(id=>({id,data:()=>({status:'approved',publishedId:'shared'})}))}),
    getDocFromServer:async id=>({exists:()=>id==='malformed',data:()=>({payloadJson:'not json'})}),
  };
  const result=await createCatalogClient({},sdk,{currentUser:{uid:'admin'}}).approvedSources('shared');
  assert.equal(result.more,false);assert.equal(result.items[0].missing,true);assert.equal(result.items[0].url,'');
  assert.deepEqual(result.items[1].evidence,[]);
  assert.equal(result.items[2].missing,false);assert.match(result.items[2].url,/hulu/);
});
