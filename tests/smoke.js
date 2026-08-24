const { chromium } = require('playwright');

const baseUrl = (process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177').replace(/\/$/, '');

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('h1').filter({ hasText: 'TryWise' }).waitFor();
  await page.locator('#requirementText').fill('Cheapest meal kits for busy weekdays');
  await page.locator('#requirementBudget').fill('30');
  await page.locator('#requirementForm button[type="submit"]').click();
  await page.locator('#requirementPlan').getByText('Try plan for: Cheapest meal kits for busy weekdays').waitFor();
  await page.locator('[data-add-catalog="hellofresh"]').click();
  await page.locator('button[data-view="active"]').click();
  await page.locator('#activeTrials').getByText('HelloFresh').waitFor();
  await page.locator('[data-edit-trial]').first().click();
  await page.locator('#trialGoal').fill('Updated smoke-test goal');
  await page.locator('#trialForm button[type="submit"]').click();
  await page.locator('#activeTrials').getByText('Updated smoke-test goal').waitFor();
  await page.locator('button[data-view="review"]').click();
  await page.locator('#reviewQueue').getByText('HelloFresh').waitFor();
  await page.locator('[data-check-trial]').first().check();
  await page.locator('button[data-view="radar"]').click();
  await page.locator('#sourceRadar').getByText('Official pages').waitFor();
  await page.locator('#alertPlan').getByText('Weekly trial digest').waitFor();
  await page.locator('button[data-view="insights"]').click();
  await page.locator('#optimizationPlan').getByText('Current comparison plan').waitFor();

  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('button[data-view="discover"]').click();
  await page.locator('#trialFeed').getByRole('heading', { name: 'HelloFresh' }).waitFor();

  await browser.close();
  if (errors.length) {
    throw new Error(`Console errors:\n${errors.join('\n')}`);
  }
  console.log('TryWise smoke passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
