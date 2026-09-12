const { chromium } = require('playwright');

const baseUrl = (process.env.TRYWISE_BASE_URL || 'http://127.0.0.1:4177').replace(/\/$/, '');

const journeys = [
  {
    query: 'Cheapest way to watch live sports and shows',
    expectedTop: ['YouTube TV', 'Hulu']
  },
  {
    query: 'Audiobooks and books I can try before paying',
    expectedTop: ['Audible Standard', 'Kindle Unlimited']
  },
  {
    query: 'Meal delivery services for busy weekdays',
    expectedTop: ['Instacart+', 'DashPass', 'HelloFresh']
  },
  {
    query: 'Free cloud infrastructure to host my apps',
    expectedTop: ['Render Free', 'Cloudflare Workers', 'Netlify Free', 'Vercel Hobby']
  },
  {
    query: 'Free AI APIs with daily access to models',
    expectedTop: ['OpenRouter Free Models', 'Google Gemini API', 'Groq API', 'Cloudflare Workers AI']
  },
  {
    query: 'Free AI agent harnesses I can run locally',
    expectedTop: ['Aider', 'OpenCode', 'Continue', 'OpenHands']
  },
  {
    query: 'AI coding tools with useful free trials',
    expectedTop: ['GitHub Copilot', 'OpenCode', 'Aider', 'OpenHands']
  },
  {
    query: 'I need a free place to deploy a Next.js app',
    expectedTop: ['Vercel Hobby', 'Render Free', 'Cloudflare Workers', 'Netlify Free']
  }
];

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    await page.route('**/firebase-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const firebaseConfig = {};' }));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    const results = [];
    for (const [index, journey] of journeys.entries()) {
      if (index > 0) {
        await page.locator('#plannerToggle').click();
      }
      await page.locator('#requirementText').fill(journey.query);
      if (index === 0) await page.locator('#requirementForm summary').click();
      await page.locator('#requirementBudget').fill('30');
      await page.locator('#requirementRisk').selectOption('lowest-cost');
      await page.locator('#requirementForm button[type="submit"]').click();
      await page.locator('#requirementPlan').getByText(`Try plan for: ${journey.query}`).waitFor();
      const actualTop = await page.locator('#requirementPlan .timeline-item strong').evaluateAll((items) =>
        items.slice(0, 4).map((item) => item.textContent.trim())
      );
      results.push({ query: journey.query, actualTop });
      // Starter prices are unreviewed: test relevance, not the old price-based order.
      const overlap = actualTop.filter(name => journey.expectedTop.includes(name));
      if (overlap.length < Math.min(2, journey.expectedTop.length)) throw new Error(`Missing relevant options for "${journey.query}": ${actualTop.join(', ')}`);
      const summary = await page.locator('#requirementPlan').textContent();
      if (!summary.includes('Unreviewed preview') || /Highest value|Easiest to cancel|Low exposure/.test(summary)) throw new Error('Unreviewed matches must not imply verified cost, value or cancellation ease.');
    }

    if (errors.length) {
      throw new Error(`Console errors:\n${errors.join('\n')}`);
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
