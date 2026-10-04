import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177';
if (!['localhost','127.0.0.1'].includes(new URL(baseUrl).hostname)) throw Error('Navigation fixtures must run locally.');
const browser = await chromium.launch();
try {
  for (const width of [390,1440]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/firebase-config.js', route => route.fulfill({contentType:'text/javascript',body:'export const firebaseConfig = {};'}));
    const ready = () => page.waitForFunction(() => window.__tryWiseSmoke && !document.querySelector('main').inert);
    const selected = async view => {
      await page.waitForFunction(view => document.querySelector(`#${view}Tab`)?.getAttribute('aria-selected') === 'true', view);
      assert.equal(new URL(page.url()).hash, `#${view}`);
      assert.equal(await page.locator('.tab[aria-selected="true"]').count(), 1);
      assert.equal(await page.locator('.view.active').getAttribute('id'), `${view}View`);
      assert.equal(await page.locator(`#${view}Tab`).getAttribute('tabindex'), '0');
    };
    await page.goto(baseUrl);
    await ready();
    await selected('discover');
    await page.locator('[data-add-catalog="canva-pro"]').click();
    const stored = await page.evaluate(() => localStorage.getItem('trywise-state-v2'));
    const historyLength = await page.evaluate(() => history.length);
    for (const view of ['active','review','radar','insights']) {
      await page.locator(`#${view}Tab`).click();
      await selected(view);
    }
    assert.equal(await page.evaluate(() => history.length), historyLength + 4);
    await page.locator('#insightsTab').click();
    assert.equal(await page.evaluate(() => history.length), historyLength + 4, 'Repeated tab clicks must not add duplicate entries');
    for (const view of ['radar','review','active','discover']) {
      await page.goBack();
      await selected(view);
      assert(await page.locator(`#${view}Tab`).evaluate(el => el === document.activeElement));
    }
    for (const view of ['active','review','radar','insights']) {
      await page.goForward();
      await selected(view);
    }
    await page.reload();
    await ready();
    await selected('insights');
    assert.equal(await page.evaluate(() => localStorage.getItem('trywise-state-v2')), stored);
    await page.locator('#insightsTab').focus();
    await page.keyboard.press('Home');
    await selected('discover');
    await page.keyboard.press('ArrowRight');
    await selected('active');
    await page.keyboard.press('End');
    await selected('insights');
    await page.goBack();
    await selected('active');
    // Typed fragment changes, deep links and invalid fragments are safely handled.
    await page.evaluate(() => { location.hash = 'review'; });
    await selected('review');
    await page.goto(`${baseUrl}/?test=preserved#radar`);
    await ready();
    await selected('radar');
    await page.locator('#activeTab').click();
    assert.equal(new URL(page.url()).search, '?test=preserved');
    await page.goto(`${baseUrl}/#%3Cinvalid%3E`);
    await ready();
    await selected('discover');
    assert.equal(await page.evaluate(() => history.state), null, 'History must contain no plan/account data');
    assert.equal(await page.evaluate(() => localStorage.getItem('trywise-state-v2')), stored);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Navigation passed: mobile/desktop Back/Forward, reload/deep links, keyboard tabs, duplicate suppression and plan privacy.');
} finally { await browser.close(); }
