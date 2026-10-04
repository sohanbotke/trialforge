import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { REVIEW_WINDOW_MS } from '../catalog-policy.mjs';

const baseUrl = process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177';
if (!['localhost','127.0.0.1'].includes(new URL(baseUrl).hostname)) throw Error('Fixtures must run locally.');
const now = Date.parse('2026-09-27T12:00:00Z');
const iso = offset => new Date(now+offset).toISOString();
const fixture = (id,overrides={}) => ({id,name:`Fixture ${id}`,description:'Test-only catalog entry.',
  category:'shows',url:'https://example.test/',offerType:'trial',trialDays:7,reviewDays:7,
  monthlyValue:12.5,upfrontCost:0,currency:'USD',priceDetails:'Monthly subscription after trial.',
  eligibility:'Fixture accounts',region:'US',cancellation:'Provider account',goal:'Try a show',
  status:'published',verifiedAt:iso(0),expiresAt:null,revision:1,...overrides});
const records = [fixture('fresh'),fixture('free',{offerType:'free_tier',trialDays:0,monthlyValue:0}),
  fixture('stale',{verifiedAt:iso(-REVIEW_WINDOW_MS)}),fixture('undated',{verifiedAt:null}),
  fixture('expired',{expiresAt:iso(-1)}),fixture('withdrawn',{status:'withdrawn'}),fixture('github-models')];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:now});
  await page.route('**/firebase-client.mjs',route=>route.fulfill({contentType:'text/javascript',body:`
    export const isFirebaseConfigured=()=>true;
    export async function createFirebaseClient(){return {
      catalog:{watchCatalog(ready){window.deliverCatalog=ready;}},onAuth(callback){callback(null);}
    };}
  `}));
  await page.goto(baseUrl);
  await page.waitForFunction(()=>window.deliverCatalog && window.__tryWiseSmoke && !document.querySelector('main').inert);
  const card=id=>page.locator(`#trialFeed [data-offer-id="${id}"]`);
  async function verifyIdentity() {
    for(const id of ['fresh','free']) {
      assert.equal(await card(id).locator('.card-top .badge').textContent(),'Terms checked');
      assert.match(await card(id).textContent(), /Terms checked 2026-09-27/);
    }
    for(const id of ['stale','undated']) {
      assert.equal(await card(id).locator('.card-top .badge').textContent(),'Needs recheck');
      assert.deepEqual(await card(id).locator('dd').allTextContents(),['Not confirmed','Not confirmed']);
    }
    for(const id of ['expired','withdrawn','github-models']) assert.equal(await card(id).count(),0);
    for(const text of await page.locator('#trialFeed dd').allTextContents()) assert(text.trim(),'Cost values may not be blank');
    assert.deepEqual(await card('fresh').locator('dd').allTextContents(),['$0.00','$12.50/mo']);
    assert.deepEqual(await card('free').locator('dd').allTextContents(),['$0.00','$0.00/mo']);
    assert.equal(await page.locator('#trialFeed .card-top .badge.green').count(),2);
  }
  await page.evaluate(records=>window.deliverCatalog(records),records);
  await verifyIdentity();
  await page.evaluate(records=>window.deliverCatalog(records),[...records].reverse());
  await verifyIdentity();
  await page.locator('#catalogFilters summary').click();
  await page.locator('#reviewFilter').selectOption('reviewed');
  assert.equal(await page.locator('#trialFeed article').count(),2);
  await page.locator('#clearFiltersBtn').click();
  await page.locator('#searchInput').fill('Fixture');
  await verifyIdentity();
  await card('fresh').locator('[data-add-catalog]').click();
  await page.evaluate(records=>window.deliverCatalog(records),records.map(item=>item.id==='fresh'?{...item,status:'withdrawn',revision:2}:item));
  await page.locator('#activeTab').click();
  assert.match(await page.locator('#activeTrials').textContent(),/withdrawn.*plan and decision dates are unchanged/s);
  assert.equal(await page.locator('#activeTrials a[target="_blank"]').count(),0);
  assert.equal((await page.evaluate(()=>window.__tryWiseSmoke.getState())).trials.length,1);
  await page.locator('#discoverTab').click();
  await page.evaluate(records=>window.deliverCatalog(records),records);
  await page.clock.setSystemTime(now+REVIEW_WINDOW_MS);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  for(const id of ['fresh','free','stale']) {
    assert.equal(await card(id).getAttribute('data-verification'),'stale');
    assert.equal(await card(id).locator('.card-top .badge').textContent(),'Needs recheck');
    assert.deepEqual(await card(id).locator('dd').allTextContents(),['Not confirmed','Not confirmed']);
  }
  assert.equal(await page.locator('#trialFeed .card-top .badge.green').count(),0,'Same-size catalog must age out without a database write');
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
  }
  if(process.env.TRYWISE_SCREENSHOT_DIR) {
    await page.clock.runFor(5000);
    await page.setViewportSize({width:390,height:844});
    await page.locator('#catalogFilters summary').click();
    await card('free').evaluate(element=>element.scrollIntoView({block:'start'}));
    await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/catalog-stale-mobile.png`});
    await page.clock.setSystemTime(now);
    await page.evaluate(records=>window.deliverCatalog(records),records);
    await page.setViewportSize({width:1440,height:1000});
    await card('fresh').evaluate(element=>element.scrollIntoView({block:'start'}));
    await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/catalog-current-desktop.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('Catalog browser checks passed: stable badge identity, explicit costs, retirement/expiry/withdrawal, saved-plan preservation, same-count aging, four viewport widths.');
} finally {await browser.close();}
