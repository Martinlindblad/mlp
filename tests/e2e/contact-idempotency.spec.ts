import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const keyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface CapturedContactRequest {
  body: unknown;
  key: string | undefined;
}

async function fillContactForm(
  page: Page,
  values = {
    fullName: ' Martin Lindblad ',
    email: ' martin@example.com ',
    subject: ' Hello ',
    message: ' Message ',
  },
): Promise<void> {
  await page.goto('/contact', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Your Name').fill(values.fullName);
  await page.getByLabel('Your Email').fill(values.email);
  await page.getByLabel('Subject').fill(values.subject);
  await page.getByLabel('Your Message').fill(values.message);
}

async function installContactRoute(
  page: Page,
  handler: (
    route: Route,
    request: CapturedContactRequest,
    index: number,
  ) => Promise<void>,
): Promise<CapturedContactRequest[]> {
  const requests: CapturedContactRequest[] = [];
  await page.route('**/api/contact/route', async (route) => {
    const request = route.request();
    const captured = {
      body: JSON.parse(request.postData() ?? '{}') as unknown,
      key: request.headers()['idempotency-key'],
    };
    requests.push(captured);
    await handler(route, captured, requests.length - 1);
  });
  return requests;
}

async function submit(page: Page): Promise<void> {
  await page.getByRole('button', { name: /send message/i }).click();
}

test('first submit sends one canonical key, canonical body, and locks while in flight', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests = await installContactRoute(page, async (route) => {
    await gate;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        successMessage: 'Message sent successfully',
      }),
    });
  });

  await fillContactForm(page);
  await submit(page);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]?.key).toMatch(keyPattern);
  expect(requests[0]?.body).toEqual({
    fullName: 'Martin Lindblad',
    email: 'martin@example.com',
    subject: 'Hello',
    message: 'Message',
  });
  await expect(page.getByRole('button', { name: /sending/i })).toBeDisabled();

  await page.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  await page.waitForTimeout(100);
  expect(requests).toHaveLength(1);

  release();
  await expect(page.getByText('Message sent successfully')).toBeVisible();
});

test('HTTP 503 and invalid JSON retries reuse the same key until success', async ({
  page,
}) => {
  const requests = await installContactRoute(
    page,
    async (route, _request, index) => {
      if (index === 0) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            errorMessage: 'Unable to send message.',
          }),
        });
        return;
      }
      if (index === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: 'not-json',
        });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          successMessage: 'Message sent successfully',
        }),
      });
    },
  );

  await fillContactForm(page);
  await submit(page);
  await expect(page.getByText('Unable to send message.')).toBeVisible();
  await submit(page);
  await expect(
    page.getByText(
      "A network error occurred, or the server's response could not be processed.",
    ),
  ).toBeVisible();
  await submit(page);
  await expect(page.getByText('Message sent successfully')).toBeVisible();

  expect(requests).toHaveLength(3);
  expect(requests[0]?.key).toBe(requests[1]?.key);
  expect(requests[1]?.key).toBe(requests[2]?.key);
});

test('editing after failure creates a new key', async ({ page }) => {
  const requests = await installContactRoute(
    page,
    async (route, _request, index) => {
      await route.fulfill({
        status: index === 0 ? 503 : 201,
        contentType: 'application/json',
        body: JSON.stringify(
          index === 0
            ? { success: false, errorMessage: 'Unable to send message.' }
            : { success: true, successMessage: 'Message sent successfully' },
        ),
      });
    },
  );

  await fillContactForm(page);
  await submit(page);
  await expect(page.getByText('Unable to send message.')).toBeVisible();
  await page.getByLabel('Your Message').fill('Changed message');
  await submit(page);
  await expect(page.getByText('Message sent successfully')).toBeVisible();

  expect(requests).toHaveLength(2);
  expect(requests[0]?.key).not.toBe(requests[1]?.key);
});

test('confirmed success clears fields and the next submission receives a new key', async ({
  page,
}) => {
  const requests = await installContactRoute(page, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        successMessage: 'Message sent successfully',
      }),
    });
  });

  await fillContactForm(page);
  await submit(page);
  await expect(page.getByText('Message sent successfully')).toBeVisible();
  await expect(page.getByLabel('Your Name')).toHaveValue('');

  await fillContactForm(page, {
    fullName: 'Second Sender',
    email: 'second@example.com',
    subject: 'Second',
    message: 'Second message',
  });
  await submit(page);

  expect(requests).toHaveLength(2);
  expect(requests[0]?.key).not.toBe(requests[1]?.key);
});

test('HTTP 409 shows the generic error and keeps the key for retry until edit', async ({
  page,
}) => {
  const requests = await installContactRoute(
    page,
    async (route, _request, index) => {
      await route.fulfill({
        status: index === 0 ? 409 : 201,
        contentType: 'application/json',
        body: JSON.stringify(
          index === 0
            ? { success: false, errorMessage: 'Unable to send message.' }
            : { success: true, successMessage: 'Message sent successfully' },
        ),
      });
    },
  );

  await fillContactForm(page);
  await submit(page);
  await expect(page.getByText('Unable to send message.')).toBeVisible();
  await submit(page);
  await expect(page.getByText('Message sent successfully')).toBeVisible();

  expect(requests).toHaveLength(2);
  expect(requests[0]?.key).toBe(requests[1]?.key);
});
