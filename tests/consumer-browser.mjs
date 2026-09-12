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
  assert.equal(await page.locator('#monthlyValue').textContent(), '$0');
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
  await page.screenshot({ path: '/private/tmp/trywise-consumer-improvements-mobile.png', fullPage: false });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
  }
  assert.deepEqual(errors, []);
  console.log(`Consumer checks passed: reviewed-first claims, exact costs, filters, safe evidence, saved/start lifecycle, persistence. Mobile search ${Math.round(inputY)}px; feed ${Math.round(feedY)}px.`);
} finally { await browser.close(); }
