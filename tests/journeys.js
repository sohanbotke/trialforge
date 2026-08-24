const { chromium } = require('playwright');

const journeys = [
  {
    query: 'Cheapest way to watch live sports and shows',
    expected: ['YouTube TV', 'Hulu']
  },
  {
    query: 'Audiobooks and books I can try before paying',
    expected: ['Audible Standard', 'Kindle Unlimited']
  },
  {
    query: 'Meal delivery services for busy weekdays',
    expected: ['HelloFresh', 'Instacart+', 'DashPass']
  }
];

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('http://127.0.0.1:4177/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const results = [];
  for (const journey of journeys) {
    await page.locator('#requirementText').fill(journey.query);
    await page.locator('#requirementBudget').fill('30');
    await page.locator('#requirementRisk').selectOption('lowest-cost');
    await page.locator('#requirementForm button[type="submit"]').click();
    await page.locator('#requirementPlan').getByText(`Try plan for: ${journey.query}`).waitFor();
    const planText = await page.locator('#requirementPlan').innerText();
    const matched = journey.expected.filter((item) => planText.includes(item));
    results.push({ query: journey.query, matched });
    if (matched.length === 0) {
      throw new Error(`No expected options found for "${journey.query}". Plan text:\n${planText}`);
    }
  }

  await browser.close();
  if (errors.length) {
    throw new Error(`Console errors:\n${errors.join('\n')}`);
  }
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
