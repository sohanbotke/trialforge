import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const base = 'https://trywise-9f8e1.web.app';
const expected = JSON.parse(await readFile(new URL('../dist/release.json', import.meta.url), 'utf8'));
async function get(file) {
  return fetch(`${base}/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
}
const manifestResponse = await get('release.json');
assert.equal(manifestResponse.status, 200);
assert.deepEqual(await manifestResponse.json(), expected, 'Firebase must serve the revision this job built');
for (const [file, hash] of Object.entries(expected.files)) {
  const response = await get(file);
  assert.equal(response.status, 200, file);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), hash, file);
}
for (const file of ['package.json', 'firestore.rules', 'backend/collector.py', 'backend/data/state.json', 'backend/data/weekly/state.json', 'backend/data/trials.generated.json', 'backend/data/nightly/outbox.json', 'tests/accounts.js']) {
  assert.equal((await get(file)).status, 404, `${file} must stay private`);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function waitForPlanner() {
    // Before module initialization, <main> is not inert yet. That alone is
    // not a readiness signal on a cold browser or slower network.
    await page.waitForFunction(() => Boolean(window.__tryWiseSmoke)
      && document.querySelector('main')?.inert === false
      && document.querySelectorAll('#trialFeed article').length > 0);
  }
  await page.goto(base);
  await waitForPlanner();
  assert(await page.locator('#accountBtn').isVisible());
  assert(await page.locator('#trialFeed article').count() > 0);
  await page.locator('[data-add-catalog]').first().click();
  await page.reload();
  await waitForPlanner();
  await page.locator('#activeTab').click();
  assert.match(await page.locator('#activeTrials').textContent(), /Saved — not started/);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(`${base}/admin.html`);
  await page.waitForFunction(() => !document.getElementById('signIn').disabled);
  assert.equal(await page.locator('#workspace').isVisible(), false);
  assert.equal(await page.locator('#queue').textContent(), '');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
console.log(`Live release ${expected.commit} verified: exact assets, guest persistence, admin gate, private-file exclusions.`);
