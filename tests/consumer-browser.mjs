import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Consumer fixture tests must run locally.');
const catalogModule = await readFile(new URL('../catalog-model.mjs', import.meta.url), 'utf8');
const fixture = {
  id: 'reviewed-fixture', name: 'Reviewed streaming fixture', description: 'A test-only streaming option.',
  source: 'official', categories: ['shows'], facets: [], verificationStatus: 'reviewed',
  offerType: 'free_tier', monthlyValue: 0, upfrontCost: 0, trialDays: 14, providerTrialDays: 0,
  verified: '2026-09-12', url: 'https://example.test/', region: 'Test region',
  priceDetails: 'Usage limits apply. <script>window.injected=true</script>',
  cancellation: 'Manage through provider account.', eligibility: 'Test users only', goal: 'Watch a show'
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const firebaseConfig = {};' }));
  await page.route('**/catalog-model.mjs', route => route.fulfill({ contentType: 'text/javascript', body:
    catalogModule.replace('export function mergedCatalog(', 'function originalCatalog(')
    + `\nexport function mergedCatalog(seeds, records, now) { return [...originalCatalog(seeds, records, now), ${JSON.stringify(fixture)}, ${JSON.stringify({ ...fixture, id: 'paid-fixture', name: 'Reviewed paid fixture', offerType: 'trial', providerTrialDays: 7, monthlyValue: 12.5, upfrontCost: 1.25 })}]; }`
  }));
  await page.goto(baseUrl);
  await page.locator('#trialFeed article').first().waitFor();
  assert.equal(await page.locator('.stats').isVisible(), false);
  assert.equal(await page.locator('#setupBtn').isVisible(), false);
  const inputY = (await page.locator('#requirementText').boundingBox()).y;
  const feedY = (await page.locator('#trialFeed').boundingBox()).y;
  assert(inputY < 600, `Search too low: ${inputY}`);
  assert(feedY < 1100, `Feed too low: ${feedY}`);
  assert.match(await page.locator('#trialFeed article').first().textContent(), /Reviewed streaming fixture/);
  assert.equal(await page.locator('.rank-pill').count(), 0);
  const preview = page.locator('#trialFeed article').filter({ has: page.locator('[data-add-catalog="hellofresh"]') });
  assert.match(await preview.textContent(), /Not confirmed/);
  assert.doesNotMatch(await preview.textContent(), /\$|Risk:|Cancel: Low|day window/);
  const free = page.locator('#trialFeed article').first();
  assert.doesNotMatch(await free.textContent(), /after trial|day trial|planning review/);
  await free.locator('summary').click();
  assert.match(await free.textContent(), /Usage limits apply/);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await page.locator('#catalogFilters summary').click();
  await page.locator('#valueFilter').selectOption('0');
  assert.equal(await page.locator('#trialFeed article').count(), 1);
  await page.locator('#valueFilter').selectOption('20');
  assert.equal(await page.locator('#trialFeed article').count(), 2);
  await page.locator('#offerTypeFilter').selectOption('trial');
  assert.equal(await page.locator('#trialFeed article').count(), 1);
  assert.match(await page.locator('#trialFeed article').textContent(), /\$12.50\/mo/);
  await page.locator('#clearFiltersBtn').click();
  await page.locator('#reviewFilter').selectOption('reviewed');
  assert.equal(await page.locator('#trialFeed article').count(), 2);
  await page.locator('#searchInput').fill('nothing-matches-xyz');
  assert.match(await page.locator('#trialFeed').textContent(), /No matching options/);
  await page.locator('#clearFiltersBtn').click();
  await page.locator('#searchInput').fill('streaming fixture');
  await page.locator('#catalogFilters summary').click();
  await page.locator('#clearFiltersBtn').click();
  assert.equal(await page.locator('#catalogFilters summary').evaluate(el => el === document.activeElement), true, 'Clearing collapsed filters must focus a visible control');
  await page.locator('[data-add-catalog="hellofresh"]').click();
  assert.equal(await page.locator('[data-add-catalog="hellofresh"]').isDisabled(), true);
  await page.reload();
  await page.locator('#activeTab').click();
  assert.match(await page.locator('#activeTrials').textContent(), /Saved — not started/);
  let state = await page.evaluate(() => window.__tryWiseSmoke.getState());
  assert.equal(state.trials.length, 1);
  assert.equal(state.trials[0].status, 'saved');
  assert.equal(state.trials[0].startDate, '');
  assert.equal(state.trials[0].endDate, '');
  assert.equal(await page.locator('#urgentCount').textContent(), '0');
  assert.equal(await page.locator('#monthlyValue').textContent(), '$0.00');
  await page.locator('#reviewTab').click();
  assert.equal(await page.locator('#reviewQueue article').count(), 0);
  await page.locator('#activeTab').click();
  await page.locator('[data-edit-trial]').click();
  for (const id of ['startDate', 'endDate', 'monthlyCost']) assert.equal(await page.locator(`#${id}`).inputValue(), '');
  await page.locator('#cancelEditBtn').click();
  assert.equal((await page.evaluate(() => window.__tryWiseSmoke.getState())).trials[0].status, 'saved');
  await page.locator('[data-edit-trial]').click();
  await page.locator('#startDate').fill('2026-09-12');
  await page.locator('#endDate').fill('2026-09-20');
  await page.locator('#monthlyCost').fill('12.50');
  await page.locator('#trialForm button[type="submit"]').click();
  state = await page.evaluate(() => window.__tryWiseSmoke.getState());
  assert.equal(state.trials[0].status, 'active');
  assert.equal(state.trials[0].endDate, '2026-09-20');
  assert.equal(state.trials[0].monthlyValue, 12.5);
  await page.locator('#reviewTab').click();
  assert.equal(await page.locator('#reviewQueue article').count(), 1);
  await page.locator('[data-decide="cancel"]').click();
  assert.equal((await page.evaluate(() => window.__tryWiseSmoke.getState())).trials[0].status, 'cancel');
  await page.locator('#insightsTab').click();
  assert.match(await page.locator('#decisionHistory').textContent(), /cancel planned/);
  await page.locator('#discoverTab').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/trywise-consumer-improvements-mobile.png`, fullPage: false });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
  }
  // A new guest can make an explicit shortlist without hidden budgets.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#trialFeed article').first().waitFor();
  await page.locator('[data-quick-requirement]').filter({hasText:'AI coding tools'}).click();
  assert.equal((await page.evaluate(() => window.__tryWiseSmoke.getState())).requirements.at(-1).budget, 0);
  await page.locator('#plannerToggle').click();
  await page.locator('.discovery-options').first().locator('summary').click();
  await page.locator('#requirementBudget').fill('17');
  await page.locator('[data-quick-requirement]').filter({hasText:'Live sports'}).click();
  assert.equal((await page.evaluate(() => window.__tryWiseSmoke.getState())).requirements.at(-1).budget, 17);
  await page.locator('#clearFiltersBtn').click();
  for (const id of ['reviewed-fixture','paid-fixture','hellofresh']) await page.locator(`[data-add-catalog="${id}"]`).click();
  await page.locator('[data-add-catalog]:not(:disabled)').first().click();
  await page.locator('#activeTab').click();
  assert((await page.locator('#activeTrials').boundingBox()).y < (await page.locator('#trialForm').boundingBox()).y, 'Shortlist should precede the tracking form');
  for (let i = 0; i < 4; i++) await page.locator('[data-compare-trial]').nth(i).click();
  assert.equal(await page.locator('[data-compare-trial][aria-pressed="true"]').count(), 3);
  assert.match(await page.locator('#toast').textContent(), /up to 3/);
  await page.locator('#compareSavedBtn').click();
  assert(await page.locator('#comparisonDialog').isVisible());
  assert.equal(await page.locator('#comparisonTable thead th').count(), 4);
  assert.match(await page.locator('#comparisonTable').textContent(), /\$12.50\/mo after trial/);
  assert.match(await page.locator('#comparisonTable').textContent(), /Not confirmed/);
  assert.match(await page.locator('#comparisonTable').textContent(), /<script>window.injected=true<\/script>/);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Comparison overflow at ${width}`);
    const box = await page.locator('#comparisonDialog').boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`${process.env.TMPDIR || '/tmp'}/trywise-mvp-comparison-mobile.png`});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#compareSavedBtn').evaluate(el => el === document.activeElement), true);
  await page.locator('[data-remove-trial]').first().click();
  assert.match(await page.locator('#compareSavedBtn').textContent(), /2\/3/);
  await page.locator('#undoRemoveBtn').click();
  await page.locator('[data-edit-trial]').first().click();
  await page.locator('#startDate').fill('2026-09-27');
  await page.locator('#endDate').fill('2026-10-02');
  await page.locator('#monthlyCost').fill('12.50');
  await page.locator('#keepCriteria').fill('PRIVATE calendar exclusion');
  await page.locator('#trialForm button[type="submit"]').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('[data-calendar-trial]').click();
  const calendar = await downloaded;
  assert.equal(calendar.suggestedFilename(), 'trywise-decision.ics');
  const ics = await readFile(await calendar.path(), 'utf8');
  assert.match(ics, /DTSTART;VALUE=DATE:20261002/);
  assert.doesNotMatch(ics, /PRIVATE calendar exclusion/);
  assert.match(await page.locator('#toast').textContent(), /set a reminder/);
  await page.reload();
  await page.locator('#activeTab').click();
  assert.equal(await page.locator('#activeTrials article').count(), 4);
  assert.match(await page.locator('#compareSavedBtn').textContent(), /0\/3/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path:`${process.env.TMPDIR || '/tmp'}/trywise-mvp-plan-mobile.png`});

  // Hold the catalog callback so loading is deterministic, not a timed guess.
  await page.route('**/firebase-client.mjs', route => route.fulfill({contentType:'text/javascript', body:`
    export const isFirebaseConfigured = () => true;
    export async function createFirebaseClient() { return {
      catalog: {watchCatalog(ready, failed) { window.deliverCatalog = () => ready([]); window.failCatalog = () => failed(); }},
      onAuth(callback) { callback(null); }
    }; }
  `}));
  await page.reload();
  await page.waitForFunction(() => window.deliverCatalog && window.__tryWiseSmoke && !document.querySelector('main').inert);
  assert.match(await page.locator('#resultsCount').textContent(), /Loading/);
  assert.doesNotMatch(await page.locator('#trialFeed').textContent(), /No matching options/);
  await page.evaluate(() => window.failCatalog());
  assert.match(await page.locator('#trialFeed').textContent(), /Could not load/);
  assert(await page.locator('[data-reload-catalog]').isVisible());
  await page.evaluate(() => window.deliverCatalog());
  await page.locator('#trialFeed article').first().waitFor();
  assert.equal(await page.locator('#trialFeed').getAttribute('aria-busy'), 'false');
  assert.deepEqual(errors, []);
  console.log(`Consumer checks passed: reviewed-first claims, exact costs, filters, safe evidence, saved/start lifecycle, persistence. Mobile search ${Math.round(inputY)}px; feed ${Math.round(feedY)}px.`);
} finally { await browser.close(); }
