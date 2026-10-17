import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.TRYWISE_BASE_URL||'http://127.0.0.1:4177';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixtures only.');
const record={id:'startup-fixture',name:'Startup fixture',description:'Test only.',category:'shows',url:'https://example.test/',
  offerType:'free_tier',trialDays:0,reviewDays:7,monthlyValue:0,upfrontCost:0,currency:'USD',priceDetails:'Fixture limits.',
  eligibility:'Fixture accounts',region:'US',cancellation:'Provider settings',goal:'Test',status:'published',revision:1,
  verifiedAt:new Date().toISOString(),expiresAt:null};
const records=[record,{id:'vercel-hobby',status:'withdrawn'}];
const fields=item=>Object.fromEntries(Object.entries(item).filter(([key])=>key!=='id').map(([key,value])=>[key,
  value===null?{nullValue:null}:typeof value==='number'?{integerValue:String(value)}:key==='verifiedAt'?{timestampValue:value}:{stringValue:value}]));
const body=JSON.stringify({documents:records.map(item=>({name:`projects/trywise-9f8e1/databases/(default)/documents/catalog/${item.id}`,fields:fields(item)}))});
const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let reads=0;
  await page.route('https://firestore.googleapis.com/v1/**',route=>{reads++;return route.fulfill({contentType:'application/json',body});});
  await page.route('**/firebase-client.mjs',route=>route.fulfill({contentType:'text/javascript',body:`
    export const isFirebaseConfigured=()=>true;
    export async function createFirebaseClient(){return {
      catalog:{watchCatalog(ready,failed){window.liveCatalog=ready;window.failCatalog=failed;}},onAuth(callback){callback(null);}
    };}
  `}));
  await page.goto(base);
  await page.locator('[data-offer-id="startup-fixture"]').waitFor();
  assert.equal(reads,1);
  assert.match(await page.locator('#catalogStatus').textContent(),/Connecting for live updates/);
  assert.equal(await page.locator('[data-offer-id="vercel-hobby"]').count(),0,'Startup tombstone must suppress the seed');
  const card=page.locator('[data-offer-id="startup-fixture"]');
  await card.locator('summary').click();
  await page.evaluate(()=>{window.startupCard=document.querySelector('[data-offer-id="startup-fixture"]');});
  await page.evaluate(records=>window.liveCatalog(records),records);
  assert.match(await page.locator('#catalogStatus').textContent(),/Live catalog updates/);
  assert(await page.evaluate(()=>window.startupCard===document.querySelector('[data-offer-id="startup-fixture"]')),'Identical listener snapshot must preserve nodes');
  assert(await card.locator('details').evaluate(el=>el.open),'Repeated snapshots must not collapse evidence');
  await page.evaluate(()=>window.liveCatalog([{id:'startup-fixture',status:'withdrawn'},{id:'vercel-hobby',status:'withdrawn'}]));
  assert.equal(await card.count(),0,'New listener withdrawal must replace the startup snapshot');
  const beforeEmulator=reads;
  await page.goto(`${base}/?emulator=1`);
  await page.waitForFunction(()=>window.liveCatalog && window.__tryWiseSmoke && !document.querySelector('main').inert);
  await page.evaluate(()=>window.liveCatalog([]));
  await page.locator('#trialFeed article').first().waitFor();
  assert.equal(reads,beforeEmulator,'Local emulator mode must never bootstrap from production');
  assert.deepEqual(errors,[]);
  console.log('Public startup browser passed: early bounded snapshot, truthful connection status, tombstones, stable evidence DOM, listener takeover and no production read in emulator mode.');
}finally{await browser.close();}
