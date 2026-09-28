import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.TRYWISE_BASE_URL||'http://127.0.0.1:4177';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixtures only.');
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const unrelatedFree={id:'unrelated-free-fixture',name:'Unrelated reviewed hosting fixture',description:'A hosting platform.',category:'cloudinfra',url:'https://example.test/',offerType:'free_tier',trialDays:0,reviewDays:30,monthlyValue:0,upfrontCost:0,currency:'USD',priceDetails:'Fixture free base',eligibility:'Test accounts',region:'US',cancellation:'Provider settings',goal:'Host a project',status:'published',verifiedAt:new Date().toISOString(),expiresAt:null};
  await page.route('**/firebase-client.mjs',route=>route.fulfill({contentType:'text/javascript',body:`
    export const isFirebaseConfigured=()=>true;
    export async function createFirebaseClient(){return {catalog:{watchCatalog(ready){ready([${JSON.stringify(unrelatedFree)}]);}},onAuth(callback){callback(null);}};}
  `}));
  await page.goto(base);await page.locator('#trialFeed article').first().waitFor();
  const total=await page.locator('#trialFeed article').count();
  const cases=[
    {query:'hulu',top:'Hulu'},
    {query:'hul',top:'Hulu'},
    {query:'instcart',top:'Instacart+'},
    {query:'netflx',empty:/Did you mean Netflix/},
    {query:'I love cooking',top:'HelloFresh',notDating:true},
    {query:'tennis singles',empty:/No relevant catalog matches/,notDating:true},
    {query:'dating',empty:/dating or relationship services/,dating:true},
    {query:'tinder',empty:/dating or relationship services/,dating:true},
    {query:'love',empty:/dating or relationship services/,notDating:true},
    {query:'free trial',nonzero:true},
    {query:'music streaming free trial',nonzero:true,note:/No music service is in the current catalog/},
    {query:'find me something for zzzunknown',empty:/No relevant catalog matches/}
  ];
  async function check(test, summary) {
    const cards=await page.locator('#trialFeed article .card-title').allTextContents();
    if(test.top) assert.equal(cards[0],test.top,test.query);
    if(test.empty) {assert.equal(cards.length,0,test.query);assert.match(await page.locator('#trialFeed').textContent(),test.empty);}
    if(test.nonzero) assert(cards.length>0,test.query);
    if(test.dating) assert.match(await page.locator('#resultsCount').textContent(),/Dating & relationships/);
    if(test.notDating) assert.doesNotMatch(await page.locator('#resultsCount').textContent(),/Dating & relationships/);
    if(test.note) assert.match(await page.locator('[data-coverage-note]').textContent(),test.note);
    if(summary) assert.deepEqual(await page.locator('#requirementPlan .timeline-item strong').allTextContents(),cards,'Summary and displayed cards must match exactly');
    if(cards.length) assert.doesNotMatch(await page.locator('#trialFeed').textContent(),/No matching options/);
  }
  for(const test of cases) {
    if(await page.locator('.hero-panel').evaluate(el=>el.classList.contains('collapsed'))) await page.locator('#plannerToggle').click();
    await page.locator('#requirementText').fill(test.query);
    await page.locator('#requirementForm button[type="submit"]').click();
    await check(test,true);
    if(test.note && process.env.TRYWISE_SCREENSHOT_DIR) {
      for(const width of [390,1440]) {
        await page.setViewportSize({width,height:900});
        await page.locator('#requirementPlan').scrollIntoViewIfNeeded();
        await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/search-consistency-${width}.png`});
      }
    }
    await page.locator('#clearFiltersBtn').click();
    assert.equal(await page.locator('#requirementPlan').textContent(),'','Clearing filters must clear the summary');
    assert.equal(await page.locator('#trialFeed article').count(),total);
  }
  await page.locator('#catalogFilters summary').click();
  for(const test of cases) {
    await page.locator('#searchInput').fill(test.query);
    await check(test,false);
  }
  await page.locator('#clearFiltersBtn').click();
  await page.setViewportSize({width:390,height:844});
  await page.locator('#sidebarToggle').click();
  await page.locator('[data-interest="cloudinfra"]').click();
  await page.locator('#sidebarToggle').click();
  await page.locator('#searchInput').fill('hulu');
  assert.equal(await page.locator('#trialFeed article .card-title').first().textContent(),'Hulu');
  await page.locator('#clearFiltersBtn').click();
  for(const query of ['xyzabc123','meal delivery']) {
    if(await page.locator('.hero-panel').evaluate(el=>el.classList.contains('collapsed'))) await page.locator('#plannerToggle').click();
    await page.locator('#requirementText').fill(query);
    await page.locator('#requirementForm button[type="submit"]').click();
    await page.locator('[data-dismiss-requirement]').click();
    assert.equal(await page.locator('#trialFeed article').count(),total);
    assert.equal(await page.locator('#requirementPlan').textContent(),'');
    assert.equal(await page.locator('#requirementText').inputValue(),query);
    assert(await page.locator('#requirementText').evaluate(el=>el===document.activeElement));
    assert(await page.locator('#requirementText').isVisible());
  }
  assert.deepEqual(errors,[]);
  console.log('Search checks passed: provider spelling, contextual intent, generic offers, coverage gaps, one result/summary pipeline, interest boosts, clear/dismiss recovery.');
} finally {await browser.close();}
