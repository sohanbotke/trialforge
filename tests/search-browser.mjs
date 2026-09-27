import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.TRYWISE_BASE_URL||'http://127.0.0.1:4177';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixtures only.');
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const unrelatedFree={id:'unrelated-free-fixture',name:'Unrelated reviewed hosting fixture',description:'A hosting platform.',category:'cloudinfra',url:'https://example.test/',offerType:'free_tier',trialDays:0,reviewDays:30,monthlyValue:0,upfrontCost:0,currency:'USD',priceDetails:'Fixture free base',eligibility:'Test accounts',region:'US',cancellation:'Provider settings',goal:'Host a project',status:'published',verifiedAt:new Date().toISOString(),expiresAt:null};
  await page.route('**/firebase-client.mjs',route=>route.fulfill({contentType:'text/javascript',body:`
    export const isFirebaseConfigured=()=>true;
    export async function createFirebaseClient(){return {catalog:{watchCatalog(ready){ready([${JSON.stringify(unrelatedFree)}]);}},onAuth(callback){callback(null);}};}
  `}));
  await page.goto(base);await page.locator('#trialFeed article').first().waitFor();
  const total=await page.locator('#trialFeed article').count();
  for(const [index,query] of ['love','dating apps','relationship services','find me something for zzzunknown'].entries()) {
    if(index)await page.locator('#plannerToggle').click();
    await page.locator('#requirementText').fill(query);
    await page.locator('#requirementForm button[type="submit"]').click();
    assert.equal(await page.locator('#requirementPlan .timeline-item').count(),0);
    assert.equal(await page.locator('#trialFeed article').count(),0,'Main request must filter the feed, not merely reorder all offers');
    if(query!=='find me something for zzzunknown') {
      assert.match(await page.locator('#trialFeed').textContent(),/dating or relationship services/);
      assert.match(await page.locator('#resultsCount').textContent(),/Dating & relationships/);
    }
    await page.locator('[data-browse-all]').click();
    assert.equal(await page.locator('#trialFeed article').count(),total);
  }
  await page.locator('#catalogFilters summary').click();
  for(const query of ['love','dating','relationships']) {
    await page.locator('#searchInput').fill(query);
    assert.equal(await page.locator('#trialFeed article').count(),0);
    assert.match(await page.locator('#trialFeed').textContent(),/dating or relationship services/);
  }
  if(process.env.TRYWISE_SCREENSHOT_DIR) {
    await page.locator('#trialFeed').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/dating-search-mobile.png`});
  }
  await page.locator('#clearFiltersBtn').click();
  await page.locator('#searchInput').fill('Audible');
  assert.equal(await page.locator('#trialFeed article').count(),1);
  assert.match(await page.locator('#trialFeed article').textContent(),/Audible/);
  await page.locator('#clearFiltersBtn').click();
  await page.locator('#plannerToggle').click();
  await page.locator('#requirementText').fill('live sports');
  await page.locator('#requirementForm button[type="submit"]').click();
  assert.match(await page.locator('#trialFeed').textContent(),/YouTube TV/);
  assert.equal(await page.locator('[data-add-catalog="hellofresh"]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Search checks passed: love/dating intent in both inputs, no unrelated fallback, browse-all recovery, unknown queries, provider lookup and live-sports relevance.');
}finally{await browser.close();}
