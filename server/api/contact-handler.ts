import type { NextApiHandler } from 'next';
import { z } from 'zod';
import { ContactConflictError } from '../journal/contact-journal';

export interface ContactSubmission {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
}

const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTACT_DEADLINE_MS = 20_000;

const contactSchema = z
  .object({
    fullName: z.string().trim().min(2).max(50),
    email: z.string().trim().email().max(254),
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(30_000),
  })
  .strict();

function invalidRequest(response: Parameters<NextApiHandler>[1]): void {
  response.status(400).json({ errorMessage: 'Missing fields', success: false });
}

function unavailable(response: Parameters<NextApiHandler>[1], status = 503) {
  response
    .status(status)
    .json({ errorMessage: 'Unable to send message.', success: false });
}

function parseIdempotencyKey(
  value: string | string[] | undefined,
  randomUUID: () => string,
): string | null {
  if (value === undefined) {
    const generated = randomUUID();
    return IDEMPOTENCY_KEY_PATTERN.test(generated) ? generated : null;
  }
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    return null;
  }
  return value;
}

export function createContactHandler(deps: {
  acceptContact(input: ContactSubmission, signal: AbortSignal): Promise<void>;
  randomUUID(): string;
}): NextApiHandler {
  return async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ errorMessage: 'Method Not Allowed' });
      return;
    }

    const idempotencyKey = parseIdempotencyKey(
      request.headers['idempotency-key'],
      deps.randomUUID,
    );
    if (!idempotencyKey) {
      invalidRequest(response);
      return;
    }
    response.setHeader('Idempotency-Key', idempotencyKey);

    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success) {
      invalidRequest(response);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONTACT_DEADLINE_MS);

    try {
      await deps.acceptContact(
        {
          id: idempotencyKey,
          ...parsed.data,
        },
        controller.signal,
      );
      response
        .status(201)
        .json({ successMessage: 'Message sent successfully', success: true });
    } catch (error) {
      unavailable(response, error instanceof ContactConflictError ? 409 : 503);
    } finally {
      clearTimeout(timer);
    }
  };
}
