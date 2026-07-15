import { expect, test } from '@playwright/test';
import type { ConsoleMessage, Locator, Page } from '@playwright/test';

type PublicRoute = {
  marker: (page: Page) => Locator;
  path: string;
};

const publicRoutes: PublicRoute[] = [
  {
    path: '/',
    marker: (page) =>
      page.getByRole('heading', {
        level: 1,
        name: 'React and mobile interfaces built for real users.',
      }),
  },
  {
    path: '/about',
    marker: (page) =>
      page.getByRole('heading', { level: 2, name: 'Languages' }),
  },
  {
    path: '/experience',
    marker: (page) =>
      page.getByRole('heading', {
        level: 1,
        name: 'In-Depth with my Experience and skillset',
      }),
  },
  {
    path: '/showcases',
    marker: (page) =>
      page.getByRole('heading', {
        level: 1,
        name: /Case studies with product context, delivery work, and technical decisions\./,
      }),
  },
  {
    path: '/cases',
    marker: (page) =>
      page.getByRole('heading', { level: 1, name: 'All Cases' }),
  },
  {
    path: '/contact',
    marker: (page) =>
      page.getByRole('heading', { level: 2, name: 'Get in touch' }),
  },
];

const readApiPaths = [
  '/api/about',
  '/api/introduction',
  '/api/currentOccupation',
  '/api/languages',
  '/api/list',
  '/api/pageCards',
  '/api/professionalTimeline',
  '/api/projectsAndCases',
  '/api/pursuit',
  '/api/socialmedia',
] as const;

const iconifyApiHosts = new Set([
  'api.iconify.design',
  'api.simplesvg.com',
  'api.unisvg.com',
]);

function isKnownExternalIconifyError(message: ConsoleMessage): boolean {
  const locationUrl = message.location().url;

  try {
    if (locationUrl && iconifyApiHosts.has(new URL(locationUrl).hostname)) {
      return true;
    }
  } catch {
    // A missing or non-URL console location is evaluated by its message below.
  }

  return /https:\/\/api\.(?:iconify\.design|simplesvg\.com|unisvg\.com)/.test(
    message.text(),
  );
}

function collectBrowserFailures(page: Page, baseURL: string): string[] {
  const failures: string[] = [];
  const expectedOrigin = new URL(baseURL).origin;

  page.on('console', (message) => {
    if (message.type() === 'error' && !isKnownExternalIconifyError(message)) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin === expectedOrigin) {
      failures.push(
        `requestfailed: ${request.method()} ${requestUrl.pathname}${
          requestUrl.search
        } ${request.failure()?.errorText ?? 'unknown failure'}`,
      );
    }
  });

  return failures;
}

for (const route of publicRoutes) {
  test(`${route.path} renders its stable marker without browser errors`, async ({
    baseURL,
    page,
  }) => {
    expect(baseURL).toBeTruthy();
    const failures = collectBrowserFailures(page, baseURL as string);

    const response = await page.goto(route.path, {
      waitUntil: 'domcontentloaded',
    });

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
    await expect(route.marker(page)).toBeVisible();
    expect(failures).toEqual([]);
  });
}

test('legacy case ID remains routable with its seeded title', async ({
  baseURL,
  page,
}) => {
  expect(baseURL).toBeTruthy();
  const failures = collectBrowserFailures(page, baseURL as string);

  const response = await page.goto('/cases/64b000000000000000000009', {
    waitUntil: 'domcontentloaded',
  });

  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Legacy Portfolio Case' }),
  ).toBeVisible();
  expect(failures).toEqual([]);
});

test('read APIs retain status and array shape', async ({ request }) => {
  for (const path of readApiPaths) {
    const response = await request.get(path);

    expect(response.status(), path).toBe(200);
    expect(await response.json(), path).toEqual(expect.any(Array));
  }
});

test('liveness and readiness health endpoints report their exact states', async ({
  request,
}) => {
  const live = await request.get('/api/health/live');
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: 'ok' });

  const ready = await request.get('/api/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
});

test('contact endpoint rejects GET with Method Not Allowed', async ({
  request,
}) => {
  const response = await request.get('/api/contact/route');

  expect(response.status()).toBe(405);
  expect(await response.json()).toEqual({ errorMessage: 'Method Not Allowed' });
});
