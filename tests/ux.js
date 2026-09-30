const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = (process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177').replace(/\/$/, '');

function contrast(a, b) {
  const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3)
    .map(Number).map((c) => c / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    await page.route('**/firebase-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const firebaseConfig = {};' }));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/index.html`);
    assert.equal(await page.locator('#sidebarToggle').isVisible(), false);
    const sidebar = await page.locator('#sidebar').boundingBox();
    const content = await page.locator('#mainContent').boundingBox();
    assert(content.x > sidebar.x + sidebar.width, 'Desktop content must stay beside the sidebar');
    assert((await page.locator('#requirementText').boundingBox()).y < 700);
    const headerWeights = await page.evaluate(() => [document.querySelector('#accountBtn'), document.querySelector('#planTools summary')].map(el => getComputedStyle(el).backgroundColor));
    assert.notEqual(headerWeights[0], headerWeights[1], 'Sign in must have primary visual weight');
    const dateTheme = await page.evaluate(() => ['serviceName', 'startDate', 'endDate'].map(id => {
      const style = getComputedStyle(document.getElementById(id));
      return [style.border, style.borderRadius, style.backgroundColor, style.fontFamily, style.fontSize, style.padding, style.minHeight];
    }));
    assert.deepEqual(dateTheme[1], dateTheme[0], 'Native date fields must share text field styling');
    assert.deepEqual(dateTheme[2], dateTheme[0]);
    const tags = await page.locator('#trialFeed .badge-row .badge').evaluateAll(els => els.map(el => {
      const style = getComputedStyle(el); return `${style.backgroundColor}/${style.color}`;
    }));
    assert.equal(new Set(tags).size, 1, 'Category/domain tags share a neutral style; color is reserved for status');
    for (const card of await page.locator('#trialFeed article').all()) {
      assert.doesNotMatch(await card.locator('.card-title').textContent(), /\$/);
      assert.equal(await card.locator('.offer-facts').count(), 1);
      for (const cost of await card.locator('.offer-facts dd').all()) assert((await cost.textContent()).trim(), 'No blank cost values');
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#mainContent').evaluate((el) => el === document.activeElement), true);

    await page.locator('#discoverTab').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#activeTab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#activeView').isVisible(), true);
    assert.equal(await page.locator('#cancelEditBtn').isVisible(), false);
    await page.keyboard.press('End');
    assert.equal(await page.locator('#insightsTab').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');

    const total = await page.locator('#trialFeed article').count();
    await page.locator('#catalogFilters summary').click();
    await page.locator('#requirementText').fill('Meal delivery services for busy weekdays');
    await page.locator('#requirementForm button[type="submit"]').click();
    assert.equal(await page.locator('#plannerToggle').evaluate((el) => el === document.activeElement), true);
    await page.locator('#clearFiltersBtn').click();
    assert.equal(await page.locator('#trialFeed article').count(), total, 'Clear filters must include offers outside the latest requirement');
    const cloud = page.locator('#interestList button').filter({ hasText: 'Free Cloud' });
    await cloud.click();
    assert.equal(await cloud.getAttribute('aria-pressed'), 'true');
    assert.equal(await cloud.evaluate((el) => el === document.activeElement), true);
    assert(await page.locator('#trialFeed').getByRole('heading', { name: 'Vercel Hobby' }).isVisible());
    assert.equal(await page.locator('#trialFeed').getByRole('heading', { name: 'HelloFresh' }).count(), 0);
    await page.locator('#searchInput').fill('no-such-offer-xyz');
    assert.match(await page.locator('#resultsCount').textContent(), /^0 of /);
    await page.locator('#clearFiltersBtn').click();
    assert.equal(await page.locator('#trialFeed article').count(), total);

    // A single paragraph is exposed once to screen-reader traversal.
    const explanation = 'Reviewed matches first, then unreviewed previews.';
    const snapshot = await page.locator('#requirementPlan').ariaSnapshot();
    assert.equal(snapshot.split(explanation).length - 1, 1);

    await page.locator('[data-add-catalog="hellofresh"]').click();
    await page.locator('#activeTab').click();
    await page.locator('[data-edit-trial]').click();
    assert.equal(await page.locator('#serviceName').evaluate((el) => el === document.activeElement), true);
    await page.locator('#monthlyCost').fill('15');
    await page.locator('#startDate').fill('2026-09-10');
    await page.locator('#endDate').fill('2026-09-09');
    await page.locator('#trialForm button[type="submit"]').click();
    assert.equal(await page.locator('#dateError').isVisible(), true);
    assert.equal(await page.locator('#endDate').getAttribute('aria-invalid'), 'true');
    await page.locator('#endDate').fill('2026-09-20');
    await page.locator('#trialGoal').fill('Preserve my custom goal through undo');
    await page.locator('#trialForm button[type="submit"]').click();
    assert.equal(await page.locator('#dateError').isVisible(), false);
    await page.locator('[data-remove-trial]').click();
    assert.equal(await page.locator('#activeTrials article').count(), 0);
    assert.equal(await page.locator('#undoRemoveBtn').evaluate((el) => el === document.activeElement), true);
    await page.locator('#undoRemoveBtn').click();
    assert.match(await page.locator('#activeTrials').textContent(), /Preserve my custom goal through undo/);
    await page.reload();
    await page.locator('#activeTab').click();
    assert.match(await page.locator('#activeTrials').textContent(), /Preserve my custom goal through undo/);

    const beforeSetup = await page.evaluate(() => JSON.stringify(window.__tryWiseSmoke.getState()));
    await page.locator('#planTools summary').click();
    await page.locator('#setupBtn').click();
    assert.equal(await page.getByRole('dialog', { name: 'Choose your preferences' }).isVisible(), true);
    await page.locator('#seedParentBtn').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => JSON.stringify(window.__tryWiseSmoke.getState())), beforeSetup, 'Cancel must discard suggested defaults');
    assert.equal(await page.locator('#setupBtn').evaluate((el) => el === document.activeElement), true);

    await page.locator('#discoverTab').click();
    const colors = await page.locator('.btn.primary:visible, .badge.green:visible, .badge.amber:visible, .badge.red:visible').evaluateAll((els) =>
      els.filter((el) => !el.disabled).map((el) => ({ label: el.textContent.trim(), color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })));
    for (const item of colors) assert(contrast(item.color, item.background) >= 4.5, `Insufficient text contrast: ${item.label}`);

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundImage), 'none', 'No clipped watermark or viewport-filling gradient');
      await page.locator('#discoverTab').click();
      if (await page.locator('.hero-panel').evaluate(el => el.classList.contains('collapsed'))) await page.locator('#plannerToggle').click();
      const clippedChips = await page.locator('.quick-starts').evaluate(container => {
        const bounds = container.getBoundingClientRect();
        return [...container.children].filter(el => {
          const b = el.getBoundingClientRect();
          return b.left < bounds.left - 1 || b.right > bounds.right + 1 || b.top < bounds.top - 1 || b.bottom > bounds.bottom + 1;
        }).map(el => el.textContent);
      });
      assert.deepEqual(clippedChips, [], `Every example chip must be fully visible at ${width}px`);
      for (const view of ['discover', 'active', 'review', 'radar', 'insights']) {
        await page.locator(`#${view}Tab`).click();
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
        assert(dimensions.content <= dimensions.viewport, `${view} overflows at ${width}px`);
        assert.equal(await page.locator('.tabs').evaluate(el => getComputedStyle(el).position), 'static', `View navigation must not overlay ${view} content at ${width}px`);
        const obscured = await page.evaluate(view => {
          const nav = document.querySelector('.tabs');
          const controls = [...document.querySelectorAll(`#${view}View input, #${view}View textarea, #${view}View button, #${view}View a, #${view}View summary`)].filter(el => el.getClientRects().length);
          const failures = [];
          for (const control of controls) {
            const y = control.getBoundingClientRect().top + scrollY;
            for (const offset of [12, 40, 120, 300]) {
              window.scrollTo(0, Math.max(0, y - offset));
              const a = control.getBoundingClientRect(), b = nav.getBoundingClientRect();
              if (a.top < innerHeight && a.bottom > 0 && b.top < a.bottom && b.bottom > a.top && b.left < a.right && b.right > a.left) failures.push(control.id || control.textContent.trim().slice(0,40));
            }
          }
          return failures;
        }, view);
        assert.deepEqual(obscured, [], `${view} controls obscured by navigation at ${width}px`);
      }
      await page.locator('#setupBtn').click();
      const dialog = await page.locator('#onboardingDialog').boundingBox();
      assert(dialog.x >= 0 && dialog.x + dialog.width <= width, `Setup dialog overflows at ${width}px`);
      await page.keyboard.press('Escape');
    }

    // Stress longer labels independently of platform font metrics.
    await page.setViewportSize({width:320,height:900});
    await page.locator('#activeTab').click();
    const calendarButton = page.locator('[data-calendar-trial]');
    const calendarLabel = await calendarButton.textContent();
    await calendarButton.evaluate(el => { el.textContent = 'Export decision to calendar — choose a reminder in your calendar app'; });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Long action labels must wrap inside the plan');
    await calendarButton.evaluate((el, label) => { el.textContent = label; }, calendarLabel);

    if (process.env.TRYWISE_SCREENSHOT_DIR) {
      for (const width of [390,1440]) {
        await page.setViewportSize({width,height:900});
        await page.locator('#serviceName').evaluate(el=>{el.focus();el.scrollIntoView({block:'start'});});
        const visible=await page.locator('#serviceName').evaluate(el=>{
          const box=el.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight&&document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===el;
        });
        assert(visible, `Focused form input must be unobscured at ${width}px`);
        await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/plan-form-${width}.png`});
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#discoverTab').click();
    await page.locator('#sidebarToggle').click();
    assert.equal(await page.locator('#sidebar').isVisible(), true);
    await page.locator('#sidebarToggle').click();
    assert.equal(await page.locator('#sidebar').isVisible(), false);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(() => window.scrollTo(0, 0));
    const input = await page.locator('#requirementText').boundingBox();
    assert(input.y + input.height < 844, 'The primary mobile input should fit on the first screen');
    await page.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/trywise-after-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/trywise-after-desktop.png` });
    if (process.env.TRYWISE_SCREENSHOT_DIR) {
      for (const width of [390,1440]) {
        await page.setViewportSize({width,height:1000});
        await page.locator('#discoverTab').click();
        await page.evaluate(() => scrollTo(0,0));
        await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/catalog-polish-${width}.png`});
        await page.locator('#reviewTab').click();
        await page.evaluate(() => scrollTo(0,0));
        await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/decisions-empty-${width}.png`});
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.hero-panel').evaluate((el) => getComputedStyle(el, '::before').animationName), 'none');
    assert.deepEqual(errors, []);
    console.log(`TryWise UX checks passed. Mobile input: ${Math.round(input.y)}px from page top. ${colors.length} text contrast checks passed.`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
