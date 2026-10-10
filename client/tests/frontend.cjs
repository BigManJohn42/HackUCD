// Test-only fixtures. Start Vite before running: node tests/frontend.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.env.TEST_URL || 'http://127.0.0.1:5173';
const transport = { destinations: [{ id: 'ucd', name: 'UCD Belfield' }, { id: 'green', name: 'St Stephen’s Green' }], referenceData: { source: 'integration-test' } };
const routes = [
  { id: 'first', title: 'Test bus route', departureTime: '2026-10-10T08:00:00+01:00', arrivalTime: '2026-10-10T08:30:00+01:00', durationMin: 30, transfers: 0,
    steps: [{ id: 'bus', mode: 'bus', service: 'Test service', from: 'UCD Belfield', to: 'St Stephen’s Green', departureTime: '2026-10-10T08:00:00+01:00', arrivalTime: '2026-10-10T08:30:00+01:00', instructions: 'Test boarding instructions' }] },
  { id: 'second', title: 'Test walking route', departureTime: '2026-10-10T08:00:00+01:00', arrivalTime: '2026-10-10T09:00:00+01:00', durationMin: 60, transfers: 0,
    steps: [{ id: 'walk', mode: 'walk', from: 'Test start', to: 'Test finish', departureTime: '2026-10-10T08:00:00+01:00', arrivalTime: '2026-10-10T09:00:00+01:00' }] },
];
async function visible(locator) { await locator.waitFor({ state: 'visible' }); }
(async () => {
  const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH, headless: true } : { channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/London' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let unavailable = true, routeMode = 'success', chatFail = true, plansFail = true;
    let routeBody, chatBody, chatRequests = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const json = body => route.fulfill({ json: body });
      const fail = () => route.fulfill({ status: 503, json: { error: 'Test unavailable' } });
      if (path === '/api/transport-data') return unavailable ? fail() : json(transport);
      if (path === '/api/routes') {
        routeBody = route.request().postDataJSON();
        await new Promise(resolve => setTimeout(resolve, 150));
        return routeMode === 'failure' ? fail() : json({ routes: routeMode === 'empty' ? [] : routes });
      }
      if (path === '/api/chat') {
        chatBody = route.request().postDataJSON(); chatRequests++;
        await new Promise(resolve => setTimeout(resolve, 150));
        return chatFail ? fail() : json({ reply: '<b>Plain text reply</b>', routes });
      }
      if (path === '/api/subscription-plans') return plansFail ? fail() : json({ plans: [
        { id: 'year', name: 'Annual Test', interval: 'year', price: 123.45, currency: 'EUR', benefits: ['Returned yearly benefit'] },
        { id: 'month', name: 'Monthly Test', interval: 'month', price: 12.34, currency: 'EUR', benefits: ['Returned monthly benefit'] },
      ] });
      return fail();
    });
    const nav = name => page.getByRole('navigation').getByRole('link', { name, exact: true });
    const headings = { Home: 'Plan your commute', 'Manual Planner': 'Where are you heading?', 'Smart Planner': 'Let’s find your way.', Subscriptions: 'A plan for your routine.' };
    async function go(name) {
      await nav(name).click();
      await visible(page.getByRole('heading', { name: new RegExp(headings[name].replace(/[?\.]/g, '\\$&')) }));
      await page.waitForFunction(name => [...document.querySelectorAll('nav a')].some(a => a.textContent === name && a.getAttribute('aria-current') === 'page'), name);
    }
    await page.goto(url);
    assert.equal(await page.locator('.home-card a').count(), 3);
    await page.screenshot({ path: 'tmp/home.png', fullPage: true });
    await go('Smart Planner');
    await page.getByLabel('Your message').fill('Help me travel');
    await visible(page.getByText('Transport data is unavailable.', { exact: false }).filter({ visible: true }));
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    await go('Manual Planner');
    await page.getByRole('button', { name: 'Find routes' }).click();
    await visible(page.getByRole('alert'));
    await page.getByLabel('Start destination').fill('Same');
    await page.getByLabel('End destination').fill(' same ');
    await page.getByRole('button', { name: 'Find routes' }).click();
    assert.match(await page.getByRole('alert').innerText(), /different/);
    await page.getByLabel('Start destination').fill('UCD Belfield');
    await page.getByLabel('End destination').fill('St Stephen’s Green');
    await page.getByRole('button', { name: /Swap destinations/ }).click();
    assert.equal(await page.getByLabel('Start destination').inputValue(), 'St Stephen’s Green');
    await page.getByRole('button', { name: /Swap destinations/ }).click();
    await page.getByLabel('Departure date and time').fill('');
    await page.getByRole('button', { name: 'Find routes' }).click();
    assert.match(await page.getByRole('alert').innerText(), /valid departure/);
    await page.getByLabel('Departure date and time').fill('2026-10-10T08:00');
    unavailable = false;
    await page.locator('section:not([hidden])').getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#destinations option').length === 2);
    await page.getByRole('button', { name: 'Find routes' }).click();
    await visible(page.getByRole('button', { name: /Test bus route/ }));
    assert.match(routeBody.departureTime, /T08:00:00\+01:00$/);
    await page.getByRole('button', { name: /Test walking route/ }).click();
    await visible(page.getByRole('heading', { name: 'Test start → Test finish' }));
    await go('Home'); await go('Manual Planner');
    assert.equal(await page.getByLabel('Start destination').inputValue(), 'UCD Belfield');
    assert.equal(await page.getByRole('button', { name: /Test walking route/ }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: 'tmp/manual.png', fullPage: true });
    routeMode = 'empty';
    await page.getByRole('button', { name: 'Find routes' }).click();
    await visible(page.getByRole('heading', { name: 'No routes found' }));
    routeMode = 'failure';
    await page.getByRole('button', { name: 'Find routes' }).click();
    await visible(page.getByRole('alert'));
    assert.equal(await page.getByLabel('End destination').inputValue(), 'St Stephen’s Green');
    await go('Smart Planner');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Retry reply' }));
    chatFail = false;
    await page.getByRole('button', { name: 'Retry reply' }).click();
    await visible(page.getByText('<b>Plain text reply</b>', { exact: true }));
    assert.equal(await page.locator('.message.user').count(), 1);
    assert.equal(chatRequests, 2);
    assert.deepEqual(chatBody.transportData, transport);
    assert.deepEqual(chatBody.history, []);
    assert.equal(await page.locator('.message.assistant b').count(), 0);
    await page.getByLabel('Your message').fill('What next?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.message.user').length === 2 && document.querySelectorAll('.message.assistant').length === 3);
    assert.equal(chatBody.history.length, 2);
    await page.screenshot({ path: 'tmp/smart.png', fullPage: true });
    await go('Subscriptions');
    await visible(page.getByRole('heading', { name: 'Plans are currently unavailable' }));
    assert.equal(await page.locator('.plan-card').count(), 0);
    plansFail = false;
    await page.locator('section:not([hidden])').getByRole('button', { name: 'Retry', exact: true }).click();
    await visible(page.getByRole('heading', { name: 'Monthly Test' }));
    assert.match(await page.locator('.plan-card').first().innerText(), /€12.34/);
    assert.match(await page.locator('.plan-card').last().innerText(), /€123.45/);
    await page.screenshot({ path: 'tmp/subscriptions.png', fullPage: true });
    await page.getByLabel('Text size').selectOption('large');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '20px');
    for (const name of ['Home', 'Manual Planner', 'Smart Planner', 'Subscriptions']) {
      await go(name);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} should fit desktop at large font`);
    }
    await go('Home');
    await page.screenshot({ path: 'tmp/home-large.png', fullPage: true });
    await page.reload();
    assert.equal(await page.getByLabel('Text size').inputValue(), 'large');
    await go('Manual Planner');
    assert.equal(await page.getByLabel('Start destination').inputValue(), '');
    await go('Smart Planner');
    assert.equal(await page.locator('.message.user').count(), 0);
    await page.goBack();
    await visible(page.getByRole('heading', { name: 'Where are you heading?' }));
    await page.goForward();
    await visible(page.getByRole('heading', { name: 'Let’s find your way.' }));
    await page.reload();
    await visible(page.getByRole('heading', { name: 'Let’s find your way.' }));
    await page.getByRole('link', { name: 'Skip to content' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('h1:visible').evaluate(el => el === document.activeElement), true);
    assert.deepEqual(errors, []);
    console.log('Passed: navigation, persistence, validation, routes, chat, retry, fetched plans, desktop layout, and keyboard focus.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
fs.mkdirSync('tmp', { recursive: true });
