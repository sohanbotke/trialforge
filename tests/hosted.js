const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.TRYWISE_BASE_URL || 'https://trywise-9f8e1.web.app';

async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(baseUrl);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['x-content-type-options'], 'nosniff');
    await page.waitForFunction(() => !document.querySelector('main').inert);
    for (const file of ['firebase-config.js', 'firebase-client.mjs', 'plan-state.mjs', 'plan-store.mjs', 'account-ui.mjs', 'assets/trywise-mark.svg', 'seed-catalog.mjs', 'catalog-client.mjs', 'catalog-model.mjs', 'admin.html', 'admin.css', 'admin-ui.mjs', 'offer-identity.mjs', 'starter-audit.mjs']) {
      const asset = await context.request.get(`${baseUrl}/${file}`);
      assert.equal(asset.status(), 200, `${file} must be published`);
      if (/\.(mjs|js)$/.test(file)) assert.match(asset.headers()['content-type'], /javascript/);
    }
    for (const file of ['firestore.rules', 'package.json', 'tests/accounts.js', '.agents/skills/firebase-hosting-basics/SKILL.md', 'backend/nightly.py', 'backend/draft_fields.py', 'backend/data/nightly/outbox.json', 'scripts/migrate-nightly-auth.mjs']) {
      assert.equal((await context.request.get(`${baseUrl}/${file}`)).status(), 404, `${file} must not be published`);
    }
    const publicOffers=await page.evaluate(async()=>{
      const {getFirestore,getDocsFromServer,collection,query,limit}=await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
      const {validateOffer}=await import('/catalog-model.mjs');
      const snapshot=await getDocsFromServer(query(collection(getFirestore(),'catalog'),limit(500)));
      return snapshot.docs.map(doc=>{const data=doc.data();if(data.status==='published')validateOffer(data);return {id:doc.id,status:data.status,revision:data.revision};});
    });
    console.log('Live public catalog remains readable and validates:',JSON.stringify(publicOffers));
    await page.locator('[data-add-catalog="hellofresh"]').click();
    await page.locator('#activeTab').click();
    assert.match(await page.locator('#activeTrials').textContent(), /HelloFresh/);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('main').inert);
    await page.locator('#activeTab').click();
    assert.match(await page.locator('#activeTrials').textContent(), /HelloFresh/);
    await page.locator('#accountBtn').click();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#signInBtn').click();
    const popup = await popupPromise;
    await popup.waitForURL((url) => url.hostname === 'accounts.google.com');
    console.log('Live Google sign-in reached accounts.google.com; no credentials entered.');
    await popup.close();
    await page.locator('#closeAccountBtn').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: '/private/tmp/trywise-hosted-mobile.png' });
    await page.goto(`${baseUrl}/admin.html`);
    await page.waitForFunction(() => !document.getElementById('signIn').disabled);
    assert.equal(await page.locator('#workspace').isVisible(), false, 'Admin queue must be hidden before authorization');
    assert.equal(await page.locator('#queue').textContent(), '');
    assert.equal(await page.locator('#draftInfo').isVisible(), false, 'AI drafts must be hidden before authorization');
    assert.equal(await page.locator('#draftInfo').textContent(), '');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    console.log('Hosted checks passed: runtime assets, guest persistence, Google sign-in entry, mobile layout, admin sign-in gate, and private development files excluded.');
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
