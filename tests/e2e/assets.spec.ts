import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const expectedManifest = {
  background_color: '#000000',
  display: 'standalone',
  name: 'Martin Lindblad Portfolio',
  short_name: 'MLindblad',
  start_url: '/',
  theme_color: '#000000',
};

async function expectStaticAsset(
  request: APIRequestContext,
  path: string,
  contentType: RegExp,
): Promise<void> {
  const response = await request.get(path);

  expect(response.status(), path).toBe(200);
  expect(response.headers()['content-type'], path).toMatch(contentType);
  expect((await response.body()).byteLength, path).toBeGreaterThan(0);
}

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
  expect(
    await page.evaluate(
      () => navigator.serviceWorker.controller?.state ?? null,
    ),
  ).toBe('activated');
}

test('web manifest and representative static assets are served locally', async ({
  page,
  request,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'React and mobile interfaces built for real users.',
    }),
  ).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.json',
  );

  const manifestResponse = await request.get('/manifest.json');
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()['content-type']).toMatch(
    /^application\/json\b/,
  );
  expect(await manifestResponse.json()).toEqual(expectedManifest);

  await expectStaticAsset(request, '/favicon.ico', /^image\//);
  await expectStaticAsset(
    request,
    '/images/profilepicture.webp',
    /^image\/webp\b/,
  );
  await expectStaticAsset(
    request,
    '/images/cases/mackmyra.webp',
    /^image\/webp\b/,
  );
});

test('controlled video range request bypasses the worker and returns exact bytes', async ({
  page,
}) => {
  await activateServiceWorker(page);

  const response = await page.evaluate(async () => {
    const result = await fetch('/assets/man.mp4', {
      headers: { Range: 'bytes=0-1023' },
    });
    const body = await result.arrayBuffer();

    return {
      acceptRanges: result.headers.get('accept-ranges'),
      contentLength: result.headers.get('content-length'),
      contentRange: result.headers.get('content-range'),
      contentType: result.headers.get('content-type'),
      controllerState: navigator.serviceWorker.controller?.state ?? null,
      length: body.byteLength,
      status: result.status,
    };
  });

  expect(response.controllerState).toBe('activated');
  expect(response.status).toBe(206);
  expect(response.contentRange).toMatch(/^bytes 0-1023\/[1-9][0-9]*$/);
  expect(response.contentLength).toBe('1024');
  expect(response.acceptRanges).toBe('bytes');
  expect(response.contentType).toMatch(/^video\/mp4\b/);
  expect(response.length).toBe(1024);
});
