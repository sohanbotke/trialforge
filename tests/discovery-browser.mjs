import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local fixtures only.');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  await page.route('https://firestore.googleapis.com/v1/**', route=>route.abort());
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/firebase-client.mjs', route => route.fulfill({contentType:'text/javascript',body:`
    export const isFirebaseConfigured=()=>true;
    export async function createFirebaseClient(){return {
      catalog:{watchCatalog(ready,failed){window.deliverCatalog=ready;window.failCatalog=failed;},async checkAdmin(){return false;}},
      onAuth(callback){window.fixtureSignIn=()=>callback({uid:'fixture-only',email:'fixture@example.test'});callback(null);},
      async load(){return null;}, subscribe(){return ()=>{};}, async commit(uid,revision){return revision+1;}
    };}
  `}));
  await page.goto(base);
  await page.waitForFunction(()=>window.deliverCatalog && window.__tryWiseSmoke && !document.querySelector('main').inert);
  const search=page.locator('#requirementText');
  assert.equal(await page.locator('#discoverView input[type="search"]').count(),1);
  assert.equal(await page.locator('#searchInput, #plannerToggle').count(),0);
  assert.match(await page.locator('#resultsCount').textContent(),/Loading/);
  await search.fill('hulu');
  await page.evaluate(()=>window.failCatalog());
  assert(await page.locator('[data-reload-catalog]').isVisible());
  assert(await search.isVisible());
  await page.evaluate(()=>window.deliverCatalog([]));
  assert.equal(await page.locator('#trialFeed article .card-title').first().textContent(),'Hulu');
  await page.locator('#clearFiltersBtn').click();
  const title=await page.locator('#trialFeed article .card-title').first().boundingBox();
  assert(title.y>=0 && title.y+title.height<=844,`First research offer title below initial screen: ${JSON.stringify(title)}`);
  assert.match(await page.locator('#trialFeed').textContent(),/Research options — terms not confirmed/);
  assert.equal(await page.locator('#searchExamples').evaluate(el=>el.open),false);
  const stored=await page.evaluate(()=>localStorage.getItem('trywise-state-v2'));
  await search.fill('hul');
  assert.equal(await page.locator('#trialFeed article .card-title').first().textContent(),'Hulu');
  assert.equal(await page.evaluate(()=>localStorage.getItem('trywise-state-v2')),stored,'Typing must not persist every query');
  await page.locator('#requirementForm button[type="submit"]').click();
  assert(await search.isVisible(),'Submitting must not hide the sole search');
  assert.equal(await search.inputValue(),'hul');
  await search.fill('zzznomatch');
  assert.match(await page.locator('#trialFeed').textContent(),/No matching options/);
  assert.equal(await page.locator('#requirementPlan').textContent(),'','Typing replaces the submitted summary, not stale results');
  await search.fill('');
  assert((await page.locator('#trialFeed article').count())>1,'Clearing the search must not restore an old submitted request');
  await page.evaluate(()=>window.fixtureSignIn());
  await page.waitForFunction(()=>document.querySelector('#storageTitle').textContent==='Account storage' && !document.querySelector('main').inert);
  assert.match(await page.locator('#plannerPrivacy').textContent(),/saved to your account/);
  await search.fill('canva');
  assert.equal(await page.locator('#trialFeed article .card-title').first().textContent(),'Canva Pro');
  assert.equal(await page.locator('#adminReviewLink').isVisible(),false);
  // Text-only zoom exercises wrapping, not just a larger device pixel ratio.
  for (const width of [320,390,768,1440]) {
    for (const fontSize of ['100%','200%']) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(fontSize=>document.documentElement.style.fontSize=fontSize,fontSize);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Page overflow at ${width}/${fontSize}`);
      for (const selector of ['#requirementText','#requirementForm button[type="submit"]']) {
        const box=await page.locator(selector).boundingBox();
        // Transforms can report 43.999984px for a 44px control; allow float rounding only.
        assert(box.width>0 && box.height>=43.99 && box.x>=0 && box.x+box.width<=width+.01,`Clipped search control ${selector} at ${width}/${fontSize}: ${JSON.stringify(box)}`);
      }
    }
  }
  assert.deepEqual(errors,[]);
  console.log(`Discovery checks passed: single persistent search, first research title at ${Math.round(title.y)}px, loading/error recovery, guest/account paths, non-persisted typing, four widths and 200% text zoom.`);
} finally {await browser.close();}
