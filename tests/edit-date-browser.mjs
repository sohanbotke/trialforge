import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177';
if (!['localhost','127.0.0.1'].includes(new URL(baseUrl).hostname)) throw Error('Date fixtures must run locally.');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/firebase-config.js', route => route.fulfill({contentType:'text/javascript',body:'export const firebaseConfig = {};'}));
  await page.goto(baseUrl);
  await page.locator('[data-add-catalog="canva-pro"]').click();
  await page.locator('#activeTab').click();
  await page.locator('[data-edit-trial]').click();
  await page.locator('#startDate').fill('2026-10-03');
  await page.locator('#endDate').fill('2026-11-02');
  await page.locator('#monthlyCost').fill('18');
  await page.locator('#trialForm button[type="submit"]').click();
  assert.equal(await page.locator('#decisionDateDialog').isVisible(), false, 'Starting tracking already has an explicit confirmation');
  await page.locator('#reviewTab').click();
  await page.locator('[data-check-trial]').first().check();
  await page.locator('#activeTab').click();
  const getState = () => page.evaluate(() => window.__tryWiseSmoke.getState());
  const before = await getState();
  const stored = await page.evaluate(() => localStorage.getItem('trywise-state-v2'));
  await page.locator('[data-edit-trial]').click();
  await page.locator('#endDate').fill('2026-11-09');
  await page.locator('#monthlyCost').fill('19');
  await page.locator('#trialGoal').fill('Test-only revised goal');
  for (const cancel of ['button','escape']) {
    await page.locator('#trialForm button[type="submit"]').click();
    assert(await page.locator('#decisionDateDialog').isVisible());
    assert.equal(await page.locator('#newDecisionDate').inputValue(), '2026-11-09');
    assert.match(await page.locator('#decisionDateOption').textContent(), /also saves your other form edits/);
    assert.deepEqual(await getState(), before);
    await page.locator('#newDecisionDate').press('Enter');
    assert(await page.locator('#decisionDateDialog').isVisible());
    if (cancel === 'button') await page.locator('#cancelDecisionDate').click();
    else await page.keyboard.press('Escape');
    assert.deepEqual(await getState(), before);
    assert.equal(await page.evaluate(() => localStorage.getItem('trywise-state-v2')), stored);
    assert.equal(await page.locator('#endDate').inputValue(), '2026-11-09', 'Cancel retains unsaved form edits');
    assert(await page.locator('#trialForm button[type="submit"]').evaluate(el => el === document.activeElement));
  }
  await page.locator('#trialForm button[type="submit"]').click();
  await page.locator('#newDecisionDate').fill('2026-11-02');
  await page.locator('#decisionDateForm button[type="submit"]').click();
  assert.match(await page.locator('#decisionDateError').textContent(), /different date/);
  await page.locator('#newDecisionDate').fill('2026-10-01');
  await page.locator('#decisionDateForm button[type="submit"]').click();
  assert.deepEqual(await getState(), before);
  await page.locator('#newDecisionDate').fill('2026-11-09');
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    const box=await page.locator('#decisionDateDialog').boundingBox();
    assert(box.x>=0 && box.x+box.width<=width);
    if (process.env.TRYWISE_SCREENSHOT_DIR && [390,1440].includes(width)) {
      await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/edit-date-${width}.png`});
    }
  }
  await page.locator('#decisionDateForm button[type="submit"]').click();
  const after = await getState();
  assert.equal(after.trials[0].endDate,'2026-11-09');
  assert.equal(after.trials[0].monthlyValue,19);
  assert.equal(after.trials[0].goal,'Test-only revised goal');
  assert.deepEqual(after.trials[0].checks,before.trials[0].checks);
  assert.equal(after.trials[0].startDate,before.trials[0].startDate);
  assert.deepEqual(after.decisions,before.decisions);
  assert(await page.locator('[data-edit-trial]').evaluate(el=>el===document.activeElement));
  await page.reload();
  await page.locator('#activeTab').click();
  assert.deepEqual(await getState(),after);
  // Non-date edits remain a single explicit save.
  await page.locator('[data-edit-trial]').click();
  await page.locator('#monthlyCost').fill('20');
  await page.locator('#trialForm button[type="submit"]').click();
  assert.equal(await page.locator('#decisionDateDialog').isVisible(),false);
  assert.equal((await getState()).trials[0].monthlyValue,20);
  // A changed start date controls the valid range for the pending decision date.
  await page.locator('[data-edit-trial]').click();
  await page.locator('#startDate').fill('2026-12-01');
  await page.locator('#endDate').fill('2026-12-09');
  await page.locator('#trialForm button[type="submit"]').click();
  assert.equal(await page.locator('#newDecisionDate').getAttribute('min'),'2026-12-01');
  const pendingBefore=await getState();
  await page.locator('#newDecisionDate').fill('2026-11-30');
  await page.locator('#decisionDateForm button[type="submit"]').click();
  assert.deepEqual(await getState(),pendingBefore);
  await page.locator('#newDecisionDate').fill('2026-12-09');
  await page.locator('#decisionDateForm button[type="submit"]').click();
  assert.equal((await getState()).trials[0].startDate,'2026-12-01');
  // If the source record changes while the dialog is open, discard the pending patch.
  await page.locator('[data-edit-trial]').click();
  await page.locator('#endDate').fill('2026-12-10');
  await page.locator('#monthlyCost').fill('21');
  await page.locator('#trialForm button[type="submit"]').click();
  await page.evaluate(() => { window.__tryWiseSmoke.getState().trials[0].endDate='2026-12-11'; });
  await page.locator('#decisionDateForm button[type="submit"]').click();
  assert.equal((await getState()).trials[0].endDate,'2026-12-11');
  assert.equal((await getState()).trials[0].monthlyValue,20);
  assert.match(await page.locator('#toast').textContent(), /plan changed/);
  assert.deepEqual(errors,[]);
  console.log('Edit-date checks passed: both cancellation paths, atomic explicit confirmation, validation, persistence, checklist retention and stale-record protection.');
} finally { await browser.close(); }
