import test from 'node:test';
import assert from 'node:assert/strict';
import {identityKey,decodeIdentityKey,validateIdentity,normalizedOfferUrl,duplicateMatches,groupCandidates} from '../offer-identity.mjs';
import {starterAudit} from '../starter-audit.mjs';
import {seedCatalog} from '../seed-catalog.mjs';
const offer={id:'one',name:'Example',url:'https://example.com/pricing',offerType:'trial',currency:'USD',identity:{provider:'example',product:'app',plan:'pro',region:'us',scope:'general'}};
test('identity requires explicit bounded fields and separates commercial variants',()=>{
  assert.equal(identityKey(offer),'v1~example~app~pro~trial~us~general~usd');
  for(const field of ['provider','product','plan','region','scope']){
    assert.notEqual(identityKey({...offer,identity:{...offer.identity,[field]:'different'}}),identityKey(offer));
    assert.throws(()=>validateIdentity({...offer.identity,[field]:''}));
  }
  assert.notEqual(identityKey({...offer,offerType:'free_tier'}),identityKey(offer));
  assert.throws(()=>validateIdentity({...offer.identity,extra:'field'}));
  assert.throws(()=>validateIdentity({...offer.identity,plan:'Pro'}));
  assert.throws(()=>validateIdentity({...offer.identity,plan:'x'.repeat(41)}));
});
test('URL matching strips tracking only, preserving meaningful offer distinctions',()=>{
  assert.equal(normalizedOfferUrl('https://EXAMPLE.com/pricing/?utm_source=email&fbclid=x'),offer.url);
  for(const suffix of ['?plan=pro','?promo=fall','?currency=USD','?region=us','?ref=member','#student','?max_price=0','?language=en_US'])assert.notEqual(normalizedOfferUrl(offer.url+suffix),offer.url);
  assert.equal(normalizedOfferUrl('javascript:alert(1)'),'');
  assert.equal(normalizedOfferUrl('https://user:pass@example.com'),'');
});
test('canonical duplicates are exact; shared sources and variant names are advisory',()=>{
  assert.equal(duplicateMatches(offer,[{...offer,id:'two',url:'https://elsewhere.example',name:'Renamed'}])[0].match,'exact');
  const variant={...offer,id:'two',identity:{...offer.identity,region:'ca'}};
  assert.equal(duplicateMatches(offer,[variant])[0].match,'possible');
  assert.deepEqual(duplicateMatches(offer,[offer]),[]);
});
const row=(id,date,extra={},review=null)=>({item:{candidateId:id,title:'Copilot',sourceId:'github-copilot-plans',observedAt:date,...extra},review});
const earlier='2026-09-08T00:00:00Z',later='2026-09-09T00:00:00Z';
test('withdrawal identity keys reconstruct validated identity and type',()=>{
  const restored=decodeIdentityKey(identityKey(offer));assert.deepEqual(restored.identity,offer.identity);assert.equal(restored.offerType,offer.offerType);
  for(const invalid of ['v2~example~app~pro~trial~us~general~usd','v1~example~app~pro~unknown~us~general~usd','v1~example~app~pro~trial~us~general~usd~extra'])assert.throws(()=>decodeIdentityKey(invalid));
});
test('queue collapses raw/draft lineage and suppresses already-reviewed evidence',()=>{
  const rows=[row('raw',earlier),row('draft',earlier,{draftParentId:'raw',aiDraft:{fields:{}}},{status:'approved',publishedId:'github-copilot'})];
  const [group]=groupCandidates(rows);
  assert.equal(group.pending,0);assert.equal(group.current.item.candidateId,'draft');assert.equal(group.history.length,1);
  const [next]=groupCandidates([...rows,row('new-raw',later),row('new-draft',later,{draftParentId:'new-raw',aiDraft:{fields:{}}})]);
  assert.equal(next.current.item.candidateId,'new-draft');assert.equal(next.history.length,3);
});
test('queue keeps different plans separate and regrouping loaded pages is deterministic',()=>{
  const draft=name=>({sourceId:'unknown-source',aiDraft:{fields:{offerType:{value:'trial'},name:{value:name}}}});
  const rows=[row('a',later,draft('Pro')),row('b',later,draft('Student')),row('old',earlier,draft('Pro'))];
  const groups=groupCandidates(rows);
  assert.equal(groups.length,2);assert.equal(groups.find(v=>v.current.item.candidateId==='a').history.length,1);
  assert.deepEqual(groupCandidates([...rows].reverse()),groups);
});
test('all 35 starters have explicit audit notes without granting new approvals',()=>{
  assert.equal(seedCatalog.length,35);
  assert.deepEqual(Object.keys(starterAudit).sort(),seedCatalog.map(v=>v.id).sort());
  for(const entry of Object.values(starterAudit)){
    assert.equal(entry.approval,'not_granted_by_audit');assert.match(entry.url,/^https:\/\//);assert(entry.summary.length>20);
  }
});
test('a reviewed known-source plan never hides a distinct or same-time pending variant',()=>{
  const draft=name=>({aiDraft:{fields:{name:{value:name},offerType:{value:'free_tier'}}}});
  for(const observed of [earlier,later]){
    const groups=groupCandidates([row('free',later,draft('GitHub Copilot Free'),{status:'approved',publishedId:'github-copilot'}),row('student',observed,draft('GitHub Copilot Student'))]);
    assert.equal(groups.length,2);
    assert.equal(groups.find(v=>v.current.item.candidateId==='student').pending,1);
  }
});
test('same-name observations remain pending unless their explicit family was reviewed',()=>{
  const groups=groupCandidates([row('old-unreviewed',earlier),row('new-reviewed',later,{}, {status:'approved',publishedId:'github-copilot'})]);
  assert.equal(groups[0].pending,1);assert.equal(groups[0].current.item.candidateId,'old-unreviewed');
});
test('page-boundary raw/draft families regroup deterministically after older pages load',()=>{
  const rows=[row('raw',earlier),row('draft-a',later,{draftParentId:'raw',aiDraft:{fields:{name:{value:'Free'}}}}),row('draft-b',later,{draftParentId:'raw',aiDraft:{fields:{name:{value:'Different wording'}}}},{status:'rejected'})];
  const combined=groupCandidates(rows);assert.equal(combined.length,1);assert.equal(combined[0].pending,0);
  assert.deepEqual(groupCandidates([...rows].reverse()),combined);
});
