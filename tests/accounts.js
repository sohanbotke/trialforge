const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177';

async function authenticate(page, email, create = false) {
  await page.evaluate(async ({ email, create }) => {
    const { getApp } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js');
    const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js');
    const auth = getAuth(getApp());
    if (auth.app.options.projectId !== 'demo-trywise') throw new Error('Refusing to create test users outside the demo emulator.');
    await (create ? createUserWithEmailAndPassword : signInWithEmailAndPassword)(auth, email, 'EmulatorOnlyPassword123!');
  }, { email, create });
  await page.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Account ✓');
}

async function run() {
  const browser = await chromium.launch();
  try {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    const errors = [];
    for (const page of [a, b]) {
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${baseUrl}/?emulator=1`);
      await page.waitForFunction(() => !document.querySelector('main').inert);
    }
    const email = `alice-${Date.now()}@example.test`;
    await a.locator('[data-add-catalog="hellofresh"]').click();
    const guestStorage = await a.evaluate(() => localStorage.getItem('trywise-state-v2'));
    await authenticate(a, email, true);
    await a.locator('#activeTab').click();
    assert.equal(await a.locator('#activeTrials article').count(), 0, 'Guest data must not upload automatically');
    await a.locator('#accountBtn').click();
    await a.locator('#importGuestBtn').click();
    await a.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Account ✓');
    await a.locator('#closeAccountBtn').click();
    assert.match(await a.locator('#activeTrials').textContent(), /HelloFresh/);
    await a.locator('[data-edit-trial]').click();
    await a.locator('#startDate').fill('2026-09-12');
    await a.locator('#endDate').fill('2026-09-20');
    await a.locator('#monthlyCost').fill('15');
    await a.locator('#trialGoal').fill('Private goal across devices');
    await a.locator('#trialForm button[type="submit"]').click();
    await a.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Account ✓');
    assert.equal(await a.evaluate(() => localStorage.getItem('trywise-state-v2')), guestStorage, 'Account edits must not overwrite guest storage');

    await authenticate(b, email);
    await b.locator('#activeTab').click();
    assert.match(await b.locator('#activeTrials').textContent(), /Private goal across devices/);
    await b.locator('[data-edit-trial]').click();
    await b.locator('#trialGoal').fill('Updated on second device');
    await b.locator('#trialForm button[type="submit"]').click();
    await b.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Account ✓');
    await a.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Updates');
    await a.locator('#accountBtn').click();
    await a.locator('#loadLatestBtn').click();
    await a.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Account ✓');
    await a.locator('#closeAccountBtn').click();
    assert.match(await a.locator('#activeTrials').textContent(), /Updated on second device/);
    await a.reload();
    await a.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Account ✓');
    await a.locator('#activeTab').click();
    assert.match(await a.locator('#activeTrials').textContent(), /Updated on second device/);

    await a.locator('#accountBtn').click();
    await a.locator('#signOutBtn').click();
    await a.waitForFunction(() => document.getElementById('accountBtn').textContent === 'Sign in');
    await a.locator('#closeAccountBtn').click();
    assert(!((await a.locator('#activeTrials').textContent()).includes('Updated on second device')));
    await authenticate(a, `bob-${Date.now()}@example.test`, true);
    assert.equal(await a.locator('#activeTrials article').count(), 0, 'A different account must start with its own empty plan');
    await a.locator('#accountBtn').click();
    await a.screenshot({ path: '/private/tmp/trywise-account-desktop.png' });
    await a.setViewportSize({ width: 390, height: 844 });
    await a.screenshot({ path: '/private/tmp/trywise-account-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('Account browser checks passed: optional import, account isolation, cross-device updates, reload persistence, and sign-out.');
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
