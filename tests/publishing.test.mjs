import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { createCatalogClient } from '../catalog-client.mjs';
import { validateOffer, mergedCatalog } from '../catalog-model.mjs';
import { identityKey } from '../offer-identity.mjs';

const valid = { id:'test-offer',identity:{provider:'example',product:'test',plan:'standard',region:'us',scope:'general'},name:'Test offer',description:'An emulator-only offer',category:'devtools',url:'https://example.com/trial',offerType:'trial',trialDays:14,reviewDays:14,monthlyValue:10,upfrontCost:0,currency:'USD',priceDetails:'$10 billed monthly after trial',eligibility:'New users',region:'United States',cancellation:'Cancel before renewal in account settings',goal:'Try one project',expiresAt:null };
test('published offer validation and tombstones',()=>{
  validateOffer(valid);
  assert.throws(()=>validateOffer({...valid,url:'javascript:alert(1)'}));
  assert.throws(()=>validateOffer({...valid,offerType:'free_tier',trialDays:30}));
  assert.throws(()=>validateOffer({...valid,currency:'EUR'}));
  const seeds=[{id:'test-offer',name:'Old seed'}];
  const records=[{...valid,status:'published',revision:1}];
  assert.equal(mergedCatalog(seeds,records)[0].name,'Test offer');
  assert.equal(mergedCatalog(seeds,[{id:'test-offer',status:'withdrawn'}]).length,0);
  assert.equal(mergedCatalog(seeds,[{...records[0],expiresAt:'2000-01-01'}]).length,0);
});

test('admin publishing, atomicity, conflicts, collector isolation, and private review rules',async()=>{
  sdk.setLogLevel('silent');
  const env=await initializeTestEnvironment({projectId:'demo-trywise',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
  const ownerClaims={email:'sohan2405@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
  const admin=env.authenticatedContext('admin-owner',ownerClaims).firestore();
  const guest=env.unauthenticatedContext().firestore();
  const tester=env.authenticatedContext('tester',{...ownerClaims,email:'tester@example.com',admin:true}).firestore();
  const collector=env.authenticatedContext('trywise-nightly-collector',{collector:true,firebase:{sign_in_provider:'custom'}}).firestore();
  const client=createCatalogClient(admin,sdk,{currentUser:{uid:'admin-owner'}});
  const offerRef=db=>sdk.doc(db,'catalog',valid.id);
  let denied=0;
  const deny=async promise=>{await assertFails(promise);denied++;};
  try{
    await env.clearFirestore();
    assert.equal(await client.checkAdmin(),true);
    for(const db of [guest,tester,env.authenticatedContext('unverified',{...ownerClaims,email_verified:false}).firestore(),env.authenticatedContext('password',{...ownerClaims,firebase:{sign_in_provider:'password'}}).firestore(),env.authenticatedContext('custom',{...ownerClaims,firebase:{sign_in_provider:'custom'}}).firestore()]){
      await deny(sdk.getDoc(sdk.doc(db,'adminAccess','status')));
      await deny(sdk.getDocs(sdk.collection(db,'candidates')));
      await deny(sdk.getDocs(sdk.collection(db,'candidateReviews')));
      await deny(sdk.setDoc(offerRef(db),valid));
    }
    await client.decide({candidateId:'test-candidate',offer:valid,decision:'approved'});
    const published=(await sdk.getDoc(offerRef(guest))).data();
    const keyRef=db=>sdk.doc(db,'offerKeys',identityKey(valid));
    assert.equal((await sdk.getDoc(keyRef(admin))).data().offerId,valid.id);
    for(const db of [guest,tester,collector]){
      await deny(sdk.getDoc(keyRef(db)));
      await deny(sdk.setDoc(keyRef(db),{offerId:'stolen',schemaVersion:1,createdAt:sdk.serverTimestamp()}));
    }
    await deny(sdk.updateDoc(keyRef(admin),{offerId:'stolen'}));
    await deny(sdk.deleteDoc(keyRef(admin)));
    await deny(sdk.setDoc(sdk.doc(admin,'offerKeys','v1~orphan'),{offerId:'missing',schemaVersion:1,createdAt:sdk.serverTimestamp()}));
    await assert.rejects(client.decide({candidateId:'duplicate',offer:{...valid,id:'duplicate'},decision:'approved',distinctVariant:true}),/Duplicate identity/);
    assert.equal(published.name,valid.name);
    assert(!('reviewedBy' in published));
    await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(guest,'catalog'),sdk.limit(500))));
    await assert.rejects(client.decide({candidateId:'test-candidate',offer:valid,decision:'approved'}),/changed/);
    await client.decide({candidateId:'test-candidate',offer:{...valid,monthlyValue:12},decision:'approved',expectedReview:1,expectedCatalog:1});
    assert.equal((await sdk.getDoc(offerRef(guest))).data().monthlyValue,12);
    await client.withdraw(valid.id,2);
    assert.equal((await sdk.getDoc(offerRef(guest))).data().status,'withdrawn');
    assert.equal((await sdk.getDoc(keyRef(admin))).data().offerId,valid.id);
    await assert.rejects(client.decide({candidateId:'duplicate',offer:{...valid,id:'duplicate'},decision:'approved',distinctVariant:true}),/reserved offer ID/);
    await assert.rejects(client.decide({candidateId:'reuse-withdrawn',offer:{...valid,identity:{...valid.identity,plan:'other'}},decision:'approved',expectedCatalog:3,distinctVariant:true}),/different identity/);
    await deny(sdk.setDoc(offerRef(admin),{id:valid.id,schemaVersion:1,status:'withdrawn',revision:4,updatedAt:sdk.serverTimestamp()}));
    await client.decide({candidateId:'test-candidate',offer:valid,decision:'approved',expectedReview:2,expectedCatalog:3});
    await client.decide({candidateId:'reject-candidate',decision:'rejected',notes:'No verified offer'});
    assert.equal((await client.review('reject-candidate')).status,'rejected');
    const baseline=(await sdk.getDoc(offerRef(admin))).data();
    async function pairedAttempt(id,patch={},includeKey=true){
      const data={...baseline,id,identity:{...valid.identity,product:id},revision:1,sourceCandidate:id,verifiedAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()};
      const key=identityKey(data);data.identityKey=key;Object.assign(data,patch);
      const batch=sdk.writeBatch(admin);
      batch.set(sdk.doc(admin,'catalog',id),data);
      batch.set(sdk.doc(admin,'candidateReviews',id),{candidateId:id,status:'approved',publishedId:id,notes:'',reviewedBy:'admin-owner',reviewedAt:sdk.serverTimestamp(),revision:1,schemaVersion:1});
      if(includeKey)batch.set(sdk.doc(admin,'offerKeys',key),{offerId:id,schemaVersion:1,createdAt:sdk.serverTimestamp()});
      return batch.commit();
    }
    await deny(pairedAttempt('missing-key',{},false));
    await deny(pairedAttempt('forged-key',{identityKey:'forged'}));
    await deny(pairedAttempt('extra-identity',{identity:{...valid.identity,product:'extra-identity',extra:'bad'}}));
    await deny(pairedAttempt('invalid-identity',{identity:{...valid.identity,product:'invalid-identity',region:'US'}}));
    await deny(pairedAttempt('oversized-identity',{identity:{...valid.identity,product:'x'.repeat(41)}}));
    await deny(pairedAttempt(valid.id,{identity:{...valid.identity,product:valid.id},revision:5}));
    await assertSucceeds(pairedAttempt('valid-paired'));
    for(const patch of [{name:'x'.repeat(121)},{monthlyValue:-1},{trialDays:1.5},{currency:'EUR'},{offerType:'unknown'},{extra:'field'},{category:'other'},{url:'https://example.com/" onclick="evil'},{verifiedAt:sdk.Timestamp.fromMillis(0)},{expiresAt:sdk.Timestamp.fromMillis(0)},{identityKey:'forged'},{identity:{...valid.identity,provider:'x'.repeat(41)}},{identity:{...valid.identity,extra:'bad'}},{identity:{...valid.identity,region:'US'}}]){
      await deny(sdk.setDoc(offerRef(admin),{...baseline,...patch,revision:5,updatedAt:sdk.serverTimestamp()}));
    }
    await deny(sdk.setDoc(sdk.doc(admin,'catalog','unpaired'),{...baseline,id:'unpaired',revision:1,verifiedAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()}));
    await deny(sdk.deleteDoc(offerRef(admin)));
    const envelope={id:'collector-test',schemaVersion:1,status:'pending_review',observedAt:new Date().toISOString(),payloadJson:'{"title":"candidate"}'};
    await assertSucceeds(sdk.setDoc(sdk.doc(collector,'candidates','collector-test'),envelope));
    await deny(sdk.updateDoc(sdk.doc(collector,'candidates','collector-test'),{status:'approved'}));
    await deny(sdk.setDoc(sdk.doc(collector,'catalog','collector-attack'),{id:'collector-attack',schemaVersion:1,status:'withdrawn',revision:1,updatedAt:sdk.serverTimestamp()}));
    await deny(sdk.setDoc(sdk.doc(collector,'candidateReviews','collector-test'),{status:'approved'}));
    await deny(sdk.getDoc(sdk.doc(collector,'users','admin-owner','plans','default')));
    await deny(sdk.setDoc(sdk.doc(tester,'candidates','fake'),{...envelope,id:'fake'}));
    await deny(sdk.setDoc(sdk.doc(tester,'adminAccess','status'),{admin:true}));
    const variant={...valid,id:'test-canada',identity:{...valid.identity,region:'ca'},region:'Canada'};
    await assert.rejects(client.decide({candidateId:'canada',offer:variant,decision:'approved'}),/Possible duplicate/);
    await client.decide({candidateId:'canada',offer:variant,decision:'approved',distinctVariant:true});
    await assert.rejects(client.decide({candidateId:'changed-identity',offer:{...valid,identity:variant.identity},decision:'approved',expectedCatalog:4,distinctVariant:true}),/Duplicate identity|different identity/);
    const race={...valid,name:'Race offer',url:'https://example.com/race',identity:{...valid.identity,product:'race'}};
    const results=await Promise.allSettled(['race-one','race-two'].map(id=>client.decide({candidateId:id,offer:{...race,id},decision:'approved',distinctVariant:true})));
    assert.equal(results.filter(v=>v.status==='fulfilled').length,1,'Concurrent same-identity publication must have one winner');
    const legacy={...valid,id:'legacy',name:'Legacy offer',url:'https://example.com/legacy',identity:{...valid.identity,product:'legacy'}};
    await env.withSecurityRulesDisabled(async ctx=>{
      const data={...baseline,id:'legacy',revision:1};delete data.identity;delete data.identityKey;
      await sdk.setDoc(sdk.doc(ctx.firestore(),'catalog','legacy'),data);
    });
    assert.equal((await sdk.getDoc(sdk.doc(guest,'catalog','legacy'))).data().identity,undefined);
    await client.decide({candidateId:'legacy-upgrade',offer:legacy,decision:'approved',expectedCatalog:1,distinctVariant:true});
    assert.equal((await sdk.getDoc(sdk.doc(admin,'catalog','legacy'))).data().identityKey,identityKey(legacy));
    console.log(`Publishing security checks passed; ${denied} forbidden operations denied.`);
  }finally{await env.cleanup();}
});
