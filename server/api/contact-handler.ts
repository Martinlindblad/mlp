import type { NextApiHandler } from 'next';
import { z } from 'zod';
import type { NewContactMessage } from '../repositories/contact-repository';

const contactSchema = z
  .object({
    fullName: z.string().trim().min(2).max(50),
    email: z.string().trim().email().max(254),
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(30_000),
  })
  .strict();

export function createContactHandler(deps: {
  insertContact(message: NewContactMessage): Promise<void>;
  randomUUID(): string;
  now(): Date;
}): NextApiHandler {
  return async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ errorMessage: 'Method Not Allowed' });
      return;
    }

    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success) {
      response
        .status(400)
        .json({ errorMessage: 'Missing fields', success: false });
      return;
    }

    try {
      await deps.insertContact({
        id: deps.randomUUID(),
        ...parsed.data,
        createdAt: deps.now(),
      });
      response
        .status(201)
        .json({ successMessage: 'Message sent successfully', success: true });
    } catch {
      response
        .status(503)
        .json({ errorMessage: 'Unable to send message.', success: false });
    }
  };
}
