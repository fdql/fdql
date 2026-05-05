import { chromium, expect } from '@playwright/test';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';

const root = resolve('apps/docs/.build/site');
const port = 4177;
const baseUrl = `http://127.0.0.1:${port}/firebase-desk`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const file = await resolveFile(url.pathname);
  if (!file) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('Content-Type', contentType(file));
  createReadStream(file).pipe(response);
});

await new Promise((resolveListen) => {
  server.listen(port, '127.0.0.1', () => resolveListen(undefined));
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  await page.goto(`${baseUrl}/`);
  await expect(page.getByRole('heading', { name: 'Firebase Desk' })).toBeVisible();
  await expect(page.getByAltText('Firebase Desk workspace showing a Firestore orders query'))
    .toBeVisible();
  await expect(page.locator('iframe[title="Firebase Desk browser demo preview"]')).toHaveCount(0);
  await expectSiteThemeSwitcher(page);

  await page.goto(`${baseUrl}/demo/`);
  const demo = page.frameLocator('iframe[title="Firebase Desk browser demo"]');
  await expect(demo.getByText('browser demo')).toBeVisible({ timeout: 20_000 });
  await expect(demo.getByRole('dialog', { name: 'Try Firebase Desk in mock mode' })).toHaveCount(
    0,
  );
  await demo.getByRole('button', { name: 'Run' }).click();
  await expect(demo.getByText('ord_1024')).toBeVisible({ timeout: 20_000 });
  await demo.getByRole('button', { name: 'Settings' }).click();
  await expect(demo.getByRole('button', { name: 'mock data mode' })).toBeVisible();
  await expect(demo.getByRole('button', { name: 'live data mode' })).toHaveCount(0);

  await page.goto(`${baseUrl}/docs/`);
  await expectLightThemeVariables(page);
  const searchButton = page.getByRole('button', { name: /search/i }).first();
  await expect(searchButton).toBeEnabled({ timeout: 20_000 });
  await searchButton.click();
  await page.locator('#starlight__search input').fill('custom claims');
  await expect(page.getByText('Authentication').first()).toBeVisible({ timeout: 20_000 });

  const mobile = await browser.newPage({
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  await mobile.goto(`${baseUrl}/`);
  await expect(mobile.getByRole('heading', { name: 'Firebase Desk' })).toBeVisible();
  await expect(mobile.getByRole('link', { name: 'Open demo' })).toBeVisible();
  await expectNoHorizontalOverflow(mobile);

  await mobile.goto(`${baseUrl}/demo/`);
  await expect(
    mobile.frameLocator('iframe[title="Firebase Desk browser demo"]').getByText('browser demo'),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expectNoHorizontalOverflow(mobile);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(() => resolveClose(undefined)));
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function expectNoHorizontalOverflow(page) {
  await expect
    .poll(async () =>
      Boolean(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
    )
    .toBe(true);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function expectLightThemeVariables(page) {
  const colors = await page.evaluate(`(() => {
    document.documentElement.dataset.theme = 'light';
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue('--sl-color-black').trim(),
      text: style.getPropertyValue('--sl-color-white').trim(),
    };
  })()`);
  expect(colors).toEqual({
    background: '#ffffff',
    text: '#0f172a',
  });
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function expectSiteThemeSwitcher(page) {
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme-choice', 'system');

  await page.getByLabel('Theme').selectOption('light');
  await expect(root).toHaveAttribute('data-theme-choice', 'light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate("localStorage.getItem('starlight-theme')")).toBe('light');

  await page.getByLabel('Theme').selectOption('dark');
  await expect(root).toHaveAttribute('data-theme-choice', 'dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate("localStorage.getItem('starlight-theme')")).toBe('dark');

  await page.getByLabel('Theme').selectOption('system');
  await expect(root).toHaveAttribute('data-theme-choice', 'system');
  await expect.poll(() => page.evaluate("localStorage.getItem('starlight-theme')")).toBe(null);
}

/**
 * @param {string} pathname
 */
async function resolveFile(pathname) {
  if (!pathname.startsWith('/firebase-desk')) return null;
  const relativePath = decodeURIComponent(pathname.slice('/firebase-desk'.length));
  const candidates = [];
  const normalized = relativePath === '' ? '/' : relativePath;
  if (normalized.endsWith('/')) {
    candidates.push(resolve(root, `.${normalized}index.html`));
  } else {
    candidates.push(resolve(root, `.${normalized}`));
    candidates.push(resolve(root, `.${normalized}/index.html`));
  }
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * @param {string} file
 */
function contentType(file) {
  switch (extname(file)) {
    case '.css':
      return 'text/css';
    case '.js':
      return 'text/javascript';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'text/html';
  }
}
