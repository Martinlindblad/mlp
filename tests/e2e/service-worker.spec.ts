import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const cacheName = 'mlp-shell-v2';
const expectedManifest = [
  '/',
  '/favicon.ico',
  '/manifest.json',
  '/images/profilepicture.webp',
] as const;

async function activateServiceWorker(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'React and mobile interfaces built for real users.',
    }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'React and mobile interfaces built for real users.',
    }),
  ).toBeVisible();

  const controller = await page.evaluate(() => ({
    scriptURL: navigator.serviceWorker.controller?.scriptURL ?? null,
    state: navigator.serviceWorker.controller?.state ?? null,
  }));
  expect(controller).toEqual({
    scriptURL: `${new URL(page.url()).origin}/sw.js`,
    state: 'activated',
  });
}

test('service worker activates and precaches exactly its complete manifest', async ({
  page,
}) => {
  await activateServiceWorker(page);

  const state = await page.evaluate(
    async ({ expectedCacheName }) => {
      const manifestResponse = await fetch('/sw-manifest.json', {
        cache: 'no-store',
      });
      const manifest = (await manifestResponse.json()) as string[];
      const cacheNames = await caches.keys();
      const cache = await caches.open(expectedCacheName);
      const manifestPaths = ['/sw-manifest.json', ...manifest];
      const cachedManifest = await Promise.all(
        manifestPaths.map(async (path) => ({
          path,
          status: (await cache.match(path))?.status ?? null,
        })),
      );

      return {
        cacheNames: cacheNames.sort(),
        cachedManifest,
        manifest,
        manifestStatus: manifestResponse.status,
      };
    },
    { expectedCacheName: cacheName },
  );

  expect(state.manifestStatus).toBe(200);
  expect(state.manifest).toEqual(expectedManifest);
  expect(state.cacheNames).toEqual([cacheName]);
  expect(state.cachedManifest).toEqual(
    ['/sw-manifest.json', ...expectedManifest].map((path) => ({
      path,
      status: 200,
    })),
  );
});

test('controlled contact POST bypasses service-worker caches and reaches PostgreSQL', async ({
  page,
}) => {
  await activateServiceWorker(page);

  const result = await page.evaluate(
    async ({ expectedCacheName }) => {
      const cache = await caches.open(expectedCacheName);
      const cachedApiPaths = async () =>
        (await cache.keys())
          .map((request) => new URL(request.url).pathname)
          .filter((path) => path === '/api' || path.startsWith('/api/'))
          .sort();
      const beforeApiPaths = await cachedApiPaths();
      const response = await fetch('/api/contact/route', {
        body: JSON.stringify({
          email: 'browser-acceptance@example.invalid',
          fullName: 'Browser Acceptance',
          message: 'Synthetic browser acceptance message.',
          subject: 'Service worker bypass',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = (await response.json()) as unknown;
      const afterApiPaths = await cachedApiPaths();

      return {
        afterApiPaths,
        beforeApiPaths,
        body,
        controllerState: navigator.serviceWorker.controller?.state ?? null,
        status: response.status,
      };
    },
    { expectedCacheName: cacheName },
  );

  expect(result.controllerState).toBe('activated');
  expect(result.status).toBe(201);
  expect(result.body).toEqual({
    success: true,
    successMessage: 'Message sent successfully',
  });
  expect(result.beforeApiPaths).toEqual([]);
  expect(result.afterApiPaths).toEqual([]);
});
